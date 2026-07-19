import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Polyfill requestAnimationFrame for Node — execute callback on next microtask.
if (typeof globalThis.requestAnimationFrame === "undefined") {
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
        void Promise.resolve().then(() => cb(0));
        return 0;
    };
}

// Polyfill document.{add,remove}EventListener for Node — chat-view's paperclip
// menu registers a document-level ESC listener for dismissal (uog).
if (typeof globalThis.document === "undefined") {
    (globalThis as any).document = {
        addEventListener: () => {},
        removeEventListener: () => {},
    };
}
if (typeof (globalThis as any).activeDocument === "undefined") {
    (globalThis as any).activeDocument = (globalThis as any).document;
}

import { App, Menu, MockMenuItem, MockMenuSeparator, Notice, Platform, WorkspaceLeaf } from "../__mocks__/obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { ChatView, VIEW_TYPE_CHAT, VaultFilePickerModal, compactionMarkerText } from "../../src/views/chat-view";
import { electronDialog } from "../../src/utils/file-dialog";
import { ok, err } from "../../src/result";
import type LilbeePlugin from "../../src/main";
import { SSE_EVENT } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";

const mockChatViewConfirmResult = true;
vi.mock("../../src/views/confirm-pull-modal", () => ({
    ConfirmPullModal: vi.fn().mockImplementation(function () {
        return {
            open: vi.fn(),
            get result() {
                return Promise.resolve(mockChatViewConfirmResult);
            },
            close: vi.fn(),
        };
    }),
}));

vi.mock("../../src/views/crawl-modal", () => ({
    CrawlModal: vi.fn().mockImplementation(function () {
        return {
            open: vi.fn(),
            result: Promise.resolve(true),
            close: vi.fn(),
        };
    }),
}));

vi.mock("../../src/views/catalog-modal", () => ({
    CatalogModal: vi.fn().mockImplementation(function () {
        return {
            open: vi.fn(),
        };
    }),
}));

let confirmModalResult = true;
vi.mock("../../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(function () {
        return {
            open: vi.fn(),
            get result() {
                return Promise.resolve(confirmModalResult);
            },
            close: vi.fn(),
        };
    }),
}));
const { setupWizardOpen } = vi.hoisted(() => ({ setupWizardOpen: vi.fn() }));
const { sessionsHooks } = vi.hoisted(() => ({ sessionsHooks: [] as any[] }));
vi.mock("../../src/views/sessions-modal", () => ({
    SessionsModal: vi.fn().mockImplementation(function (_app: any, _plugin: any, hooks: any) {
        sessionsHooks.push(hooks);
        return { open: vi.fn() };
    }),
}));

vi.mock("../../src/views/setup-wizard", () => ({
    SetupWizard: vi.fn().mockImplementation(function () {
        return { open: setupWizardOpen };
    }),
}));
import type { SSEEvent, Source } from "../../src/types";
import { TaskQueue } from "../../src/task-queue";
import { displayLabelForRef } from "../../src/utils/model-ref";

function makeLeaf(): WorkspaceLeaf {
    return new WorkspaceLeaf();
}

/**
 * Creates a chatStream mock that yields the given events and returns a
 * promise that resolves when the generator is fully consumed.
 */
function makeStream(events: SSEEvent[]): {
    mockFn: ReturnType<typeof vi.fn>;
    done: Promise<void>;
} {
    let resolveStream!: () => void;
    const done = new Promise<void>((r) => {
        resolveStream = r;
    });
    const mockFn = vi.fn().mockReturnValue(
        (async function* () {
            for (const e of events) yield e;
            resolveStream();
        })(),
    );
    return { mockFn, done };
}

/** Flush one macrotask tick so async chains settle. */
function tick(): Promise<void> {
    return new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
    Menu.clear();
});

/** Click a rail chip trigger and return the Menu it opened (null when no menu was shown). */
function openRailMenu(container: MockElement, triggerCls: string): Menu | null {
    const before = Menu.instances.length;
    container.find(triggerCls)!.trigger("click", { clientX: 0, clientY: 0 } as MouseEvent);
    return Menu.instances.length > before ? Menu.instances[Menu.instances.length - 1] : null;
}

/** Titles of a menu's clickable items, separators excluded. */
function menuTitles(menu: Menu | null): string[] {
    return menu?.menuItems.map((i) => i.title) ?? [];
}

/** Open a chip's menu and click the item with the given title. */
function pickRailItem(container: MockElement, triggerCls: string, title: string): void {
    openRailMenu(container, triggerCls)!.itemTitled(title)!.click();
}

/** Text shown on a chip trigger. */
function triggerText(container: MockElement, triggerCls: string): string {
    return container.find(triggerCls)!.find("lilbee-model-chip-select-text")!.textContent;
}

function makePlugin(): LilbeePlugin {
    return {
        api: {
            chatStream: vi.fn(),
            installedModels: vi.fn().mockImplementation((params?: { task?: string }) => {
                if (params?.task === "chat") {
                    return Promise.resolve({
                        models: [
                            { name: "llama3", source: "native" },
                            { name: "phi3", source: "native" },
                        ],
                    });
                }
                return Promise.resolve({
                    models: [
                        { name: "llama3", source: "native" },
                        { name: "phi3", source: "native" },
                        { name: "nomic-embed-text", source: "native" },
                    ],
                });
            }),
            setChatModel: vi.fn().mockResolvedValue(ok(undefined)),
            setEmbeddingModel: vi.fn().mockResolvedValue(ok(undefined)),
            setVisionModel: vi.fn().mockResolvedValue(ok(undefined)),
            setRerankerModel: vi.fn().mockResolvedValue(ok(undefined)),
            pullModel: vi.fn(),
            catalog: vi.fn().mockImplementation((params?: { task?: string }) => {
                if (params?.task === "chat") {
                    // Empty featured chat catalog — installed refs go under the "Other" group.
                    return Promise.resolve(ok({ total: 0, limit: 50, offset: 0, models: [], has_more: false }));
                }
                // The embedding picker has its own catalog list keyed off the embedding task.
                return Promise.resolve(
                    ok({
                        total: 1,
                        limit: 50,
                        offset: 0,
                        models: [
                            {
                                hf_repo: "nomic-embed-text",
                                gguf_filename: "",
                                display_name: "nomic-embed-text",
                                size_gb: 0.3,
                                min_ram_gb: 1,
                                description: "Embedding",
                                installed: true,
                                source: "native",
                                task: "embedding",
                                featured: true,
                                downloads: 1000,
                                quality_tier: "good",
                                param_count: "137M",
                            },
                        ],
                        has_more: false,
                    }),
                );
            }),
            config: vi.fn().mockResolvedValue({ chat_model: "llama3", embedding_model: "nomic-embed-text" }),
            listSessions: vi.fn().mockResolvedValue([]),
            getSession: vi.fn(),
            createSession: vi.fn().mockResolvedValue({
                meta: {
                    id: "s1",
                    title: "Untitled chat",
                    created_at: "2026-07-16T00:00:00Z",
                    updated_at: "2026-07-16T00:00:00Z",
                    model_ref: "llama3",
                    scope: "both",
                    message_count: 0,
                    origin: "http",
                },
                messages: [],
                summary: "",
            }),
            appendSessionMessage: vi.fn().mockResolvedValue({
                meta: {
                    id: "s1",
                    title: "Untitled chat",
                    created_at: "2026-07-16T00:00:00Z",
                    updated_at: "2026-07-16T00:00:00Z",
                    model_ref: "llama3",
                    scope: "both",
                    message_count: 1,
                    origin: "http",
                },
                messages: [],
                summary: "",
            }),
            renameSession: vi.fn().mockResolvedValue({ id: "s1", title: "t" }),
            deleteSession: vi.fn().mockResolvedValue({ id: "s1", deleted: true }),
        },
        settings: { topK: 5, enableOcr: null as boolean | null, wikiEnabled: true, searchChunkType: "all" as const },
        activeModel: "llama3",
        fetchActiveModel: vi.fn(),
        refreshSettingsTab: vi.fn(),
        saveSettings: vi.fn().mockResolvedValue(undefined),
        cancelSync: vi.fn(),
        triggerSync: vi.fn().mockResolvedValue(undefined),
        notifyChatStart: vi.fn(),
        notifyChatEnd: vi.fn(),
        assertFleetReady: vi.fn().mockReturnValue(true),
        refreshMemoryViews: vi.fn(),
        taskQueue: new TaskQueue(),
        app: {
            vault: {
                getAbstractFileByPath: vi.fn().mockReturnValue(null),
                createFolder: vi.fn().mockResolvedValue(undefined),
                create: vi.fn().mockResolvedValue(undefined),
            },
        },
    } as unknown as LilbeePlugin;
}

/**
 * Wire a single `{ active, installed, catalog }` test fixture into the three endpoints
 * the chat picker calls (active model, installed list, catalog). Catalog entries are
 * stamped with the minimum CatalogEntry shape using their short names as `hf_repo`.
 */
function mockChatPicker(
    plugin: LilbeePlugin,
    chat: {
        active: string;
        installed: string[];
        catalog: Array<{
            name: string;
            size_gb: number;
            min_ram_gb: number;
            description: string;
            installed: boolean;
            source?: string;
        }>;
    },
): void {
    (plugin.api as any).config = vi.fn().mockResolvedValue({ chat_model: chat.active });
    (plugin.api as any).installedModels = vi.fn().mockImplementation((params?: { task?: string }) => {
        if (params?.task === "chat" || params === undefined) {
            return Promise.resolve({ models: chat.installed.map((name) => ({ name, source: "native" })) });
        }
        return Promise.resolve({ models: [] });
    });
    (plugin.api as any).catalog = vi.fn().mockImplementation((params?: { task?: string }) => {
        if (params?.task === "chat") {
            return Promise.resolve(
                ok({
                    total: chat.catalog.length,
                    limit: 50,
                    offset: 0,
                    has_more: false,
                    models: chat.catalog.map((m) => ({
                        hf_repo: m.name,
                        gguf_filename: "",
                        display_name: m.name,
                        size_gb: m.size_gb,
                        min_ram_gb: m.min_ram_gb,
                        description: m.description,
                        installed: m.installed,
                        source: m.source ?? "local",
                        task: "chat",
                        featured: true,
                        downloads: 0,
                        quality_tier: "balanced",
                        param_count: "",
                    })),
                }),
            );
        }
        return Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));
    });
}

function makeSource(overrides: Partial<Source> = {}): Source {
    return {
        source: "doc.pdf",
        chunk: "some chunk text",
        distance: 0.5,
        content_type: "pdf",
        page_start: null,
        page_end: null,
        line_start: null,
        line_end: null,
        ...overrides,
    };
}

describe("VIEW_TYPE_CHAT", () => {
    it("equals 'lilbee-chat'", () => {
        expect(VIEW_TYPE_CHAT).toBe("lilbee-chat");
    });
});

describe("ChatView metadata methods", () => {
    let view: ChatView;

    beforeEach(() => {
        Notice.clear();
        view = new ChatView(makeLeaf(), makePlugin());
    });

    it("getViewType returns 'lilbee-chat'", () => {
        expect(view.getViewType()).toBe("lilbee-chat");
    });

    it("getDisplayText returns 'lilbee Chat'", () => {
        expect(view.getDisplayText()).toBe("lilbee Chat");
    });

    it("getIcon returns 'message-circle'", () => {
        expect(view.getIcon()).toBe("message-circle");
    });
});

describe("ChatView.onOpen — DOM structure", () => {
    let view: ChatView;
    let container: MockElement;

    beforeEach(async () => {
        Notice.clear();
        view = new ChatView(makeLeaf(), makePlugin());
        container = view.containerEl.children[1] as unknown as MockElement;
        await view.onOpen();
    });

    it("empties and adds class to the content container", () => {
        expect(container.classList.contains("lilbee-chat-container")).toBe(true);
    });

    it("creates a toolbar div with class 'lilbee-chat-toolbar'", () => {
        expect(container.find("lilbee-chat-toolbar")).not.toBeNull();
    });

    it("creates a clear icon button inside the toolbar", () => {
        const clearBtn = container.find("lilbee-chat-clear");
        expect(clearBtn).not.toBeNull();
        expect(clearBtn!.tagName).toBe("BUTTON");
        // Icon button (matches the save action), with the label on aria-label.
        expect(clearBtn!.getAttribute("aria-label")).toBe("Clear chat");
    });

    it("creates a GPU activity button that splits placement beside the chat", () => {
        const gpuBtn = container.find("lilbee-chat-gpu");
        expect(gpuBtn).not.toBeNull();
        expect(gpuBtn!.tagName).toBe("BUTTON");
        expect(gpuBtn!.getAttribute("aria-label")).toBe("GPU activity beside chat");
        const app = (view as unknown as { app: App }).app;
        const splitLeaf = new WorkspaceLeaf();
        app.workspace.getLeavesOfType = vi.fn().mockReturnValue([]);
        app.workspace.createLeafBySplit = vi.fn().mockReturnValue(splitLeaf);
        app.workspace.revealLeaf = vi.fn();
        gpuBtn!.trigger("click");
        expect(app.workspace.createLeafBySplit).toHaveBeenCalled();
    });

    it("creates a paperclip add-file button inside the input area", () => {
        const inputArea = container.find("lilbee-chat-input");
        const addBtn = inputArea!.find("lilbee-chat-add-file");
        expect(addBtn).not.toBeNull();
        expect(addBtn!.tagName).toBe("BUTTON");
        expect(addBtn!.attributes["data-icon"]).toBe("paperclip");
    });

    it("creates toolbar groups for the chat and embed chips", () => {
        const groups = container.findAll("lilbee-toolbar-group");
        expect(groups.length).toBe(2);
    });

    it("creates a spacer div in the toolbar", () => {
        const spacer = container.find("lilbee-toolbar-spacer");
        expect(spacer).not.toBeNull();
    });

    it("creates a messages div with class 'lilbee-chat-messages'", () => {
        expect(container.find("lilbee-chat-messages")).not.toBeNull();
    });

    it("creates an input area div with class 'lilbee-chat-input'", () => {
        expect(container.find("lilbee-chat-input")).not.toBeNull();
    });

    it("creates a textarea with placeholder and class inside input area", () => {
        const textarea = container.find("lilbee-chat-textarea");
        expect(textarea).not.toBeNull();
        expect(textarea!.tagName).toBe("TEXTAREA");
        expect(textarea!.placeholder).toBe("Ask something...");
    });

    it("creates a send button with correct text and class", () => {
        const sendBtn = container.find("lilbee-chat-send");
        expect(sendBtn).not.toBeNull();
        expect(sendBtn!.tagName).toBe("BUTTON");
        expect(sendBtn!.textContent).toBe("Send");
    });
});

describe("ChatView.onOpen — send button empty text guard", () => {
    it("does not call chatStream when textarea is empty", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;

        container.find("lilbee-chat-send")!.trigger("click");

        expect(plugin.api.chatStream).not.toHaveBeenCalled();
    });

    it("does not call chatStream when textarea has only whitespace", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "   ";

        container.find("lilbee-chat-send")!.trigger("click");

        expect(plugin.api.chatStream).not.toHaveBeenCalled();
    });
});

describe("ChatView.onOpen — send button triggers send", () => {
    it("calls chatStream with trimmed text on send button click", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "  hello  ";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;

        expect(plugin.api.chatStream).toHaveBeenCalledWith("hello", [], 5, expect.any(AbortSignal), undefined, "all", {
            summary: "",
            sessionId: null,
        });
    });

    it("clears textarea value after send", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "hello";

        container.find("lilbee-chat-send")!.trigger("click");

        // textarea is cleared synchronously before async work begins
        expect(textarea.value).toBe("");
    });
});

describe("ChatView.onOpen — keydown on textarea", () => {
    it("Enter without Shift triggers send and calls preventDefault", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "hi there";

        const event = { key: "Enter", shiftKey: false, preventDefault: vi.fn() };
        textarea.trigger("keydown", event);
        await done;

        expect(event.preventDefault).toHaveBeenCalled();
        expect(plugin.api.chatStream).toHaveBeenCalled();
    });

    it("Shift+Enter does NOT trigger send", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "hi";

        const event = { key: "Enter", shiftKey: true, preventDefault: vi.fn() };
        textarea.trigger("keydown", event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(plugin.api.chatStream).not.toHaveBeenCalled();
    });

    it("non-Enter key does NOT trigger send", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "hi";

        const event = { key: "a", shiftKey: false, preventDefault: vi.fn() };
        textarea.trigger("keydown", event);

        expect(event.preventDefault).not.toHaveBeenCalled();
        expect(plugin.api.chatStream).not.toHaveBeenCalled();
    });
});

describe("ChatView.sendMessage — bubble structure", () => {
    it("creates user bubble and assistant bubble", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "question";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        expect(messagesEl.children[0].classList.contains("user")).toBe(true);
        expect(messagesEl.children[1].classList.contains("assistant")).toBe(true);
    });

    it("user bubble contains a <p> with the message text", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "my question";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const userBubble = messagesEl.children[0];
        const p = userBubble.children.find((c) => c.tagName === "P");
        expect(p).toBeDefined();
        expect(p!.textContent).toBe("my question");
    });

    it("does not send while the fleet is warming", async () => {
        Notice.clear();
        const plugin = makePlugin();
        (plugin.assertFleetReady as ReturnType<typeof vi.fn>).mockReturnValue(false);
        plugin.api.chatStream = vi.fn();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "question";

        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        expect(plugin.api.chatStream).not.toHaveBeenCalled();
        expect(messagesEl.children.length).toBe(0);
        // The refused question stays in the box so the user doesn't have to retype it.
        expect(textarea.value).toBe("question");
    });

    it("keeps the typed question when another turn is still streaming", async () => {
        const plugin = makePlugin();
        plugin.api.chatStream = vi.fn();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        // A turn already in flight: the second question must survive the refusal.
        (view as any).sending = true;
        textarea.value = "second";

        await (view as any).sendMessage("second");

        expect(plugin.api.chatStream).not.toHaveBeenCalled();
        expect(textarea.value).toBe("second");
    });
});

describe("ChatView.sendMessage — token streaming", () => {
    it("streams tokens into assistant text element", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "Hello" },
            { event: SSE_EVENT.TOKEN, data: " world" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "stream test";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const assistantBubble = messagesEl.children[1];
        const textEl = assistantBubble.find("lilbee-chat-content");
        expect(textEl!.textContent).toBe("Hello world");
    });
});

describe("ChatView.sendMessage — reasoning tokens", () => {
    it("renders reasoning as collapsible details block on done", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.REASONING, data: { token: "Let me think..." } },
            { event: SSE_EVENT.REASONING, data: { token: " about this." } },
            { event: SSE_EVENT.TOKEN, data: { token: "The answer is 42." } },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "explain";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const assistantBubble = messagesEl.children[1];
        const details = assistantBubble.find("lilbee-reasoning");
        expect(details).toBeTruthy();
        expect(details!.children[0].textContent).toBe("Reasoning");
        const textEl = assistantBubble.find("lilbee-chat-content");
        expect(textEl!.textContent).toBe("The answer is 42.");
        // Reasoning reads first: it sits above the answer in the bubble.
        const idxReasoning = assistantBubble.children.indexOf(details!);
        const idxAnswer = assistantBubble.children.indexOf(textEl!);
        expect(idxReasoning).toBeGreaterThanOrEqual(0);
        expect(idxReasoning).toBeLessThan(idxAnswer);
        // Collapsed once the answer arrived.
        expect(details!.getAttribute("open")).toBeNull();
    });

    it("streams reasoning live and expanded, above the answer, before the answer arrives", async () => {
        Notice.clear();
        const plugin = makePlugin();
        let release!: () => void;
        const gate = new Promise<void>((r) => {
            release = r;
        });
        const mockFn = vi.fn().mockReturnValue(
            (async function* () {
                yield { event: SSE_EVENT.REASONING, data: { token: "First, " } };
                yield { event: SSE_EVENT.REASONING, data: { token: "I weigh the options." } };
                await gate; // pause before any answer token
                yield { event: SSE_EVENT.TOKEN, data: { token: "Answer." } };
                yield { event: SSE_EVENT.DONE, data: {} };
            })(),
        );
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        container.find("lilbee-chat-textarea")!.value = "think first";
        container.find("lilbee-chat-send")!.trigger("click");

        // Let the reasoning events stream and the rAF render flush, still before the answer.
        await tick();
        await tick();

        const assistantBubble = messagesEl.children[1];
        const details = assistantBubble.find("lilbee-reasoning");
        expect(details).toBeTruthy();
        // Expanded while thinking, for immediate feedback.
        expect(details!.getAttribute("open")).toBe("");
        // Reasoning content already rendered before the answer/DONE arrived.
        const reasoningContent = assistantBubble.find("lilbee-reasoning-content");
        expect(reasoningContent!.textContent).toContain("First, I weigh the options.");
        // No answer text yet.
        expect(assistantBubble.find("lilbee-chat-content")!.textContent).toBe("");
        // Reasoning is above the (empty) answer in the bubble.
        const textEl = assistantBubble.find("lilbee-chat-content");
        expect(assistantBubble.children.indexOf(details!)).toBeLessThan(assistantBubble.children.indexOf(textEl!));

        release();
        await tick();
        await tick();
        // Once the answer streams in, the reasoning collapses.
        expect(details!.getAttribute("open")).toBeNull();
        expect(textEl!.textContent).toBe("Answer.");
    });

    it("coalesces live reasoning re-renders to one per frame", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const origRAF = globalThis.requestAnimationFrame;
        const frames: FrameRequestCallback[] = [];
        globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
            frames.push(cb);
            return frames.length;
        };
        try {
            const { mockFn, done } = makeStream([
                { event: SSE_EVENT.REASONING, data: { token: "a" } },
                { event: SSE_EVENT.REASONING, data: { token: "b" } },
                { event: SSE_EVENT.REASONING, data: { token: "c" } },
            ]);
            plugin.api.chatStream = mockFn;
            const view = new ChatView(makeLeaf(), plugin);
            await view.onOpen();
            const container = view.containerEl.children[1] as unknown as MockElement;
            container.find("lilbee-chat-textarea")!.value = "x";
            container.find("lilbee-chat-send")!.trigger("click");
            await done;
            await tick();
            // Three reasoning tokens, but the pending guard collapses them to a single frame.
            const reasoningFrames = frames.length;
            expect(reasoningFrames).toBe(1);
        } finally {
            globalThis.requestAnimationFrame = origRAF;
        }
    });

    it("a frame queued before DONE does not overwrite the final markdown render", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const origRAF = globalThis.requestAnimationFrame;
        const frames: FrameRequestCallback[] = [];
        globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
            frames.push(cb);
            return frames.length;
        };
        try {
            const { mockFn, done } = makeStream([
                { event: SSE_EVENT.TOKEN, data: { token: "**bold** answer" } },
                { event: SSE_EVENT.DONE, data: {} },
            ]);
            plugin.api.chatStream = mockFn;
            const view = new ChatView(makeLeaf(), plugin);
            await view.onOpen();
            const container = view.containerEl.children[1] as unknown as MockElement;
            container.find("lilbee-chat-textarea")!.value = "q";
            container.find("lilbee-chat-send")!.trigger("click");
            await done;
            await tick();
            const textEl = container.find("lilbee-chat-content")!;
            expect(textEl.textContent).toBe("**bold** answer"); // final markdown render
            // Fire the frame the token queued before DONE landed: it must not
            // repaint the plain-text stream over the rendered markdown.
            frames.forEach((cb) => cb(0));
            await tick();
            expect(textEl.textContent).toBe("**bold** answer");
        } finally {
            globalThis.requestAnimationFrame = origRAF;
        }
    });

    it("a reasoning frame queued before DONE does not overwrite the rendered reasoning", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const origRAF = globalThis.requestAnimationFrame;
        const frames: FrameRequestCallback[] = [];
        globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
            frames.push(cb);
            return frames.length;
        };
        try {
            const { mockFn, done } = makeStream([
                { event: SSE_EVENT.REASONING, data: { token: "*weighing* options" } },
                { event: SSE_EVENT.DONE, data: {} },
            ]);
            plugin.api.chatStream = mockFn;
            const view = new ChatView(makeLeaf(), plugin);
            await view.onOpen();
            const container = view.containerEl.children[1] as unknown as MockElement;
            container.find("lilbee-chat-textarea")!.value = "q";
            container.find("lilbee-chat-send")!.trigger("click");
            await done;
            await tick();
            const reasoningEl = container.find("lilbee-reasoning-content")!;
            expect(reasoningEl.textContent).toBe("*weighing* options"); // final markdown render
            frames.forEach((cb) => cb(0));
            await tick();
            expect(reasoningEl.textContent).toBe("*weighing* options");
        } finally {
            globalThis.requestAnimationFrame = origRAF;
        }
    });

    it("collapses the reasoning block when the stream is stopped mid-thinking", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const mockFn = vi.fn().mockReturnValue(
            (async function* () {
                yield { event: SSE_EVENT.REASONING, data: { token: "Considering the options" } };
                const abort = new Error("stopped");
                abort.name = "AbortError";
                throw abort;
            })(),
        );
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        container.find("lilbee-chat-textarea")!.value = "stop me";
        container.find("lilbee-chat-send")!.trigger("click");
        await tick();
        await tick();

        const assistantBubble = messagesEl.children[1];
        const details = assistantBubble.find("lilbee-reasoning");
        expect(details).toBeTruthy();
        // Stopping mid-thinking collapses the block instead of leaving it expanded above "(stopped)".
        expect(details!.getAttribute("open")).toBeNull();
    });

    it("renders a late reasoning block collapsed when the answer already started", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: { token: "Answer." } },
            { event: SSE_EVENT.REASONING, data: { token: "afterthought" } },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        container.find("lilbee-chat-textarea")!.value = "x";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const assistantBubble = messagesEl.children[1];
        const details = assistantBubble.find("lilbee-reasoning");
        expect(details).toBeTruthy();
        // The first answer token already arrived, so the block is created collapsed, not expanded.
        expect(details!.getAttribute("open")).toBeNull();
    });

    it("does not render details block when no reasoning tokens", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: { token: "Just an answer." } },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "simple";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const assistantBubble = messagesEl.children[1];
        const details = assistantBubble.find("lilbee-reasoning");
        expect(details).toBeNull();
    });

    // Cap-fire seam (max_reasoning_chars): when the server caps reasoning, it emits a marker
    // reasoning event then re-issues the chat; the second wave streams as TOKEN events.
    // The renderer must keep both waves in the same assistant bubble — no second turn spawned.
    it("keeps marker reasoning event + continuation TOKEN events in the same bubble", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.REASONING, data: { token: "Thinking out loud..." } },
            {
                event: SSE_EVENT.REASONING,
                data: { token: "[reasoning capped at 256 chars, asking for direct answer]" },
            },
            { event: SSE_EVENT.TOKEN, data: { token: "Short answer: 42." } },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "cap me";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        // Two bubbles total: user + one assistant. No second assistant bubble for the continuation.
        expect(messagesEl.children.length).toBe(2);
        const assistantBubbles = messagesEl.findAll("assistant");
        expect(assistantBubbles.length).toBe(1);

        const assistantBubble = messagesEl.children[1];
        const textEl = assistantBubble.find("lilbee-chat-content");
        expect(textEl!.textContent).toBe("Short answer: 42.");

        // Marker text lives inside the reasoning collapsible, not in the answer body.
        const details = assistantBubble.find("lilbee-reasoning");
        expect(details).toBeTruthy();
        const reasoningContent = assistantBubble.find("lilbee-reasoning-content");
        expect(reasoningContent!.textContent).toContain("[reasoning capped at 256 chars");
    });
});

describe("ChatView.sendMessage — sources", () => {
    it("renders sources section when sources event precedes done", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "Answer" },
            { event: SSE_EVENT.SOURCES, data: [makeSource({ source: "notes.md" })] },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "sources question";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const assistantBubble = messagesEl.children[1];
        expect(assistantBubble.find("lilbee-chat-sources")).not.toBeNull();
    });

    it("renders a details/summary inside sources section", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.SOURCES, data: [makeSource()] },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "details test";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const assistantBubble = messagesEl.children[1];
        const sourcesEl = assistantBubble.find("lilbee-chat-sources")!;
        const details = sourcesEl.children.find((c) => c.tagName === "DETAILS");
        expect(details).toBeDefined();
        const summary = details!.children.find((c) => c.tagName === "SUMMARY");
        expect(summary).toBeDefined();
        expect(summary!.textContent).toBe("Sources");
    });

    it("renders source chips inside details element with grouped layout", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.SOURCES, data: [makeSource({ source: "chip-doc.md" })] },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "chip test";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const assistantBubble = messagesEl.children[1];
        const chip = assistantBubble.find("lilbee-source-chip");
        expect(chip).not.toBeNull();
        expect(chip!.find("lilbee-source-chip-file")?.textContent).toBe("chip-doc.md");
    });

    it("does NOT render sources section when done has no prior sources", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "Answer" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "no sources test";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const assistantBubble = messagesEl.children[1];
        expect(assistantBubble.find("lilbee-chat-sources")).toBeNull();
    });

    it("pushes assistant message into history after done event", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn: mockFn1, done: done1 } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "Reply" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn1;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;

        textarea.value = "first question";
        container.find("lilbee-chat-send")!.trigger("click");
        await done1;
        await tick();

        // Second send — verify history passed to chatStream includes prior exchange
        const { mockFn: mockFn2, done: done2 } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn2;

        textarea.value = "second question";
        container.find("lilbee-chat-send")!.trigger("click");
        await done2;

        const historyArg = (mockFn2 as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<{
            role: string;
            content: string;
        }>;
        expect(historyArg.some((m) => m.role === "user" && m.content === "first question")).toBe(true);
        expect(historyArg.some((m) => m.role === "assistant" && m.content === "Reply")).toBe(true);
    });
});

describe("ChatView — extractBanner helper", () => {
    it("returns the string banner field when present", async () => {
        const { extractBanner } = await import("../../src/views/chat-view");
        expect(extractBanner({ banner: "watch out" })).toBe("watch out");
    });

    it("returns null for null / non-object data", async () => {
        const { extractBanner } = await import("../../src/views/chat-view");
        expect(extractBanner(null)).toBeNull();
        expect(extractBanner("just a string")).toBeNull();
        expect(extractBanner(42)).toBeNull();
    });

    it("returns null when the banner field is empty / missing / non-string", async () => {
        const { extractBanner } = await import("../../src/views/chat-view");
        expect(extractBanner({})).toBeNull();
        expect(extractBanner({ banner: "" })).toBeNull();
        expect(extractBanner({ banner: 42 })).toBeNull();
    });
});

describe("ChatView — plainStream helper", () => {
    it("strips bold and code markers but keeps the words and citations", async () => {
        const { plainStream } = await import("../../src/views/chat-view");
        expect(plainStream("lilbee uses **tensor-splitting** to spread it [1]")).toBe(
            "lilbee uses tensor-splitting to spread it [1]",
        );
        expect(plainStream("call `fit_split_ctx()` here")).toBe("call fit_split_ctx() here");
        expect(plainStream("plain text, no markers")).toBe("plain text, no markers");
    });
});

describe("ChatView.sendMessage — banner rendering", () => {
    it("renders a lilbee-chat-banner div above the assistant bubble when DONE.data.banner is set", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "Reply text" },
            { event: SSE_EVENT.DONE, data: { banner: "Search needs an embedding model." } },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "what?";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const banners = container.findAll("lilbee-chat-banner");
        expect(banners.length).toBe(1);
        expect(banners[0].textContent).toContain("Search needs an embedding model.");
    });

    it("does not render a banner element when DONE has no banner field", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "Reply" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "what?";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        expect(container.findAll("lilbee-chat-banner").length).toBe(0);
    });
});

describe("ChatView — chat_mode toolbar toggle", () => {
    it("does not render the toggle when /api/config omits chat_mode", async () => {
        const plugin = makePlugin();
        // Default makePlugin's config omits chat_mode -> toggle should be absent.
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(container.findAll("lilbee-chat-mode-btn").length).toBe(0);
    });

    it("renders Search/Chat segments and marks the active one when chat_mode is present", async () => {
        const plugin = makePlugin();
        (plugin.api as any).config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            embedding_model: "nomic-embed-text",
            chat_mode: "search",
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const buttons = container.findAll("lilbee-chat-mode-btn");
        expect(buttons.length).toBe(2);
        expect(buttons[0].textContent).toBe("Search");
        expect(buttons[1].textContent).toBe("Chat");
        expect(buttons[0].classList.contains("active")).toBe(true);
        expect(buttons[1].classList.contains("active")).toBe(false);
    });

    it("disables both segments with a tooltip when no embedding model is configured", async () => {
        const plugin = makePlugin();
        (plugin.api as any).config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            embedding_model: "",
            chat_mode: "chat",
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const buttons = container.findAll("lilbee-chat-mode-btn");
        expect(buttons.length).toBe(2);
        for (const btn of buttons) {
            expect((btn as any).disabled).toBe(true);
            expect(btn.getAttribute("title")).toBe("Configure an embedding model to enable Search.");
        }
    });

    it("treats absent embedding_model field (undefined) as no-embedding state", async () => {
        const plugin = makePlugin();
        (plugin.api as any).config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            // embedding_model intentionally absent to exercise the typeof guard
            chat_mode: "search",
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const buttons = container.findAll("lilbee-chat-mode-btn");
        for (const btn of buttons) {
            expect((btn as any).disabled).toBe(true);
        }
    });

    it("flips active class when switching from chat back to search", async () => {
        const plugin = makePlugin();
        (plugin.api as any).config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            embedding_model: "nomic-embed-text",
            chat_mode: "chat",
        });
        (plugin.api as any).updateConfig = vi
            .fn()
            .mockResolvedValue({ updated: ["chat_mode"], reindex_required: false });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const buttons = container.findAll("lilbee-chat-mode-btn");
        // Initially chat (index 1) is active.
        expect(buttons[1].classList.contains("active")).toBe(true);
        // Click search.
        buttons[0].trigger("click");
        await tick();
        expect(plugin.api.updateConfig).toHaveBeenCalledWith({ chat_mode: "search" });
        expect(buttons[0].classList.contains("active")).toBe(true);
        expect(buttons[1].classList.contains("active")).toBe(false);
    });

    it("PATCHes /api/config with the new mode when a segment is clicked", async () => {
        const plugin = makePlugin();
        (plugin.api as any).config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            embedding_model: "nomic-embed-text",
            chat_mode: "search",
        });
        (plugin.api as any).updateConfig = vi
            .fn()
            .mockResolvedValue({ updated: ["chat_mode"], reindex_required: false });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const buttons = container.findAll("lilbee-chat-mode-btn");
        buttons[1].trigger("click");
        await tick();
        expect(plugin.api.updateConfig).toHaveBeenCalledWith({ chat_mode: "chat" });
    });

    it("does not PATCH when clicking the already-active segment", async () => {
        const plugin = makePlugin();
        (plugin.api as any).config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            embedding_model: "nomic-embed-text",
            chat_mode: "search",
        });
        (plugin.api as any).updateConfig = vi.fn();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const buttons = container.findAll("lilbee-chat-mode-btn");
        buttons[0].trigger("click");
        await tick();
        expect(plugin.api.updateConfig).not.toHaveBeenCalled();
    });

    it("ignores clicks on disabled segments (no embedding configured)", async () => {
        const plugin = makePlugin();
        (plugin.api as any).config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            embedding_model: "",
            chat_mode: "chat",
        });
        (plugin.api as any).updateConfig = vi.fn();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const buttons = container.findAll("lilbee-chat-mode-btn");
        buttons[0].trigger("click");
        await tick();
        expect(plugin.api.updateConfig).not.toHaveBeenCalled();
    });

    it("surfaces a Notice when the PATCH fails", async () => {
        Notice.clear();
        const plugin = makePlugin();
        (plugin.api as any).config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            embedding_model: "nomic-embed-text",
            chat_mode: "search",
        });
        (plugin.api as any).updateConfig = vi.fn().mockRejectedValue(new Error("server down"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const buttons = container.findAll("lilbee-chat-mode-btn");
        buttons[1].trigger("click");
        await tick();
        expect(Notice.instances.some((n) => n.message.includes("Chat mode"))).toBe(true);
    });
});

describe("ChatView.sendMessage — error event", () => {
    it("shows a Notice and replaces the assistant bubble with a persistent error bubble", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.ERROR, data: "something went wrong" }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "error question";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        expect(Notice.instances[0].message).toBe("lilbee: something went wrong");
        // User bubble + persistent error bubble (replaces the pending assistant bubble)
        expect(messagesEl.children.length).toBe(2);
        expect(messagesEl.children[0].classList.contains("user")).toBe(true);
        expect(messagesEl.children[1].classList.contains("lilbee-chat-message-error")).toBe(true);
        const errorBubble = messagesEl.children[1] as MockElement;
        const errorText = errorBubble.find("lilbee-chat-error-text");
        expect(errorText).not.toBeNull();
        expect(errorText!.textContent).toBe("lilbee: something went wrong");
    });

    it("does not add error message to chat history", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.ERROR, data: "model not found" }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "test question";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        // History should only have the user message, not the error
        const history = (view as any).history;
        expect(history.length).toBe(1);
        expect(history[0].role).toBe("user");
    });
});

describe("ChatView.sendMessage — model-unavailable error routes to setup", () => {
    it("opens the SetupWizard and notifies when the error reports the provider is unavailable", async () => {
        Notice.clear();
        setupWizardOpen.mockClear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.ERROR, data: { message: "connection refused", code: "connection" } },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "hello";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        expect(setupWizardOpen).toHaveBeenCalledTimes(1);
        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_MODEL_UNAVAILABLE_SETUP)).toBe(true);
    });

    it("does not open the SetupWizard for an ordinary chat error", async () => {
        Notice.clear();
        setupWizardOpen.mockClear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.ERROR, data: "something went wrong" }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "hello";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        expect(setupWizardOpen).not.toHaveBeenCalled();
    });
});

describe("ChatView.sendMessage — API throws", () => {
    it("renders an error bubble, pops history, and shows a 'Chat failed' Notice when chatStream throws", async () => {
        Notice.clear();
        const plugin = makePlugin();
        let resolveThrown!: () => void;
        const thrown = new Promise<void>((r) => {
            resolveThrown = r;
        });
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                resolveThrown();
                throw new Error("server returned 500");
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "throw question";

        container.find("lilbee-chat-send")!.trigger("click");
        await thrown;
        await tick();

        // User bubble + error bubble both kept on screen — error must remain
        // visible inline so the failure isn't silent.
        expect(messagesEl.children.length).toBe(2);
        expect(messagesEl.children[0].classList.contains("user")).toBe(true);
        const errBubble = messagesEl.children[1];
        expect(errBubble.classList.contains("lilbee-chat-message-error")).toBe(true);
        expect(errBubble.attributes["role"]).toBe("alert");
        expect(errBubble.find("lilbee-chat-error-text")!.textContent).toContain("server returned 500");
        // Notice carries the underlying reason — no more generic "could not connect"
        expect(Notice.instances.some((n) => n.message.startsWith("Chat failed:"))).toBe(true);
        expect(Notice.instances.some((n) => n.message.includes("server returned 500"))).toBe(true);
        // History popped — assistant message did not finish
        expect((view as any).history.length).toBe(0);
    });

    it.each([
        ["managed", MESSAGES.ERROR_STREAM_INTERRUPTED_MANAGED],
        ["external", MESSAGES.ERROR_STREAM_INTERRUPTED_EXTERNAL],
    ])("maps a dead stream (TypeError: network error) to the %s-mode log pointer", async (mode, expected) => {
        Notice.clear();
        const plugin = makePlugin();
        (plugin.settings as { serverMode?: string }).serverMode = mode;
        let resolveThrown!: () => void;
        const thrown = new Promise<void>((r) => {
            resolveThrown = r;
        });
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                resolveThrown();
                throw new TypeError("network error");
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "dead stream question";

        container.find("lilbee-chat-send")!.trigger("click");
        await thrown;
        await tick();

        const errBubble = messagesEl.children[1];
        expect(errBubble.find("lilbee-chat-error-text")!.textContent).toBe(expected);
        expect(Notice.instances.some((n) => n.message === expected)).toBe(true);
    });

    it("surfaces 'Chat failed' Notice when handleSend itself throws synchronously", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "boom";
        // Sabotage the trim() call to throw — this models a class of "no fetch
        // fired, no error surfaced" failures we saw on wrapped multi-line input.
        Object.defineProperty(textarea, "value", {
            get() {
                throw new Error("textarea boom");
            },
        });

        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        expect(Notice.instances.some((n) => n.message.startsWith("Chat failed:"))).toBe(true);
        expect(Notice.instances.some((n) => n.message.includes("textarea boom"))).toBe(true);
    });
});

describe("ChatView.sendMessage — messagesEl null guard", () => {
    it("returns immediately if messagesEl is null (onOpen not called)", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        // Do NOT call onOpen — messagesEl stays null

        await (view as any).sendMessage("test");

        expect(plugin.api.chatStream).not.toHaveBeenCalled();
    });
});

describe("ChatView.clearChat — via toolbar button", () => {
    it("empties messagesEl when clear button is clicked", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "hi" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;

        textarea.value = "populate history";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        expect(messagesEl.children.length).toBeGreaterThan(0);

        container.find("lilbee-chat-clear")!.trigger("click");

        expect(messagesEl.children).toHaveLength(0);
    });

    it("resets history so next chatStream receives empty history", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn: mockFn1, done: done1 } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "hi" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn1;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;

        textarea.value = "first";
        container.find("lilbee-chat-send")!.trigger("click");
        await done1;
        await tick();

        // Clear history
        container.find("lilbee-chat-clear")!.trigger("click");

        // Send another message — history passed to chatStream must be empty
        const { mockFn: mockFn2, done: done2 } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn2;
        textarea.value = "after clear";
        container.find("lilbee-chat-send")!.trigger("click");
        await done2;

        const historyArg = (mockFn2 as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<unknown>;
        expect(historyArg).toHaveLength(0);
    });
});

describe("ChatView.onOpen — model selector", () => {
    it("creates a trigger button with class lilbee-chat-model-select", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const trigger = container.find("lilbee-chat-model-select");
        expect(trigger).not.toBeNull();
        expect(trigger!.tagName).toBe("BUTTON");
    });

    it("populates menu items from listModels API with catalog+Other pattern", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const menu = openRailMenu(container, "lilbee-chat-model-select")!;
        // With an empty featured catalog only the Other-section items remain,
        // and no separator is emitted.
        expect(menuTitles(menu)).toEqual(["llama3", "phi3"]);
        expect(menu.items.some((i) => i instanceof MockMenuSeparator)).toBe(false);
    });

    it("emits a separator between featured-installed and other-installed sections", async () => {
        Notice.clear();
        const plugin = makePlugin();
        // Override catalog so llama3 lives in the featured section; phi3 stays in Other.
        plugin.api.catalog = vi.fn().mockImplementation((params?: { task?: string }) => {
            if (params?.task === "chat") {
                return Promise.resolve(
                    ok({
                        total: 1,
                        limit: 50,
                        offset: 0,
                        models: [
                            {
                                hf_repo: "llama3",
                                gguf_filename: "",
                                display_name: "Llama 3",
                                size_gb: 8,
                                min_ram_gb: 16,
                                description: "Chat",
                                installed: true,
                                source: "native",
                                task: "chat",
                                featured: true,
                                downloads: 1,
                                quality_tier: "good",
                                param_count: "8B",
                            },
                        ],
                        has_more: false,
                    }),
                );
            }
            return Promise.resolve(ok({ total: 0, limit: 50, offset: 0, models: [], has_more: false }));
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const menu = openRailMenu(container, "lilbee-chat-model-select")!;
        expect(menu.items.length).toBe(3);
        expect((menu.items[0] as MockMenuItem).title).toContain("Llama 3");
        expect(menu.items[1]).toBeInstanceOf(MockMenuSeparator);
        expect((menu.items[2] as MockMenuItem).title).toBe("phi3");
    });

    it("appends provider suffix for non-native installed models", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.installedModels = vi.fn().mockResolvedValue({
            models: [
                { name: "llama3", source: "native" },
                { name: "phi3", source: "ollama" },
            ],
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const c = view.containerEl.children[1] as unknown as MockElement;
        const labels = menuTitles(openRailMenu(c, "lilbee-chat-model-select"));
        expect(labels).toContain("llama3");
        expect(labels).toContain("phi3 [ollama]");
        await view.onClose();
    });

    it("appends provider suffix when a featured entry has non-native source", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockImplementation((p?: { task?: string }) => {
            if (p?.task === "chat") {
                return Promise.resolve(
                    ok({
                        total: 1,
                        limit: 50,
                        offset: 0,
                        has_more: false,
                        models: [
                            {
                                hf_repo: "ollama/qwen3:8b",
                                gguf_filename: "",
                                display_name: "qwen3:8b",
                                size_gb: 0,
                                min_ram_gb: 0,
                                description: "",
                                installed: true,
                                source: "ollama",
                                task: "chat",
                                featured: true,
                                downloads: 0,
                                quality_tier: "",
                                param_count: "",
                            },
                        ],
                    }),
                );
            }
            return Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));
        });
        plugin.api.installedModels = vi.fn().mockResolvedValue({
            models: [{ name: "ollama/qwen3:8b", source: "ollama" }],
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const c = view.containerEl.children[1] as unknown as MockElement;
        const labels = menuTitles(openRailMenu(c, "lilbee-chat-model-select"));
        expect(labels).toContain("qwen3:8b [ollama]");
        await view.onClose();
    });

    it("orders the rail's hosted options local-server first (Ollama ahead of frontier)", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockImplementation((p?: { task?: string }) => {
            if (p?.task === "chat") {
                return Promise.resolve(
                    ok({
                        total: 2,
                        limit: 50,
                        offset: 0,
                        has_more: false,
                        models: [
                            {
                                hf_repo: "gemini/flash",
                                gguf_filename: "",
                                display_name: "Gemini Flash",
                                size_gb: 0,
                                min_ram_gb: 0,
                                description: "",
                                installed: false,
                                source: "frontier",
                                task: "chat",
                                featured: false,
                                downloads: 0,
                                quality_tier: "",
                                param_count: "",
                                provider: "Gemini",
                                key_status: "ready",
                            },
                            {
                                hf_repo: "ollama/llama3",
                                gguf_filename: "",
                                display_name: "Llama 3",
                                size_gb: 0,
                                min_ram_gb: 0,
                                description: "",
                                installed: false,
                                source: "ollama",
                                task: "chat",
                                featured: false,
                                downloads: 0,
                                quality_tier: "",
                                param_count: "",
                                provider: "Ollama",
                            },
                        ],
                    }),
                );
            }
            return Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));
        });
        plugin.api.installedModels = vi.fn().mockResolvedValue({ models: [] });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const c = view.containerEl.children[1] as unknown as MockElement;
        const labels = menuTitles(openRailMenu(c, "lilbee-chat-model-select"));
        const idxOllama = labels.indexOf("Llama 3 [Ollama]");
        const idxFrontier = labels.indexOf("Gemini Flash [Gemini]");
        expect(idxOllama).toBeGreaterThanOrEqual(0);
        expect(idxFrontier).toBeGreaterThan(idxOllama);
        await view.onClose();
    });

    it("lists a ready hosted (frontier) model and marks it checked when active", async () => {
        Notice.clear();
        const plugin = makePlugin();
        // Active chat model is the hosted ref; it is NOT in the installed registry.
        plugin.activeModel = "gemini/gemini-2.0-flash";
        plugin.api.config = vi.fn().mockResolvedValue({ chat_model: "gemini/gemini-2.0-flash" });
        plugin.api.catalog = vi.fn().mockImplementation((p?: { task?: string }) => {
            if (p?.task === "chat") {
                return Promise.resolve(
                    ok({
                        total: 1,
                        limit: 50,
                        offset: 0,
                        has_more: false,
                        models: [
                            {
                                hf_repo: "gemini/gemini-2.0-flash",
                                gguf_filename: "",
                                display_name: "gemini-2.0-flash",
                                size_gb: 0,
                                min_ram_gb: 0,
                                description: "",
                                installed: true,
                                source: "frontier",
                                task: "chat",
                                featured: false,
                                downloads: 0,
                                quality_tier: "",
                                param_count: "",
                                provider: "Gemini",
                                key_status: "ready",
                            },
                        ],
                    }),
                );
            }
            return Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));
        });
        plugin.api.installedModels = vi.fn().mockResolvedValue({ models: [] });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const c = view.containerEl.children[1] as unknown as MockElement;
        const hosted = openRailMenu(c, "lilbee-chat-model-select")!.itemTitled("gemini-2.0-flash [Gemini]");
        expect(hosted).not.toBeNull();
        expect(hosted!.checked).toBe(true);
        // The chip shows the active hosted model.
        expect(triggerText(c, "lilbee-chat-model-select")).toBe("gemini-2.0-flash [Gemini]");
        await view.onClose();
    });

    it("shows (connecting...) on both triggers when listModels fails", async () => {
        vi.useFakeTimers();
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.installedModels = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.config = vi.fn().mockRejectedValue(new Error("offline"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(triggerText(container, "lilbee-chat-model-select")).toBe("(connecting...)");
        expect(triggerText(container, "lilbee-embed-model-select")).toBe("(connecting...)");
        // No options while unreachable — clicking the chip opens nothing.
        expect(openRailMenu(container, "lilbee-chat-model-select")).toBeNull();

        await view.onClose();
        vi.useRealTimers();
    });

    it("picking a menu item calls setChatModel and updates activeModel", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        pickRailItem(container, "lilbee-chat-model-select", "phi3");
        await tick();

        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
        expect(plugin.activeModel).toBe("phi3");
        // The chip label updates to the picked model.
        expect(triggerText(container, "lilbee-chat-model-select")).toBe("phi3");
    });

    it("handleChatSelection shows Notice on setChatModel failure", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("fail")));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("bad-model");
        await tick();

        expect(Notice.instances.some((n) => n.message.includes("failed to switch"))).toBe(true);
    });

    it("4u1: chat-view setChatModel success refreshes the Settings tab", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();

        expect(plugin.refreshSettingsTab).toHaveBeenCalled();
    });

    it("4u1: chat-view setChatModel failure does NOT refresh the Settings tab", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("fail")));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("bad-model");
        await tick();

        expect(plugin.refreshSettingsTab).not.toHaveBeenCalled();
    });

    it("renders in-window with ESC dismissal when native menus are off", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        (view.app.vault as any).getConfig = vi.fn().mockReturnValue(false);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const menu = openRailMenu(container, "lilbee-chat-model-select")!;
        expect(menu.useNativeMenu).toBe(false);
    });

    it("renders natively when the vault's Native menus setting is on", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        (view.app.vault as any).getConfig = vi.fn().mockReturnValue(true);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const menu = openRailMenu(container, "lilbee-chat-model-select")!;
        expect(menu.useNativeMenu).toBe(true);
        expect((view.app.vault as any).getConfig).toHaveBeenCalledWith("nativeMenus");
    });

    it("defaults to native on macOS when the setting is unset", async () => {
        Notice.clear();
        Platform.isMacOS = true;
        try {
            const plugin = makePlugin();
            const view = new ChatView(makeLeaf(), plugin);
            await view.onOpen();
            await tick();

            const container = view.containerEl.children[1] as unknown as MockElement;
            const menu = openRailMenu(container, "lilbee-chat-model-select")!;
            expect(menu.useNativeMenu).toBe(true);
        } finally {
            Platform.isMacOS = false;
        }
    });

    it("defaults to the in-window menu when the vault has no getConfig API", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        (view.app.vault as any).getConfig = undefined;
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const menu = openRailMenu(container, "lilbee-chat-model-select")!;
        expect(menu.useNativeMenu).toBe(false);
    });

    it("skips the document ESC listener for native menus", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        (view.app.vault as any).getConfig = vi.fn().mockReturnValue(true);
        await view.onOpen();
        await tick();

        const addSpy = vi.fn();
        const origAdd = document.addEventListener;
        document.addEventListener = addSpy as typeof document.addEventListener;
        try {
            const container = view.containerEl.children[1] as unknown as MockElement;
            openRailMenu(container, "lilbee-chat-model-select");
            expect(addSpy).not.toHaveBeenCalled();
        } finally {
            document.addEventListener = origAdd;
        }
    });

    it("keyboard activation (detail 0) anchors the menu to the chip instead of the mouse", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const keyboardClick = {
            detail: 0,
            currentTarget: { getBoundingClientRect: () => ({ left: 12, bottom: 34 }) },
        } as unknown as MouseEvent;
        container.find("lilbee-chat-model-select")!.trigger("click", keyboardClick);

        const menu = Menu.instances[Menu.instances.length - 1];
        expect(menu.visible).toBe(true);
        expect(menu.position).toEqual({ x: 12, y: 34 });
    });

    it("excludes uninstalled catalog models from menu items", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const labels = menuTitles(openRailMenu(container, "lilbee-chat-model-select"));
        expect(labels).toContain("llama3");
        expect(labels).not.toContain("phi3 (not installed)");
        expect(labels).not.toContain("phi3");
    });

    it("selecting uninstalled catalog model triggers auto-pull with progress", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        async function* fakePull() {
            yield { event: "progress", data: { percent: 50 } };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(fakePull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();
        // Allow async IIFE to complete
        await new Promise((r) => setTimeout(r, 50));

        expect(plugin.api.pullModel).toHaveBeenCalledWith("phi3", "native", expect.any(AbortSignal));
        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
        expect(Notice.instances.some((n) => n.message === "lilbee: phi3 pulled and activated")).toBe(true);
    });

    it("auto-pull progress with no percent and no total skips update", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        async function* fakePull() {
            yield { event: "progress", data: {} };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(fakePull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
    });

    it("auto-pull progress with current/total computes percentage", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        async function* fakePull() {
            yield { event: "progress", data: { current: 50, total: 100 } };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(fakePull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
    });

    it("auto-pull failure shows failure notice", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        async function* failingPull(): AsyncGenerator<never> {
            throw new Error("network");
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(failingPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
    });

    it("auto-pull SSE_EVENT.ERROR shows failure notice and fails task", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        async function* errorPull() {
            yield { event: SSE_EVENT.ERROR, data: { message: "pull exploded" } };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(errorPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
        expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
    });

    it("auto-pull SSE_EVENT.ERROR with string data fails the task", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        async function* errorPull() {
            yield { event: SSE_EVENT.ERROR, data: "raw error string" };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(errorPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
        expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
    });

    it("auto-pull SSE_EVENT.ERROR with empty object uses fallback message", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        async function* errorPull() {
            yield { event: SSE_EVENT.ERROR, data: {} };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(errorPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
        expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
    });

    it("auto-pull AbortError shows Pull cancelled notice", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        async function* abortingPull(): AsyncGenerator<never> {
            throw abortError;
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(abortingPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
    });

    it("auto-pull non-Error throw uses 'unknown' in taskQueue", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        async function* failingPull(): AsyncGenerator<never> {
            throw "string error";
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(failingPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        const failed = plugin.taskQueue.completed.find((t: any) => t.status === "failed");
        expect(failed).toBeDefined();
        expect(failed!.error).toBe("unknown error");
    });

    it("auto-pull with total=0 does not send progress", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        async function* fakePull() {
            yield { event: "progress", data: { percent: 0 } };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(fakePull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        // Should still succeed without crashing
        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
    });
});

describe("ChatView.sendMessage — object token extraction", () => {
    it("extracts token property from object data", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: { token: "Hello" } },
            { event: SSE_EVENT.TOKEN, data: { token: " world" } },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "object test";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        const assistantBubble = messagesEl.children[1];
        const textEl = assistantBubble.find("lilbee-chat-content");
        expect(textEl!.textContent).toBe("Hello world");
    });

    it("extracts message property from error object data", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.ERROR, data: { message: "model not found" } }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "error object test";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        expect(Notice.instances[0].message).toBe("lilbee: model not found");
    });
});

describe("ChatView.sendMessage — loading indicator", () => {
    it("shows Stop text on send button while streaming", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const sendBtn = container.find("lilbee-chat-send")!;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "loading test";

        container.find("lilbee-chat-send")!.trigger("click");
        // Button should show "Stop" during streaming
        expect(sendBtn.textContent).toBe("Stop");

        await done;
        await tick();

        // Button should show "Send" after streaming
        expect(sendBtn.textContent).toBe("Send");
    });

    it("shows loading spinner in assistant bubble before first token", async () => {
        vi.useFakeTimers();
        try {
            Notice.clear();
            const plugin = makePlugin();
            const { mockFn, done } = makeStream([
                { event: SSE_EVENT.TOKEN, data: "Hi" },
                { event: SSE_EVENT.DONE, data: {} },
            ]);
            plugin.api.chatStream = mockFn;
            const view = new ChatView(makeLeaf(), plugin);
            await view.onOpen();
            const container = view.containerEl.children[1] as unknown as MockElement;
            const textarea = container.find("lilbee-chat-textarea")!;
            textarea.value = "spinner test";

            container.find("lilbee-chat-send")!.trigger("click");
            await vi.advanceTimersByTimeAsync(0);
            await done;
            await vi.advanceTimersByTimeAsync(0);

            // Advance past the minimum spinner display time (SPINNER_MIN_DISPLAY_MS = 800)
            await vi.advanceTimersByTimeAsync(900);

            // After streaming, spinner should be removed and text visible
            const messagesEl = container.find("lilbee-chat-messages")!;
            const assistantBubble = messagesEl.children[1];
            const textEl = assistantBubble.find("lilbee-chat-content");
            expect(textEl!.textContent).toBe("Hi");
            expect(textEl!.style.display).toBe("");
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("VaultFilePickerModal", () => {
    it("getItems returns vault files", () => {
        const onChoose = vi.fn();
        const files = [
            { path: "a.md", name: "a.md" },
            { path: "b.md", name: "b.md" },
        ];
        const leaf = makeLeaf();
        (leaf.app.vault as any).getFiles = vi.fn().mockReturnValue(files);
        const modal = new VaultFilePickerModal(leaf.app as any, onChoose);
        expect(modal.getItems()).toEqual(files);
    });

    it("getItemText returns file path", () => {
        const onChoose = vi.fn();
        const modal = new VaultFilePickerModal(makeLeaf().app as any, onChoose);
        const file = { path: "notes/test.md", name: "test.md" } as any;
        expect(modal.getItemText(file)).toBe("notes/test.md");
    });

    it("onChooseItem calls the provided callback", () => {
        const onChoose = vi.fn();
        const modal = new VaultFilePickerModal(makeLeaf().app as any, onChoose);
        const file = { path: "test.md", name: "test.md" } as any;
        modal.onChooseItem(file, undefined);
        expect(onChoose).toHaveBeenCalledWith(file);
    });
});

describe("ChatView — toolbar groups and tooltips", () => {
    it("groups chat dot+label+trigger in the first model chip", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const groups = container.findAll("lilbee-toolbar-group");
        expect(groups.length).toBe(2);
        const chatChip = groups[0];
        expect(chatChip.find("lilbee-model-chip-dot")).not.toBeNull();
        expect(chatChip.find("lilbee-model-chip-label")!.textContent).toBe("Chat");
        expect(chatChip.find("lilbee-chat-model-select")).not.toBeNull();
    });

    it("each role chip carries a clear text label", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const labels = container.findAll("lilbee-model-chip-label").map((l) => l.textContent);
        expect(labels).toEqual(["Chat", "Embed", "Vision", "Rerank"]);
    });

    it("spacer div separates groups from buttons", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const spacer = container.find("lilbee-toolbar-spacer");
        expect(spacer).not.toBeNull();
    });
});

describe("ChatView.onClose", () => {
    it("aborts stream and pull controllers", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await (view as any).onClose();
        // Should not throw
    });
});

describe("ChatView.onOpen — add file button opens menu", () => {
    let dialogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        dialogSpy = vi.spyOn(electronDialog, "showOpenDialog").mockResolvedValue({ canceled: true, filePaths: [] });
    });

    afterEach(() => {
        dialogSpy.mockRestore();
    });

    it("file picker calls addExternalFiles with selected paths", async () => {
        Notice.clear();
        const plugin = makePlugin();
        (plugin as any).addExternalFiles = vi.fn().mockResolvedValue(undefined);
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        dialogSpy
            .mockResolvedValueOnce({ canceled: false, filePaths: ["/home/user/doc.pdf", "/tmp/notes.md"] })
            .mockResolvedValueOnce({ canceled: false, filePaths: ["/home/user/docs"] });

        const container = view.containerEl.children[1] as unknown as MockElement;
        const addBtn = container.find("lilbee-chat-add-file")!;
        addBtn.trigger("click", { clientX: 0, clientY: 0 } as MouseEvent);
        const menu = Menu.instances[Menu.instances.length - 1];
        menu.itemTitled(MESSAGES.WIZARD_FILE_PICKER_DISK)!.click();
        menu.itemTitled(MESSAGES.WIZARD_FOLDER_PICKER_DISK)!.click();
        await tick();
        await tick();

        expect((plugin as any).addExternalFiles).toHaveBeenCalledWith(["/home/user/doc.pdf", "/tmp/notes.md"]);
        expect((plugin as any).addExternalFiles).toHaveBeenCalledWith(["/home/user/docs"]);
    });

    it("does nothing when dialog is canceled", async () => {
        Notice.clear();
        const plugin = makePlugin();
        (plugin as any).addExternalFiles = vi.fn().mockResolvedValue(undefined);
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const addBtn = container.find("lilbee-chat-add-file")!;
        addBtn.trigger("click", { clientX: 0, clientY: 0 } as MouseEvent);
        Menu.instances[Menu.instances.length - 1].itemTitled(MESSAGES.WIZARD_FILE_PICKER_DISK)!.click();
        await tick();

        expect((plugin as any).addExternalFiles).not.toHaveBeenCalled();
    });

    it("shows Notice when dialog throws", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        dialogSpy.mockRejectedValue(new Error("no dialog"));

        const container = view.containerEl.children[1] as unknown as MockElement;
        const addBtn = container.find("lilbee-chat-add-file")!;
        addBtn.trigger("click", { clientX: 0, clientY: 0 } as MouseEvent);
        Menu.instances[Menu.instances.length - 1].itemTitled(MESSAGES.WIZARD_FILE_PICKER_DISK)!.click();
        await tick();

        expect(Notice.instances.some((n) => n.message.includes("could not open file picker"))).toBe(true);
    });

    it("crawl web menu item opens the CrawlModal", async () => {
        Notice.clear();
        const { CrawlModal } = await import("../../src/views/crawl-modal");
        (CrawlModal as unknown as ReturnType<typeof vi.fn>).mockClear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        container.find("lilbee-chat-add-file")!.trigger("click", { clientX: 0, clientY: 0 } as MouseEvent);
        const crawlItem = Menu.instances[Menu.instances.length - 1].itemTitled(MESSAGES.WIZARD_CRAWL_WEB)!;
        expect(crawlItem.icon).toBe("globe");
        crawlItem.click();

        expect(CrawlModal).toHaveBeenCalled();
    });

    it("uog: ESC keydown dismisses the paperclip menu", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const addEvents: Array<
            [string, EventListenerOrEventListenerObject, boolean | AddEventListenerOptions | undefined]
        > = [];
        const removeEvents: Array<
            [string, EventListenerOrEventListenerObject, boolean | EventListenerOptions | undefined]
        > = [];
        const origAdd = document.addEventListener.bind(document);
        const origRemove = document.removeEventListener.bind(document);
        document.addEventListener = vi.fn((type: string, listener: any, opts: any) => {
            addEvents.push([type, listener, opts]);
            return origAdd(type, listener, opts);
        }) as typeof document.addEventListener;
        document.removeEventListener = vi.fn((type: string, listener: any, opts: any) => {
            removeEvents.push([type, listener, opts]);
            return origRemove(type, listener, opts);
        }) as typeof document.removeEventListener;

        try {
            const container = view.containerEl.children[1] as unknown as MockElement;
            const addBtn = container.find("lilbee-chat-add-file")!;
            addBtn.trigger("click", { clientX: 0, clientY: 0 } as MouseEvent);

            const escHandler = addEvents.find(([type]) => type === "keydown");
            expect(escHandler).toBeDefined();
            // Simulate ESC: invoke the handler — it should call menu.hide(),
            // which fires onHide → document.removeEventListener("keydown", …).
            const handler = escHandler![1] as (e: KeyboardEvent) => void;
            handler({ key: "Escape", preventDefault: vi.fn() } as unknown as KeyboardEvent);

            const escRemoval = removeEvents.find(([type]) => type === "keydown");
            expect(escRemoval).toBeDefined();
            expect(Menu.instances[Menu.instances.length - 1].visible).toBe(false);
        } finally {
            document.addEventListener = origAdd as typeof document.addEventListener;
            document.removeEventListener = origRemove as typeof document.removeEventListener;
        }
    });

    it("uog: non-ESC keys are ignored and do not dismiss the menu", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const addEvents: Array<[string, EventListenerOrEventListenerObject]> = [];
        const removeEvents: Array<[string, EventListenerOrEventListenerObject]> = [];
        const origAdd = document.addEventListener.bind(document);
        const origRemove = document.removeEventListener.bind(document);
        document.addEventListener = vi.fn((type: string, listener: any, opts: any) => {
            addEvents.push([type, listener]);
            return origAdd(type, listener, opts);
        }) as typeof document.addEventListener;
        document.removeEventListener = vi.fn((type: string, listener: any, opts: any) => {
            removeEvents.push([type, listener]);
            return origRemove(type, listener, opts);
        }) as typeof document.removeEventListener;

        try {
            const container = view.containerEl.children[1] as unknown as MockElement;
            const addBtn = container.find("lilbee-chat-add-file")!;
            addBtn.trigger("click", { clientX: 0, clientY: 0 } as MouseEvent);

            const handler = addEvents.find(([type]) => type === "keydown")![1] as (e: KeyboardEvent) => void;
            const preventDefault = vi.fn();
            handler({ key: "a", preventDefault } as unknown as KeyboardEvent);

            // 'a' is not ESC — handler is a no-op, menu stays open, listener still registered.
            expect(preventDefault).not.toHaveBeenCalled();
            expect(removeEvents.some(([type]) => type === "keydown")).toBe(false);
        } finally {
            document.addEventListener = origAdd as typeof document.addEventListener;
            document.removeEventListener = origRemove as typeof document.removeEventListener;
        }
    });
});

describe("ChatView — branch coverage for guards", () => {
    it("scheduleRender dedup: second call while pending is a no-op", async () => {
        Notice.clear();
        const plugin = makePlugin();

        // Block rAF so renderPending stays true between tokens
        let rafCallbacks: FrameRequestCallback[] = [];
        const origRAF = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
            rafCallbacks.push(cb);
            return 0;
        };

        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: { token: "a" } },
            { event: SSE_EVENT.TOKEN, data: { token: "b" } },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "test dedup";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;

        // Only one rAF callback should be queued despite two TOKEN events
        // (the second scheduleRender hits the renderPending guard)
        expect(rafCallbacks.length).toBe(1);

        // Flush the rAF
        for (const cb of rafCallbacks) cb(0);
        rafCallbacks = [];
        await tick();

        globalThis.requestAnimationFrame = origRAF;
    });
});

describe("ChatView — cancel chat stream (stop button)", () => {
    it("clicking send button during streaming aborts and preserves partial content with (stopped)", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                yield { event: SSE_EVENT.TOKEN, data: { token: "partial" } };
                throw abortError;
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        const sendBtn = container.find("lilbee-chat-send")!;
        textarea.value = "abort test";

        sendBtn.trigger("click");
        await tick();

        const messagesEl = container.find("lilbee-chat-messages")!;
        const assistantBubble = messagesEl.children[1];
        const textEl = assistantBubble.find("lilbee-chat-content")!;
        // Partial content preserved with (stopped) appended via renderMarkdown
        expect(textEl.textContent).toContain("partial");
        expect(textEl.textContent).toContain("(stopped)");
        // Send button restored
        expect(sendBtn.textContent).toBe("Send");
    });

    it("abort with no content yet shows (stopped) text", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                throw abortError;
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "abort empty test";

        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        const messagesEl = container.find("lilbee-chat-messages")!;
        const assistantBubble = messagesEl.children[1];
        const textEl = assistantBubble.find("lilbee-chat-content")!;
        expect(textEl.textContent).toBe("(stopped)");
    });

    it("send button shows Stop during streaming and Send after abort", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                yield { event: SSE_EVENT.TOKEN, data: { token: "hi" } };
                throw abortError;
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        const sendBtn = container.find("lilbee-chat-send")!;
        textarea.value = "stop test";

        sendBtn.trigger("click");
        // Button changes to Stop synchronously
        expect(sendBtn.textContent).toBe("Stop");

        await tick();

        // After abort resolves, button is back to Send
        expect(sendBtn.textContent).toBe("Send");
    });

    it("clicking Stop button calls abort on streamController", async () => {
        Notice.clear();
        const plugin = makePlugin();
        let resolveWait!: () => void;
        const waitPromise = new Promise<void>((r) => {
            resolveWait = r;
        });
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                yield { event: SSE_EVENT.TOKEN, data: { token: "hi" } };
                await waitPromise;
                yield { event: SSE_EVENT.DONE, data: {} };
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        const sendBtn = container.find("lilbee-chat-send")!;
        textarea.value = "stop click test";

        sendBtn.trigger("click"); // starts stream
        await tick();

        expect(sendBtn.textContent).toBe("Stop");
        const abortSpy = vi.spyOn((view as any).streamController, "abort");
        sendBtn.trigger("click"); // clicks Stop
        expect(abortSpy).toHaveBeenCalled();

        resolveWait();
        await tick();
    });
});

describe("ChatView — enqueueAddFile", () => {
    it("enqueueAddFile calls plugin.addToLilbee", async () => {
        Notice.clear();
        const plugin = makePlugin();
        (plugin as any).addToLilbee = vi.fn().mockResolvedValue(undefined);
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const file = { path: "test.md", name: "test.md" } as any;
        (view as any).enqueueAddFile(file);
        await tick();

        expect((plugin as any).addToLilbee).toHaveBeenCalledWith(file);
    });
});

describe("ChatView — save to vault", () => {
    it("creates a save button with class lilbee-chat-save in toolbar", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const saveBtn = container.find("lilbee-chat-save");
        expect(saveBtn).not.toBeNull();
        expect(saveBtn!.tagName).toBe("BUTTON");
    });

    it("shows Nothing to save Notice when history is empty", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const leaf = makeLeaf();
        const view = new ChatView(leaf, plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        container.find("lilbee-chat-save")!.trigger("click");
        await tick();

        expect(Notice.instances.some((n) => n.message === "Nothing to save")).toBe(true);
    });

    it("creates lilbee folder and vault note when history exists", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const leaf = makeLeaf();
        (leaf.app as any).vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
        (leaf.app as any).vault.createFolder = vi.fn().mockResolvedValue(undefined);
        (leaf.app as any).vault.create = vi.fn().mockResolvedValue(undefined);

        const view = new ChatView(leaf, plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;

        // Send a message to populate history
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: { token: "Reply" } },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "Hello";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        // Now save
        container.find("lilbee-chat-save")!.trigger("click");
        await tick();

        expect((leaf.app as any).vault.getAbstractFileByPath).toHaveBeenCalledWith("lilbee");
        expect((leaf.app as any).vault.createFolder).toHaveBeenCalledWith("lilbee");
        expect((leaf.app as any).vault.create).toHaveBeenCalledWith(
            expect.stringMatching(/^lilbee\/chat-\d{4}-\d{2}-\d{2}-\d{6}\.md$/),
            expect.stringContaining("**User**: Hello"),
        );
        expect((leaf.app as any).vault.create).toHaveBeenCalledWith(
            expect.any(String),
            expect.stringContaining("**Assistant**: Reply"),
        );
        expect(Notice.instances.some((n) => n.message.startsWith("Saved to"))).toBe(true);
    });

    it("does not create folder when it already exists", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const leaf = makeLeaf();
        (leaf.app as any).vault.getAbstractFileByPath = vi.fn().mockReturnValue({ path: "lilbee" });
        (leaf.app as any).vault.createFolder = vi.fn().mockResolvedValue(undefined);
        (leaf.app as any).vault.create = vi.fn().mockResolvedValue(undefined);

        const view = new ChatView(leaf, plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;

        // Populate history
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: { token: "Hi" } },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "Hey";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        container.find("lilbee-chat-save")!.trigger("click");
        await tick();

        expect((leaf.app as any).vault.createFolder).not.toHaveBeenCalled();
        expect((leaf.app as any).vault.create).toHaveBeenCalled();
    });

    it("shows Failed to save chat Notice when vault.create throws", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const leaf = makeLeaf();
        (leaf.app as any).vault.getAbstractFileByPath = vi.fn().mockReturnValue(null);
        (leaf.app as any).vault.createFolder = vi.fn().mockResolvedValue(undefined);
        (leaf.app as any).vault.create = vi.fn().mockRejectedValue(new Error("write failed"));

        const view = new ChatView(leaf, plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;

        // Populate history
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: { token: "Reply" } },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "Hello";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        container.find("lilbee-chat-save")!.trigger("click");
        await tick();

        expect(Notice.instances.some((n) => n.message === "Failed to save chat")).toBe(true);
    });
});

describe("ChatView.onClose — aborts both controllers", () => {
    it("aborts streamController when active", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";

        let resolveWait!: () => void;
        const waitPromise = new Promise<void>((r) => {
            resolveWait = r;
        });
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                yield { event: SSE_EVENT.TOKEN, data: { token: "partial" } };
                await waitPromise;
                yield { event: SSE_EVENT.DONE, data: {} };
            })(),
        );

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "stream test";
        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        // streamController should be set
        expect((view as any).streamController).not.toBeNull();

        const abortSpy = vi.spyOn((view as any).streamController, "abort");
        await view.onClose();

        expect(abortSpy).toHaveBeenCalled();

        // Clean up: unblock the stream
        resolveWait();
        await tick();
    });

    it("aborts pullController when active", async () => {
        Notice.clear();
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
            ],
        });

        let resolveWait!: () => void;
        const waitPromise = new Promise<void>((r) => {
            resolveWait = r;
        });
        async function* slowPull() {
            yield { event: "progress", data: { percent: 50 } };
            await waitPromise;
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(slowPull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        (view as any).handleChatSelection("phi3");
        await tick();

        // pullController should be set
        expect((view as any).pullController).not.toBeNull();

        const abortSpy = vi.spyOn((view as any).pullController, "abort");
        await view.onClose();

        expect(abortSpy).toHaveBeenCalled();

        // Clean up
        resolveWait();
        await new Promise((r) => setTimeout(r, 50));
    });
});

describe("ChatView.sendMessage — does not send generation overrides", () => {
    it("omits the options argument so the server uses its own cfg", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "hi";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;

        expect(plugin.api.chatStream).toHaveBeenCalledWith("hi", [], 5, expect.any(AbortSignal), undefined, "all", {
            summary: "",
            sessionId: null,
        });
    });
});

describe("ChatView.sendMessage — forwards searchChunkType", () => {
    it("passes 'wiki' when the setting is 'wiki'", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.searchChunkType = "wiki";
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "q";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        expect(plugin.api.chatStream).toHaveBeenCalledWith("q", [], 5, expect.any(AbortSignal), undefined, "wiki", {
            summary: "",
            sessionId: null,
        });
    });

    it("passes 'raw' when the setting is 'raw'", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.searchChunkType = "raw";
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "q";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        expect(plugin.api.chatStream).toHaveBeenCalledWith("q", [], 5, expect.any(AbortSignal), undefined, "raw", {
            summary: "",
            sessionId: null,
        });
    });
});

describe("ChatView.createToolbar — search mode buttons", () => {
    it("renders search mode buttons in toolbar", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const modeGroup = container.find("lilbee-search-mode");
        expect(modeGroup).not.toBeNull();
        const buttons = modeGroup!.children.filter((c: any) => c.tagName === "BUTTON");
        expect(buttons).toHaveLength(3);
        expect(buttons[0].textContent).toBe("All");
        expect(buttons[1].textContent).toBe("Wiki");
        expect(buttons[2].textContent).toBe("Raw");
        await view.onClose();
    });

    it("clicking a search mode button updates settings.searchChunkType", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.searchChunkType = "all";
        plugin.saveSettings = vi.fn();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const modeGroup = container.find("lilbee-search-mode")!;
        const buttons = modeGroup.children.filter((c: any) => c.tagName === "BUTTON");

        buttons[1].trigger("click");
        expect(plugin.settings.searchChunkType).toBe("wiki");
        expect(plugin.saveSettings).toHaveBeenCalled();
        await view.onClose();
    });

    it("does not render the scope picker when wikiEnabled is false", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.wikiEnabled = false;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(container.find("lilbee-search-mode")).toBeNull();
        await view.onClose();
    });

    it("shows wiki button when wikiEnabled is true", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.wikiEnabled = true;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const modeGroup = container.find("lilbee-search-mode")!;
        const buttons = modeGroup.children.filter((c: any) => c.tagName === "BUTTON");
        expect(buttons).toHaveLength(3);
        expect(buttons[1].textContent).toBe("Wiki");
        await view.onClose();
    });

    it("falls back searchChunkType from wiki to all when wikiEnabled is false", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.wikiEnabled = false;
        plugin.settings.searchChunkType = "wiki";
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        expect(plugin.settings.searchChunkType).toBe("all");
        await view.onClose();
    });
});

describe("ChatView.createToolbar — model chips", () => {
    it("chat and embed chips carry colored dots and labels (no role icons)", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const groups = container.findAll("lilbee-toolbar-group");
        expect(groups.length).toBe(2);
        expect(groups[0].find("is-chat")).not.toBeNull();
        expect(groups[0].find("lilbee-model-chip-label")!.textContent).toBe("Chat");
        expect(groups[1].find("is-embed")).not.toBeNull();
        expect(groups[1].find("lilbee-model-chip-label")!.textContent).toBe("Embed");
        // The OCR eye toggle was removed from the chat view.
        expect(container.find("lilbee-ocr-toggle")).toBeNull();
    });

    it("every role chip and both mode buttons carry an explanatory tooltip (aria-label)", async () => {
        Notice.clear();
        const plugin = makePlugin();
        // chat_mode must be set for the Search/Chat toggle to render.
        plugin.api.config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            embedding_model: "nomic-embed-text",
            chat_mode: "search",
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        const chips = container.findAll("lilbee-model-chip");
        for (const chip of chips) {
            expect((chip.attributes["aria-label"] ?? "").length).toBeGreaterThan(0);
        }
        // The four role tooltips are distinct and name the role's purpose.
        const labels = chips.map((c) => c.attributes["aria-label"]);
        expect(labels.some((l) => /Chat model/.test(l))).toBe(true);
        expect(labels.some((l) => /Embedding model/.test(l))).toBe(true);
        expect(labels.some((l) => /Vision model/.test(l))).toBe(true);
        expect(labels.some((l) => /Reranker/.test(l))).toBe(true);

        const modeBtns = container.findAll("lilbee-chat-mode-btn");
        expect(modeBtns.length).toBe(2);
        expect(modeBtns[0].attributes["aria-label"]).toMatch(/Search your vault/);
        expect(modeBtns[1].attributes["aria-label"]).toMatch(/Chat with the model/);
    });
});

describe("ChatView — offline retry", () => {
    beforeEach(() => {
        Notice.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("retries fetching models after failure", async () => {
        const plugin = makePlugin();
        let online = false;
        const offline = () => Promise.reject(new Error("offline"));
        const installedOk = (p?: { task?: string }) => {
            if (p?.task === "chat" || p === undefined) {
                return Promise.resolve({ models: [{ name: "llama3", source: "native" }] });
            }
            return Promise.resolve({ models: [] });
        };
        const catalogOk = () => Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));
        plugin.api.installedModels = vi.fn().mockImplementation((p?: { task?: string }) => {
            return online ? installedOk(p) : offline();
        });
        plugin.api.config = vi.fn().mockImplementation(() => {
            return online ? Promise.resolve({ chat_model: "llama3" }) : offline();
        });
        plugin.api.catalog = vi.fn().mockImplementation(() => {
            return online ? catalogOk() : offline();
        });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        // Let the first (rejected) promise settle
        await vi.advanceTimersByTimeAsync(0);

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(triggerText(container, "lilbee-chat-model-select")).toBe("(connecting...)");

        // Server comes back online; the 5s retry hits the new mocks.
        online = true;
        await vi.advanceTimersByTimeAsync(5000);

        expect(triggerText(container, "lilbee-chat-model-select")).toBe("llama3");

        await view.onClose();
    });

    it("shows offline notice only at threshold", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.installedModels = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.config = vi.fn().mockRejectedValue(new Error("offline"));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        // First failure — no notice yet (connecting state)
        expect(Notice.instances.filter((n) => n.message.includes("Is it running?")).length).toBe(0);

        // Second failure — still no notice
        await vi.advanceTimersByTimeAsync(5000);
        expect(Notice.instances.filter((n) => n.message.includes("Is it running?")).length).toBe(0);

        // Third failure — notice fires at threshold
        await vi.advanceTimersByTimeAsync(5000);
        expect(Notice.instances.filter((n) => n.message.includes("Is it running?")).length).toBe(1);

        // Fourth failure — no additional notice
        await vi.advanceTimersByTimeAsync(5000);
        expect(Notice.instances.filter((n) => n.message.includes("Is it running?")).length).toBe(1);

        await view.onClose();
    });

    it("clears retry timer and retryCount on successful fetch", async () => {
        const plugin = makePlugin();
        let online = false;
        const offline = () => Promise.reject(new Error("offline"));
        plugin.api.installedModels = vi.fn().mockImplementation((p?: { task?: string }) => {
            if (!online) return offline();
            if (p?.task === "chat" || p === undefined) {
                return Promise.resolve({ models: [{ name: "llama3", source: "native" }] });
            }
            return Promise.resolve({ models: [] });
        });
        plugin.api.config = vi.fn().mockImplementation(() => {
            return online ? Promise.resolve({ chat_model: "llama3" }) : offline();
        });
        plugin.api.catalog = vi.fn().mockImplementation(() => {
            return online
                ? Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }))
                : offline();
        });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        // After first failure, retryTimer should be set
        expect((view as any).retryTimer).not.toBeNull();
        expect((view as any).retryCount).toBe(1);

        // Advance past retry — success
        online = true;
        await vi.advanceTimersByTimeAsync(5000);

        expect((view as any).retryTimer).toBeNull();
        expect((view as any).retryCount).toBe(0);

        await view.onClose();
    });

    it("clears retry timer and retryCount on close", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.installedModels = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.config = vi.fn().mockRejectedValue(new Error("offline"));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        expect((view as any).retryTimer).not.toBeNull();
        expect((view as any).retryCount).toBe(1);

        await view.onClose();

        expect((view as any).retryTimer).toBeNull();
        expect((view as any).retryCount).toBe(0);
    });

    it("keeps a single connecting label across retries", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.installedModels = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.config = vi.fn().mockRejectedValue(new Error("offline"));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(triggerText(container, "lilbee-chat-model-select")).toBe("(connecting...)");

        // Advance past retry — second failure; label unchanged, not duplicated.
        await vi.advanceTimersByTimeAsync(5000);
        expect(triggerText(container, "lilbee-chat-model-select")).toBe("(connecting...)");

        await view.onClose();
    });

    it("shows (connecting...) then (offline) after threshold", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.installedModels = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.config = vi.fn().mockRejectedValue(new Error("offline"));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;

        // Failure 1 — connecting
        await vi.advanceTimersByTimeAsync(0);
        expect(triggerText(container, "lilbee-chat-model-select")).toBe("(connecting...)");

        // Failure 2 — still connecting
        await vi.advanceTimersByTimeAsync(5000);
        expect(triggerText(container, "lilbee-chat-model-select")).toBe("(connecting...)");

        // Failure 3 — switches to offline
        await vi.advanceTimersByTimeAsync(5000);
        expect(triggerText(container, "lilbee-chat-model-select")).toBe("(offline)");

        await view.onClose();
    });

    it("retries when server reachable but no models installed", async () => {
        const plugin = makePlugin();
        let callCount = 0;
        plugin.api.installedModels = vi.fn().mockImplementation((p?: { task?: string }) => {
            if (p?.task === "chat") {
                callCount++;
                if (callCount <= 2) return Promise.resolve({ models: [] });
                return Promise.resolve({ models: [{ name: "llama3", source: "native" }] });
            }
            return Promise.resolve({ models: [] });
        });
        plugin.api.config = vi.fn().mockImplementation(() => {
            return Promise.resolve({ chat_model: callCount <= 2 ? "" : "llama3" });
        });
        plugin.api.catalog = vi.fn().mockImplementation((p?: { task?: string }) => {
            if (p?.task === "chat") {
                return Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));
            }
            return Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));
        });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        // First success with no installed models — retry scheduled
        expect((view as any).retryTimer).not.toBeNull();

        // Second call — still no installed models
        await vi.advanceTimersByTimeAsync(5000);
        expect((view as any).retryTimer).not.toBeNull();

        // Third call — models now installed, retry stops
        await vi.advanceTimersByTimeAsync(5000);
        expect((view as any).retryTimer).toBeNull();

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(menuTitles(openRailMenu(container, "lilbee-chat-model-select"))).toContain("llama3");

        await view.onClose();
    });

    it("stops no-installed-models retry on close", async () => {
        const plugin = makePlugin();
        plugin.api.installedModels = vi.fn().mockResolvedValue({ models: [] });
        plugin.api.config = vi.fn().mockResolvedValue({ chat_model: "" });
        plugin.api.catalog = vi
            .fn()
            .mockResolvedValue(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        expect((view as any).retryTimer).not.toBeNull();

        await view.onClose();

        expect((view as any).retryTimer).toBeNull();
    });

    it("Browse Catalog button in empty state opens CatalogModal", async () => {
        const { CatalogModal } = await import("../../src/views/catalog-modal");
        const plugin = makePlugin();
        plugin.api.installedModels = vi.fn().mockResolvedValue({ models: [] });
        plugin.api.config = vi.fn().mockResolvedValue({ chat_model: "" });
        plugin.api.catalog = vi
            .fn()
            .mockResolvedValue(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        const container = (view as any).messagesEl as MockElement;
        const emptyState = container.find("lilbee-chat-empty-state")!;
        expect(emptyState).not.toBeNull();
        const browseBtns = emptyState.children.filter(
            (c: MockElement) => c.tagName === "BUTTON" && c.textContent === "Browse Catalog",
        );
        expect(browseBtns.length).toBe(1);
        browseBtns[0].trigger("click");

        expect(CatalogModal).toHaveBeenCalled();
        await view.onClose();
    });

    it("resets retryCount on success after failures", async () => {
        const plugin = makePlugin();
        let online = false;
        const offline = () => Promise.reject(new Error("offline"));
        plugin.api.installedModels = vi.fn().mockImplementation((p?: { task?: string }) => {
            if (!online) return offline();
            if (p?.task === "chat" || p === undefined) {
                return Promise.resolve({ models: [{ name: "llama3", source: "native" }] });
            }
            return Promise.resolve({ models: [] });
        });
        plugin.api.config = vi.fn().mockImplementation(() => {
            return online ? Promise.resolve({ chat_model: "llama3" }) : offline();
        });
        plugin.api.catalog = vi.fn().mockImplementation(() => {
            return online
                ? Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }))
                : offline();
        });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        // Failure 1
        await vi.advanceTimersByTimeAsync(0);
        expect((view as any).retryCount).toBe(1);

        // Failure 2
        await vi.advanceTimersByTimeAsync(5000);
        expect((view as any).retryCount).toBe(2);

        // Server comes back online; the next retry succeeds.
        online = true;
        await vi.advanceTimersByTimeAsync(5000);
        expect((view as any).retryCount).toBe(0);

        await view.onClose();
    });
});

describe("ChatView — embedding model selector", () => {
    beforeEach(() => {
        Notice.clear();
        confirmModalResult = true;
    });

    it("creates an embedding trigger button with class lilbee-embed-model-select", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const trigger = container.find("lilbee-embed-model-select");
        expect(trigger).not.toBeNull();
        expect(trigger!.tagName).toBe("BUTTON");
    });

    it("populates embedding menu items from catalog API", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(menuTitles(openRailMenu(container, "lilbee-embed-model-select"))).toEqual(["nomic-embed-text"]);
    });

    it("marks the active embedding model as checked and shows it on the chip", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const menu = openRailMenu(container, "lilbee-embed-model-select")!;
        expect(menu.itemTitled("nomic-embed-text")!.checked).toBe(true);
        expect(triggerText(container, "lilbee-embed-model-select")).toBe("nomic-embed-text");
    });

    it("shows fallback option from config when catalog is empty", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi
            .fn()
            .mockResolvedValue(ok({ total: 0, limit: 50, offset: 0, models: [], has_more: false }));
        plugin.api.config = vi.fn().mockResolvedValue({ embedding_model: "custom-embed" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const menu = openRailMenu(container, "lilbee-embed-model-select")!;
        expect(menuTitles(menu)).toEqual(["custom-embed"]);
        expect(menu.itemTitled("custom-embed")!.checked).toBe(true);
        expect(triggerText(container, "lilbee-embed-model-select")).toBe("custom-embed");
    });

    it("shows fallback option when catalog returns error", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("fail")));
        plugin.api.config = vi.fn().mockResolvedValue({ embedding_model: "fallback-embed" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(menuTitles(openRailMenu(container, "lilbee-embed-model-select"))).toEqual(["fallback-embed"]);
    });

    it("shows no menu when catalog is empty and config has no embedding_model", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi
            .fn()
            .mockResolvedValue(ok({ total: 0, limit: 50, offset: 0, models: [], has_more: false }));
        plugin.api.config = vi.fn().mockResolvedValue({});
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(openRailMenu(container, "lilbee-embed-model-select")).toBeNull();
        expect(triggerText(container, "lilbee-embed-model-select")).toBe("");
    });

    it("shows confirmation modal when embedding model is changed", async () => {
        const { ConfirmModal } = await import("../../src/views/confirm-modal");
        const plugin = makePlugin();
        // Active embedding differs from the picked item so the pick is a real change.
        plugin.api.config = vi.fn().mockResolvedValue({ chat_model: "llama3", embedding_model: "previous-embed" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        pickRailItem(container, "lilbee-embed-model-select", "nomic-embed-text");
        await tick();

        expect(ConfirmModal).toHaveBeenCalled();
    });

    it("calls setEmbeddingModel and shows notices on confirm", async () => {
        const plugin = makePlugin();
        plugin.api.config = vi.fn().mockResolvedValue({ chat_model: "llama3", embedding_model: "previous-embed" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        pickRailItem(container, "lilbee-embed-model-select", "nomic-embed-text");
        await tick();

        expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("nomic-embed-text");
        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_EMBEDDING_UPDATED)).toBe(true);
        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_REINDEX_REQUIRED)).toBe(true);
        expect(plugin.triggerSync).toHaveBeenCalled();
        // 4u1: embedding success path must also refresh the Settings tab so
        // the dropdown / subtitle reflect the new active embedding.
        expect(plugin.refreshSettingsTab).toHaveBeenCalled();
    });

    it("4u1: embedding setEmbeddingModel failure does NOT refresh the Settings tab", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.config = vi.fn().mockResolvedValue({ chat_model: "llama3", embedding_model: "previous-embed" });
        plugin.api.setEmbeddingModel = vi.fn().mockResolvedValue(err(new Error("nope")));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        pickRailItem(container, "lilbee-embed-model-select", "nomic-embed-text");
        await tick();

        expect(plugin.refreshSettingsTab).not.toHaveBeenCalled();
    });

    /** Simulate picking a value absent from the menu: optimistic label, then the handler. */
    function pickEmbeddingValue(view: ChatView, value: string): void {
        (view as any).embeddingTriggerTextEl.setText(value);
        (view as any).handleEmbeddingSelection(value);
    }

    it("re-picking the active embedding model is a no-op (no confirm, no API call)", async () => {
        const { ConfirmModal } = await import("../../src/views/confirm-modal");
        (ConfirmModal as unknown as ReturnType<typeof vi.fn>).mockClear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        // "nomic-embed-text" is the active (checked) item.
        pickRailItem(container, "lilbee-embed-model-select", "nomic-embed-text");
        await tick();

        expect(ConfirmModal).not.toHaveBeenCalled();
        expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
    });

    it("reverts the chip label on cancel", async () => {
        confirmModalResult = false;
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        pickEmbeddingValue(view, "other-model");
        await tick();

        expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
        expect(triggerText(container, "lilbee-embed-model-select")).toBe("nomic-embed-text");
    });

    it("reverts the chip label and shows notice on setEmbeddingModel failure", async () => {
        const plugin = makePlugin();
        plugin.api.setEmbeddingModel = vi.fn().mockResolvedValue(err(new Error("fail")));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        pickEmbeddingValue(view, "other-model");
        await tick();

        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_FAILED_EMBEDDING)).toBe(true);
        expect(triggerText(container, "lilbee-embed-model-select")).toBe("nomic-embed-text");
    });

    it("reverts the chip label and shows notice on setEmbeddingModel network error", async () => {
        const plugin = makePlugin();
        plugin.api.setEmbeddingModel = vi.fn().mockResolvedValue(err(new Error("network")));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        pickEmbeddingValue(view, "other-model");
        await tick();

        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_FAILED_EMBEDDING)).toBe(true);
        expect(triggerText(container, "lilbee-embed-model-select")).toBe("nomic-embed-text");
    });

    it("rail-level Browse more button opens the full catalog", async () => {
        const { CatalogModal } = await import("../../src/views/catalog-modal");
        (CatalogModal as unknown as ReturnType<typeof vi.fn>).mockClear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        // Browse more is a rail-level action at the far right, not inside the Embed chip.
        const browseBtn = container.find("lilbee-rail-browse")!;
        expect(browseBtn).not.toBeNull();
        expect(browseBtn.textContent).toBe(MESSAGES.BUTTON_BROWSE_MORE);
        const embedChip = container.find("lilbee-toolbar-group-embed")!;
        expect(embedChip.find("lilbee-embed-browse")).toBeNull();

        browseBtn.trigger("click");
        // No task filter — opens the catalog's Discover view across all roles.
        expect(CatalogModal).toHaveBeenCalledWith(expect.anything(), plugin);
    });

    it("shows connecting label on embedding select when offline", async () => {
        vi.useFakeTimers();
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.installedModels = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.config = vi.fn().mockRejectedValue(new Error("offline"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(triggerText(container, "lilbee-embed-model-select")).toBe("(connecting...)");

        await view.onClose();
        vi.useRealTimers();
    });

    it("shows offline label on embedding trigger after threshold", async () => {
        vi.useFakeTimers();
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.installedModels = vi.fn().mockRejectedValue(new Error("offline"));
        plugin.api.config = vi.fn().mockRejectedValue(new Error("offline"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        // Failure 1
        await vi.advanceTimersByTimeAsync(0);
        // Failure 2
        await vi.advanceTimersByTimeAsync(5000);
        // Failure 3 — threshold
        await vi.advanceTimersByTimeAsync(5000);

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(triggerText(container, "lilbee-embed-model-select")).toBe("(offline)");

        await view.onClose();
        vi.useRealTimers();
    });

    it("embedding group has lilbee-toolbar-group-embed class", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const embedGroup = container.find("lilbee-toolbar-group-embed");
        expect(embedGroup).not.toBeNull();
        expect(embedGroup!.find("lilbee-embed-model-select")).not.toBeNull();
    });

    it("filters to only installed models from catalog", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockResolvedValue(
            ok({
                total: 2,
                limit: 50,
                offset: 0,
                models: [
                    {
                        name: "nomic-embed-text",
                        display_name: "nomic-embed-text",
                        size_gb: 0.3,
                        min_ram_gb: 1,
                        description: "Embedding",
                        installed: true,
                        source: "native",
                        hf_repo: "nomic",
                        tag: "",
                        task: "embedding",
                        featured: true,
                        downloads: 1000,
                        quality_tier: "good",
                    },
                    {
                        name: "bge-large",
                        display_name: "bge-large",
                        size_gb: 1.3,
                        min_ram_gb: 4,
                        description: "BGE",
                        installed: false,
                        source: "native",
                        hf_repo: "bge",
                        tag: "",
                        task: "embedding",
                        featured: false,
                        downloads: 500,
                        quality_tier: "good",
                    },
                ],
                has_more: false,
            }),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(menuTitles(openRailMenu(container, "lilbee-embed-model-select"))).toEqual(["nomic-embed-text"]);
    });

    it("handles null config gracefully", async () => {
        const plugin = makePlugin();
        plugin.api.config = vi.fn().mockRejectedValue(new Error("fail"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        // Should still show models from catalog, just none marked active
        const menu = openRailMenu(container, "lilbee-embed-model-select")!;
        expect(menuTitles(menu)).toEqual(["nomic-embed-text"]);
        expect(menu.itemTitled("nomic-embed-text")!.checked).toBe(false);
    });

    it("revertEmbeddingTrigger no-ops when embeddingTriggerTextEl is null", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        (view as any).embeddingTriggerTextEl = null;
        // Should not throw
        (view as any).revertEmbeddingTrigger("test");
    });

    it("revertEmbeddingTrigger falls back to a server refresh when the previous value is not in options", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const fetchSpy = vi
            .spyOn(view as unknown as { fetchAndFillSelectors: () => Promise<void> }, "fetchAndFillSelectors")
            .mockResolvedValue();

        (view as any).revertEmbeddingTrigger("totally-unknown-model");

        expect(fetchSpy).toHaveBeenCalled();
    });

    it("handles null catalog result in fillEmbeddingSelector", async () => {
        const plugin = makePlugin();
        // Chat catalog still succeeds — only the embedding catalog rejects, so the
        // embedding selector falls back to displaying the active model from config.
        plugin.api.catalog = vi.fn().mockImplementation((p?: { task?: string }) => {
            if (p?.task === "chat") {
                return Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));
            }
            return Promise.reject(new Error("fail"));
        });
        plugin.api.config = vi.fn().mockResolvedValue({ embedding_model: "fallback" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        expect(menuTitles(openRailMenu(container, "lilbee-embed-model-select"))).toEqual(["fallback"]);
        expect(triggerText(container, "lilbee-embed-model-select")).toBe("fallback");
    });

    it("fillEmbeddingSelector with null embeddingTriggerTextEl does not throw", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        (view as any).embeddingTriggerTextEl = null;
        // Should not throw
        (view as any).fillEmbeddingSelector(null, null);
    });
});

describe("ChatView — queue-full notice on auto-pull", () => {
    it("shows NOTICE_QUEUE_FULL when enqueue returns null", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.taskQueue.enqueue = vi.fn(() => null) as any;
        plugin.api.pullModel = vi.fn();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await (view as any).autoPullAndSet({ name: "phi3" });
        expect(Notice.instances.map((n: any) => n.message)).toContain(MESSAGES.NOTICE_QUEUE_FULL);
        expect(plugin.api.pullModel).not.toHaveBeenCalled();
    });
});

describe("ChatView — autoPullAndSet post-pull set failure", () => {
    it("completes pull task and shows ERROR_SET_MODEL notice when setChatModel returns err", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.pullModel = vi.fn().mockImplementation(async function* () {
            // happy pull, no events
        });
        plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("activate-failed")));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const entry = {
            hf_repo: "microsoft/Phi-3-mini-4k-Instruct-GGUF",
            display_name: "Phi 3 Mini",
            size_gb: 2.3,
            min_ram_gb: 4,
        };
        await (view as any).autoPullAndSet(entry);
        const setFailed = MESSAGES.ERROR_SET_MODEL.replace("{model}", "Phi 3 Mini");
        expect(Notice.instances.map((n: any) => n.message)).toContain(setFailed);
        expect(plugin.taskQueue.completed.some((t: any) => t.status === "done")).toBe(true);
        expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(false);
    });
});

describe("ChatView — Send is a no-op while a stream is in flight", () => {
    it("second Enter while sending does not wipe textarea or fire a second request", async () => {
        const plugin = makePlugin();
        let resolveStream!: () => void;
        plugin.api.chatStream = vi.fn().mockImplementation(async function* () {
            await new Promise<void>((r) => {
                resolveStream = r;
            });
            yield { event: SSE_EVENT.DONE, data: null };
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;

        const textarea = container.find("lilbee-chat-textarea")!;
        (textarea as any).value = "first";
        textarea.trigger("keydown", { key: "Enter", shiftKey: false, preventDefault: vi.fn() });
        await tick();

        expect(plugin.api.chatStream).toHaveBeenCalledTimes(1);

        // Second Enter while sending — typed text stays, no extra call
        (textarea as any).value = "second";
        textarea.trigger("keydown", { key: "Enter", shiftKey: false, preventDefault: vi.fn() });
        await tick();
        expect(plugin.api.chatStream).toHaveBeenCalledTimes(1);
        expect((textarea as any).value).toBe("second");

        resolveStream();
    });
});

describe("ChatView — role separation on main-screen selectors", () => {
    beforeEach(() => {
        Notice.clear();
    });

    // Invariant pinned: the plugin reads only models.chat + catalog({task: EMBEDDING}),
    // delegating role filtering to the server. Chat/embedding selectors render exactly
    // what those server sections hand back — no extra plugin-side filter, no leakage
    // from sibling vision/reranker sections.
    it("main-screen selectors read only chat + embedding sections, echoing server data verbatim", async () => {
        const plugin = makePlugin();
        // Contaminated models.chat.installed: server has (incorrectly) mixed vision/reranker
        // names into the chat role. The plugin must still render them — this proves the
        // plugin is NOT filtering client-side; filtering is the server's job.
        // Server-side filtering: chat task returns the installed list scoped to chat
        // (which here contains some "contaminated" rows the server lets through). The
        // chat picker echoes that list verbatim — no client-side re-filter.
        plugin.api.installedModels = vi.fn().mockImplementation((p?: { task?: string }) => {
            if (p?.task === "chat") {
                return Promise.resolve({
                    models: [
                        { name: "llama3", source: "native" },
                        { name: "Qwen/Qwen2-VL-7B-Instruct", source: "native" },
                        { name: "BAAI/bge-reranker-v2-m3", source: "native" },
                    ],
                });
            }
            return Promise.resolve({
                models: [
                    { name: "llama3", source: "native" },
                    { name: "nomic-embed-text", source: "native" },
                    { name: "Qwen/Qwen2-VL-7B-Instruct", source: "native" },
                    { name: "BAAI/bge-reranker-v2-m3", source: "native" },
                ],
            });
        });
        plugin.api.catalog = vi.fn().mockImplementation((p?: { task?: string }) => {
            if (p?.task === "chat") {
                return Promise.resolve(ok({ total: 0, limit: 50, offset: 0, has_more: false, models: [] }));
            }
            return Promise.resolve(
                ok({
                    total: 1,
                    limit: 50,
                    offset: 0,
                    models: [
                        {
                            hf_repo: "nomic-embed-text",
                            gguf_filename: "",
                            display_name: "nomic-embed-text",
                            size_gb: 0.3,
                            min_ram_gb: 1,
                            description: "embedding",
                            installed: true,
                            source: "native",
                            task: "embedding",
                            featured: true,
                            downloads: 100,
                            quality_tier: "good",
                            param_count: "",
                        },
                    ],
                    has_more: false,
                }),
            );
        });
        plugin.api.config = vi.fn().mockResolvedValue({ chat_model: "llama3", embedding_model: "nomic-embed-text" });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        await tick();

        // The plugin must ask the server for the embedding task specifically.
        expect(plugin.api.catalog).toHaveBeenCalledWith({ task: "embedding" });

        const container = view.containerEl.children[1] as unknown as MockElement;
        const chatItems = menuTitles(openRailMenu(container, "lilbee-chat-model-select"));
        const embedItems = menuTitles(openRailMenu(container, "lilbee-embed-model-select"));

        // Set equality (sorted, order-independent): the chat menu echoes
        // models.chat.installed verbatim — role filtering belongs to the server.
        expect([...chatItems].sort()).toEqual(
            ["llama3", "Qwen/Qwen2-VL-7B-Instruct", "BAAI/bge-reranker-v2-m3"].map(displayLabelForRef).sort(),
        );
        expect(chatItems).toHaveLength(3);

        // Embedding menu is populated from catalog({task: EMBEDDING}), which the
        // server scopes to embedding models. If the plugin were reading from listModels
        // or a broader catalog call, vision/reranker names could leak here.
        expect(embedItems).toEqual(["nomic-embed-text"]);
    });
});

describe("ChatView — textarea disabled while a chat stream is in flight", () => {
    it("disables the textarea synchronously when a message is sent", async () => {
        const plugin = makePlugin();
        let resolveStream!: () => void;
        plugin.api.chatStream = vi.fn().mockImplementation(async function* () {
            await new Promise<void>((r) => {
                resolveStream = r;
            });
            yield { event: SSE_EVENT.DONE, data: null };
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")! as MockElement;
        (textarea as any).value = "in-flight";

        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        expect((textarea as any).disabled).toBe(true);

        resolveStream();
        await tick();
    });

    it("re-enables the textarea after the stream completes normally", async () => {
        const plugin = makePlugin();
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                yield { event: SSE_EVENT.DONE, data: null };
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")! as MockElement;
        (textarea as any).value = "complete";

        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        expect((textarea as any).disabled).toBe(false);
    });

    it("re-enables the textarea after the stream is aborted", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                throw abortError;
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")! as MockElement;
        (textarea as any).value = "abort";

        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        expect((textarea as any).disabled).toBe(false);
    });

    it("re-enables the textarea after a generic stream error", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                throw new Error("server returned 500");
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")! as MockElement;
        (textarea as any).value = "boom";

        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        expect((textarea as any).disabled).toBe(false);
    });
});

describe("ChatView.sendMessage — RateLimitedError", () => {
    it("renders an inline error bubble with rate-limit copy and shows a busy Notice when retry-after is present", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { RateLimitedError } = await import("../../src/api");
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                throw new RateLimitedError(7);
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "rate limited q";

        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        const messagesEl = container.find("lilbee-chat-messages")!;
        const errBubble = messagesEl.children[1];
        expect(errBubble.classList.contains("lilbee-chat-message-error")).toBe(true);
        expect(errBubble.attributes["role"]).toBe("alert");
        expect(errBubble.find("lilbee-chat-error-text")!.textContent).toContain("Try again in 7 seconds");
        expect(Notice.instances.some((n) => n.message.includes("Try again in 7 seconds"))).toBe(true);
        expect(Notice.instances.some((n) => n.message.startsWith("Chat failed:"))).toBe(false);
        expect((view as any).history.length).toBe(0);
    });

    it("falls back to a generic 'try again in a moment' notice when retry-after is null", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { RateLimitedError } = await import("../../src/api");
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                throw new RateLimitedError(null);
            })(),
        );
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        container.find("lilbee-chat-textarea")!.value = "no retry-after";

        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        expect(Notice.instances.some((n) => n.message.includes("Try again in a moment"))).toBe(true);
    });
});

describe("ChatView — optional model rail (Vision, Rerank)", () => {
    beforeEach(() => {
        Notice.clear();
        vi.clearAllMocks();
    });

    function entry(name: string, task: string, source = "native") {
        return {
            hf_repo: name,
            gguf_filename: "",
            display_name: name,
            size_gb: 1,
            min_ram_gb: 1,
            description: "",
            quality_tier: "good",
            installed: true,
            source,
            task,
            featured: true,
            downloads: 1,
            param_count: "",
        };
    }

    /** Drive vision/rerank catalogs (role-filtered, like the server) + active models. */
    function configureRoles(
        plugin: LilbeePlugin,
        opts: { vision?: string[]; rerank?: string[]; visionActive?: string; rerankActive?: string },
    ): void {
        (plugin.api as any).catalog = vi.fn().mockImplementation((p?: { task?: string }) => {
            const models =
                p?.task === "vision"
                    ? (opts.vision ?? []).map((n) => entry(n, "vision"))
                    : p?.task === "rerank"
                      ? (opts.rerank ?? []).map((n) => entry(n, "rerank"))
                      : p?.task === "chat"
                        ? []
                        : [entry("nomic-embed-text", "embedding")];
            return Promise.resolve(ok({ total: models.length, limit: 50, offset: 0, models, has_more: false }));
        });
        (plugin.api as any).config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            embedding_model: "nomic-embed-text",
            vision_model: opts.visionActive ?? null,
            reranker_model: opts.rerankActive ?? null,
        });
    }

    it("renders Vision and Rerank chips (no divider) with labels", async () => {
        const plugin = makePlugin();
        configureRoles(plugin, {});
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        expect(container.find("lilbee-model-rail-divider")).toBeNull();
        const labels = container.findAll("lilbee-model-chip-label").map((l) => l.textContent);
        expect(labels).toContain("Chat");
        expect(labels).toContain("Embed");
        expect(labels).toContain("Vision");
        expect(labels).toContain("Rerank");
    });

    it("Vision chip with no installed model still shows a menu with Disabled + Browse", async () => {
        const { CatalogModal } = await import("../../src/views/catalog-modal");
        (CatalogModal as unknown as ReturnType<typeof vi.fn>).mockClear();
        const plugin = makePlugin();
        configureRoles(plugin, { vision: [], rerank: [] });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        const menu = openRailMenu(container, "lilbee-vision-model-select")!;
        expect(menuTitles(menu)).toEqual(["(disabled)", "Browse catalog…"]);
        menu.itemTitled("Browse catalog…")!.click();
        expect(CatalogModal).toHaveBeenCalledWith(expect.anything(), plugin, "vision");
    });

    it("renders a Vision menu with Disabled + models + Browse when installed", async () => {
        const plugin = makePlugin();
        configureRoles(plugin, { vision: ["llava-7b", "qwen-vl"], visionActive: "llava-7b" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        const menu = openRailMenu(container, "lilbee-vision-model-select")!;
        expect(menuTitles(menu)).toEqual(["(disabled)", "llava-7b", "qwen-vl", "Browse catalog…"]);
        expect(menu.itemTitled("llava-7b")!.checked).toBe(true);
        expect(triggerText(container, "lilbee-vision-model-select")).toBe("llava-7b");
    });

    it("includes hosted (LiteLLM) vision models with a Hosted suffix", async () => {
        const plugin = makePlugin();
        (plugin.api as any).catalog = vi.fn().mockImplementation((p?: { task?: string }) => {
            const models =
                p?.task === "vision"
                    ? [entry("llava-7b", "vision"), entry("gpt-4o", "vision", "frontier")]
                    : p?.task === "chat"
                      ? []
                      : p?.task === "rerank"
                        ? []
                        : [entry("nomic-embed-text", "embedding")];
            return Promise.resolve(ok({ total: models.length, limit: 50, offset: 0, models, has_more: false }));
        });
        (plugin.api as any).config = vi.fn().mockResolvedValue({
            chat_model: "llama3",
            embedding_model: "nomic-embed-text",
            vision_model: "llava-7b",
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        const titles = menuTitles(openRailMenu(container, "lilbee-vision-model-select"));
        expect(titles).toContain("llava-7b");
        expect(titles.some((t) => t.includes("gpt-4o") && t.includes("Hosted"))).toBe(true);
    });

    it("fills the dot with is-active when a Vision model is active", async () => {
        const plugin = makePlugin();
        configureRoles(plugin, { vision: ["llava-7b"], visionActive: "llava-7b" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        const visionDot = container.findAll("is-vision")[0];
        expect(visionDot.classList.contains("is-active")).toBe(true);
    });

    it("leaves the dot hollow (no is-active) and marks the chip off when Vision is disabled", async () => {
        const plugin = makePlugin();
        configureRoles(plugin, { vision: ["llava-7b"], visionActive: "" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        const visionDot = container.findAll("is-vision")[0];
        expect(visionDot.classList.contains("is-active")).toBe(false);
        // The chip shows the disabled label, and the menu checks Disabled.
        expect(triggerText(container, "lilbee-vision-model-select")).toBe("(disabled)");
        expect(openRailMenu(container, "lilbee-vision-model-select")!.itemTitled("(disabled)")!.checked).toBe(true);
    });

    it("picking a Vision model calls setVisionModel and refreshes", async () => {
        const plugin = makePlugin();
        configureRoles(plugin, { vision: ["llava-7b", "qwen-vl"], visionActive: "llava-7b" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        pickRailItem(container, "lilbee-vision-model-select", "qwen-vl");
        await tick();

        expect(plugin.api.setVisionModel).toHaveBeenCalledWith("qwen-vl");
        expect(plugin.fetchActiveModel).toHaveBeenCalled();
    });

    it("picking Disabled turns Vision off via setVisionModel('')", async () => {
        const plugin = makePlugin();
        configureRoles(plugin, { vision: ["llava-7b"], visionActive: "llava-7b" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        pickRailItem(container, "lilbee-vision-model-select", "(disabled)");
        await tick();

        expect(plugin.api.setVisionModel).toHaveBeenCalledWith("");
    });

    it("picking Browse catalog… from the Vision menu opens the catalog and keeps the chip label", async () => {
        const { CatalogModal } = await import("../../src/views/catalog-modal");
        (CatalogModal as unknown as ReturnType<typeof vi.fn>).mockClear();
        const plugin = makePlugin();
        configureRoles(plugin, { vision: ["llava-7b"], visionActive: "llava-7b" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        pickRailItem(container, "lilbee-vision-model-select", "Browse catalog…");

        expect(CatalogModal).toHaveBeenCalledWith(expect.anything(), plugin, "vision");
        expect(plugin.api.setVisionModel).not.toHaveBeenCalled();
        expect(triggerText(container, "lilbee-vision-model-select")).toBe("llava-7b");
    });

    it("surfaces a Notice when setVisionModel fails", async () => {
        const plugin = makePlugin();
        configureRoles(plugin, { vision: ["llava-7b", "qwen-vl"], visionActive: "llava-7b" });
        (plugin.api as any).setVisionModel = vi.fn().mockResolvedValue(err(new Error("boom")));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        pickRailItem(container, "lilbee-vision-model-select", "qwen-vl");
        await tick();

        expect(Notice.instances.some((n) => n.message.includes("Vision"))).toBe(true);
    });

    it("picking a Rerank model calls setRerankerModel", async () => {
        const plugin = makePlugin();
        configureRoles(plugin, { rerank: ["bge-reranker", "jina-reranker"], rerankActive: "bge-reranker" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        pickRailItem(container, "lilbee-rerank-model-select", "jina-reranker");
        await tick();

        expect(plugin.api.setRerankerModel).toHaveBeenCalledWith("jina-reranker");
    });

    it("Rerank chip Browse catalog… opens the catalog pre-filtered to rerank", async () => {
        const { CatalogModal } = await import("../../src/views/catalog-modal");
        (CatalogModal as unknown as ReturnType<typeof vi.fn>).mockClear();
        const plugin = makePlugin();
        configureRoles(plugin, { rerank: [] });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        pickRailItem(container, "lilbee-rerank-model-select", "Browse catalog…");
        expect(CatalogModal).toHaveBeenCalledWith(expect.anything(), plugin, "rerank");
    });
});

describe("ChatView — null-element guard branches", () => {
    it("fetchAndFillSelectors skips trigger updates when both trigger text els are null", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        // Null both triggers so the success-path optional chains take the false branch.
        (view as any).chatTriggerTextEl = null;
        (view as any).embeddingTriggerTextEl = null;
        (view as any).fetchAndFillSelectors();
        await tick();
        // No throw, and a successful fetch leaves retryCount at 0.
        expect((view as any).retryCount).toBe(0);
    });

    it("fetchAndFillSelectors catch path skips triggers when both are null", async () => {
        Notice.clear();
        const plugin = makePlugin();
        // Force the Promise.all chain to reject so the catch runs.
        (plugin.api as any).catalog = vi.fn().mockRejectedValue(new Error("boom"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        (view as any).chatTriggerTextEl = null;
        (view as any).embeddingTriggerTextEl = null;
        const before = (view as any).retryCount;
        (view as any).fetchAndFillSelectors();
        await tick();
        // Catch ran (retryCount incremented) without touching the null triggers.
        expect((view as any).retryCount).toBeGreaterThan(before);
        // Stop the retry timer the catch scheduled.
        const t = (view as any).retryTimer;
        if (t) clearTimeout(t);
    });

    it("refreshRail re-syncs the rail via fetchAndFillSelectors", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const spy = vi.spyOn(view as any, "fetchAndFillSelectors").mockImplementation(() => {});
        view.refreshRail();
        expect(spy).toHaveBeenCalled();
    });

    it("clearChat no-ops when messagesEl is null", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        (view as any).history = [{ role: "user", content: "hi" }];
        (view as any).messagesEl = null;
        (view as any).clearChat();
        expect((view as any).history).toHaveLength(0);
    });

    it("sendMessage tolerates null sendBtn and textareaEl through start and finally", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "hi" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        // Null the controls so the start (768/769) and finally (843/846) guards
        // take their false branches; messagesEl stays so the body still runs.
        (view as any).sendBtn = null;
        (view as any).textareaEl = null;
        await (view as any).sendMessage("hello");
        await done;
        await tick();
        expect((view as any).sending).toBe(false);
    });

    it("sendMessage scroll-follow no-ops when messagesEl becomes null mid-stream", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "hi" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const messagesEl = (view as any).messagesEl as MockElement;
        const sendPromise = (view as any).sendMessage("hi");
        // Drop messagesEl so the deferred renderFollowing hits its null-element branch.
        (view as any).messagesEl = null;
        await sendPromise;
        await done;
        await tick();
        await tick();
        // The user bubble was still appended before messagesEl was nulled.
        expect(messagesEl.findAll("lilbee-chat-message").length).toBeGreaterThan(0);
    });
});

describe("ChatView — pull stream non-error events", () => {
    it("autoPullAndSet ignores SSE events that are neither progress nor error", async () => {
        Notice.clear();
        const plugin = makePlugin();
        // Stream yields a DONE-like event that is neither PROGRESS nor ERROR,
        // exercising the else-if false branch (711).
        const { mockFn } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.pullModel = mockFn;
        plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const entry = {
            hf_repo: "acme/model",
            display_name: "Acme",
            size_gb: 1,
            min_ram_gb: 1,
        };
        await (view as any).autoPullAndSet(entry);
        await tick();
        // Pull completed and the model was activated despite no progress events.
        expect(plugin.api.setChatModel).toHaveBeenCalledWith("acme/model");
    });
});

describe("ChatView — confirm-pull declined", () => {
    it("does not auto-pull when the user declines the confirm modal", async () => {
        Notice.clear();
        const { ConfirmPullModal } = await import("../../src/views/confirm-pull-modal");
        (ConfirmPullModal as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(function () {
            return {
                open: vi.fn(),
                get result() {
                    return Promise.resolve(false);
                },
                close: vi.fn(),
            };
        });
        const plugin = makePlugin();
        mockChatPicker(plugin, {
            active: "llama3",
            installed: ["llama3"],
            catalog: [
                {
                    name: "acme/uninstalled",
                    size_gb: 1,
                    min_ram_gb: 1,
                    description: "x",
                    installed: false,
                },
            ],
        });
        const view = new ChatView(makeLeaf(), plugin);
        const autoPullSpy = vi.spyOn(view as any, "autoPullAndSet").mockResolvedValue(undefined);
        await view.onOpen();
        await tick();
        (view as any).handleChatSelection("acme/uninstalled");
        await tick();
        await tick();
        // confirmed === false → autoPullAndSet must not run.
        expect(autoPullSpy).not.toHaveBeenCalled();
    });
});

describe("ChatView — vault file picker enqueues the chosen file", () => {
    it("choosing a vault file calls plugin.addToLilbee", async () => {
        Notice.clear();
        const plugin = makePlugin();
        (plugin as any).addToLilbee = vi.fn().mockResolvedValue(undefined);
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        // The vault menu item runs `new VaultFilePickerModal(app, cb).open()`.
        // setPlaceholder runs in the constructor, so use it to capture the instance.
        const captured: VaultFilePickerModal[] = [];
        const spy = vi.spyOn(VaultFilePickerModal.prototype, "setPlaceholder").mockImplementation(function (
            this: VaultFilePickerModal,
        ) {
            captured.push(this);
        });

        const container = view.containerEl.children[1] as unknown as MockElement;
        container.find("lilbee-chat-add-file")!.trigger("click", { clientX: 0, clientY: 0 } as MouseEvent);
        Menu.instances[Menu.instances.length - 1].itemTitled(MESSAGES.WIZARD_FILE_PICKER_VAULT)!.click();

        expect(captured).toHaveLength(1);
        const file = { path: "notes/a.md", name: "a.md" } as any;
        captured[0].onChooseItem(file, undefined as any);
        // The arrow (file) => this.enqueueAddFile(file) runs enqueueAddFile → addToLilbee.
        expect((plugin as any).addToLilbee).toHaveBeenCalledWith(file);
        spy.mockRestore();
    });
});

describe("ChatView.sendMessage — sticky auto-scroll", () => {
    async function streamWith(
        events: SSEEvent[],
        geometry: { scrollTop: number; scrollHeight: number; clientHeight: number },
    ): Promise<MockElement> {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream(events);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        container.find("lilbee-chat-textarea")!.value = "follow me";
        container.find("lilbee-chat-send")!.trigger("click");
        // Applied after the send (which pins unconditionally) so the geometry
        // describes the view's state while the answer streams.
        Object.assign(messagesEl, geometry);
        await done;
        await tick();
        await tick();
        return messagesEl;
    }

    it("follows the stream to the bottom when the view is pinned near it", async () => {
        const messagesEl = await streamWith(
            [
                { event: SSE_EVENT.TOKEN, data: "hello" },
                { event: SSE_EVENT.DONE, data: {} },
            ],
            // 1000 - 480 - 500 = 20px from the bottom — within the follow threshold.
            { scrollTop: 480, scrollHeight: 1000, clientHeight: 500 },
        );
        expect(messagesEl.scrollTop).toBe(messagesEl.scrollHeight);
    });

    it("ends pinned to the bottom after DONE renders sources and reasoning", async () => {
        const messagesEl = await streamWith(
            [
                { event: SSE_EVENT.TOKEN, data: "hello" },
                { event: SSE_EVENT.REASONING, data: "thinking" },
                { event: SSE_EVENT.SOURCES, data: [makeSource()] },
                { event: SSE_EVENT.DONE, data: {} },
            ],
            { scrollTop: 480, scrollHeight: 1000, clientHeight: 500 },
        );
        expect(messagesEl.scrollTop).toBe(messagesEl.scrollHeight);
    });

    it("does not yank the view back down when the user scrolled up mid-stream", async () => {
        const messagesEl = await streamWith(
            [
                { event: SSE_EVENT.TOKEN, data: "hello" },
                { event: SSE_EVENT.DONE, data: {} },
            ],
            // 1000 - 100 - 500 = 400px above the bottom — reading older content.
            { scrollTop: 100, scrollHeight: 1000, clientHeight: 500 },
        );
        expect(messagesEl.scrollTop).toBe(100);
    });

    it("isNearBottom is false when messagesEl is null", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        (view as any).messagesEl = null;
        expect((view as any).isNearBottom()).toBe(false);
    });
});

describe("ChatView.sendMessage — memory_extracted", () => {
    async function sendWith(events: SSEEvent[]): Promise<LilbeePlugin> {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream(events);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        container.find("lilbee-chat-textarea")!.value = "remember this";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();
        return plugin;
    }

    it("notifies and refreshes memory views when a turn auto-saves memories", async () => {
        const plugin = await sendWith([
            { event: SSE_EVENT.DONE, data: {} },
            { event: SSE_EVENT.MEMORY_EXTRACTED, data: { count: 2, items: [] } },
        ]);
        expect(Notice.instances.map((n) => n.message)).toContain("Noted 2 memories to review in Memories.");
        expect(
            (plugin as unknown as { refreshMemoryViews: ReturnType<typeof vi.fn> }).refreshMemoryViews,
        ).toHaveBeenCalled();
    });

    it("uses the singular noun for a single extracted memory", async () => {
        await sendWith([
            { event: SSE_EVENT.DONE, data: {} },
            { event: SSE_EVENT.MEMORY_EXTRACTED, data: { count: 1, items: [] } },
        ]);
        expect(Notice.instances.map((n) => n.message)).toContain("Noted 1 memory to review in Memories.");
    });

    it("does nothing when the extracted count is zero", async () => {
        const plugin = await sendWith([
            { event: SSE_EVENT.DONE, data: {} },
            { event: SSE_EVENT.MEMORY_EXTRACTED, data: { count: 0, items: [] } },
        ]);
        expect(Notice.instances.map((n) => n.message)).not.toContain("Noted 0 memories to review in Memories.");
        expect(
            (plugin as unknown as { refreshMemoryViews: ReturnType<typeof vi.fn> }).refreshMemoryViews,
        ).not.toHaveBeenCalled();
    });
});

describe("compactionMarkerText", () => {
    it("names what was condensed", () => {
        expect(compactionMarkerText({ summary: "n", condensed: 3, stranded: 0 })).toBe(MESSAGES.CHAT_COMPACTED(3));
    });

    it("says plainly when some turns were dropped alongside the notes", () => {
        expect(compactionMarkerText({ summary: "n", condensed: 3, stranded: 2 })).toBe(
            MESSAGES.CHAT_COMPACTED_PARTIAL(3, 2),
        );
    });

    it("says plainly when turns were dropped with no notes at all", () => {
        expect(compactionMarkerText({ summary: "", condensed: 0, stranded: 4 })).toBe(MESSAGES.CHAT_STRANDED(4));
    });
});

describe("ChatView — chat sessions", () => {
    beforeEach(() => {
        Notice.clear();
    });

    async function openChat(plugin: LilbeePlugin) {
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        return { view, container, messagesEl: container.find("lilbee-chat-messages")! };
    }

    async function send(container: MockElement, text: string, done: Promise<void>) {
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = text;
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();
        await tick();
    }

    function streamOf(answer: string, sources: unknown[] = []) {
        const events: SSEEvent[] = [{ event: SSE_EVENT.TOKEN, data: answer }];
        if (sources.length > 0) events.push({ event: SSE_EVENT.SOURCES, data: sources });
        events.push({ event: SSE_EVENT.DONE, data: {} });
        return makeStream(events);
    }

    it("opens a session on the first turn, titled from the question", async () => {
        const plugin = makePlugin();
        const { mockFn, done } = streamOf("hi");
        plugin.api.chatStream = mockFn;
        const { container } = await openChat(plugin);

        await send(container, "What is a bee?\nsecond line", done);

        expect(plugin.api.createSession).toHaveBeenCalledWith("llama3", "both");
        expect(plugin.api.renameSession).toHaveBeenCalledWith("s1", "What is a bee?");
    });

    it("keeps persisting turns when the title write fails", async () => {
        const plugin = makePlugin();
        plugin.api.renameSession = vi.fn().mockRejectedValue(new Error("store hiccup"));
        const { mockFn, done } = streamOf("an answer");
        plugin.api.chatStream = mockFn;
        const { container } = await openChat(plugin);

        await send(container, "q", done);

        const calls = (plugin.api.appendSessionMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0]).toEqual(["s1", "user", "q", []]);
    });

    it("persists the user turn and then the assistant turn with its source paths", async () => {
        const plugin = makePlugin();
        const { mockFn, done } = streamOf("an answer", [
            { source: "notes.md", chunk: "x" },
            { source: "notes.md", chunk: "y" },
            { source: "other.md", chunk: "z" },
        ]);
        plugin.api.chatStream = mockFn;
        const { container } = await openChat(plugin);

        await send(container, "q", done);

        const calls = (plugin.api.appendSessionMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0]).toEqual(["s1", "user", "q", []]);
        expect(calls[1]).toEqual(["s1", "assistant", "an answer", ["notes.md", "other.md"]]);
    });

    it("reuses the open session on later turns", async () => {
        const plugin = makePlugin();
        const first = streamOf("a1");
        plugin.api.chatStream = first.mockFn;
        const { container } = await openChat(plugin);
        await send(container, "q1", first.done);

        const second = streamOf("a2");
        plugin.api.chatStream = second.mockFn;
        await send(container, "q2", second.done);

        expect(plugin.api.createSession).toHaveBeenCalledTimes(1);
    });

    it("persists the question but not an answer whose stream never completed", async () => {
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.TOKEN, data: "partial" }]);
        plugin.api.chatStream = mockFn;
        const { container } = await openChat(plugin);

        await send(container, "q", done);

        const roles = (plugin.api.appendSessionMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
        expect(roles).toEqual(["user"]);
    });

    it("keeps answering when the store refuses the write", async () => {
        const plugin = makePlugin();
        plugin.api.createSession = vi.fn().mockRejectedValue(new Error("store down"));
        const { mockFn, done } = streamOf("still answers");
        plugin.api.chatStream = mockFn;
        const { container, messagesEl } = await openChat(plugin);

        await send(container, "q", done);

        expect(messagesEl.children[1].find("lilbee-chat-content")!.textContent).toBe("still answers");
        expect(plugin.api.appendSessionMessage).not.toHaveBeenCalled();
    });

    function deferred<T>() {
        let resolve!: (v: T) => void;
        let reject!: (e: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    }

    function createdDetail(id: string) {
        return {
            meta: {
                id,
                title: "Untitled chat",
                created_at: "2026-07-16T00:00:00Z",
                updated_at: "2026-07-16T00:00:00Z",
                model_ref: "llama3",
                scope: "both",
                message_count: 0,
                origin: "http",
            },
            messages: [],
            summary: "",
        };
    }

    it("a conversation cleared while its create is in flight stays unbound", async () => {
        const plugin = makePlugin();
        const create = deferred<ReturnType<typeof createdDetail>>();
        plugin.api.createSession = vi.fn().mockReturnValue(create.promise);
        const { mockFn, done } = streamOf("a1");
        plugin.api.chatStream = mockFn;
        const { view, container } = await openChat(plugin);

        await send(container, "q1", done);
        container.find("lilbee-chat-clear")!.trigger("click");
        create.resolve(createdDetail("s1"));
        await tick();
        await tick();

        expect((view as any).sessionId).toBeNull();
        // The turn still lands in the conversation it belonged to…
        expect(plugin.api.appendSessionMessage).toHaveBeenCalledWith("s1", "user", "q1", []);
        // …but the answer queued behind it is dropped with the conversation.
        const roles = (plugin.api.appendSessionMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
        expect(roles).toEqual(["user"]);
    });

    it("a resume that races the first turn's create keeps the resumed session", async () => {
        const plugin = makePlugin();
        const create = deferred<ReturnType<typeof createdDetail>>();
        plugin.api.createSession = vi.fn().mockReturnValue(create.promise);
        plugin.api.getSession = vi.fn().mockResolvedValue({
            ...createdDetail("s5"),
            meta: { ...createdDetail("s5").meta, title: "Earlier chat" },
        });
        const { mockFn, done } = streamOf("a1");
        plugin.api.chatStream = mockFn;
        const { view, container } = await openChat(plugin);

        await send(container, "q1", done);
        await (view as any).resumeSession("s5");
        create.resolve(createdDetail("s9"));
        await tick();
        await tick();

        expect((view as any).sessionId).toBe("s5");
    });

    it("a store failure from a previous conversation doesn't unbind a resumed one", async () => {
        const plugin = makePlugin();
        const create = deferred<ReturnType<typeof createdDetail>>();
        plugin.api.createSession = vi.fn().mockReturnValue(create.promise);
        plugin.api.getSession = vi.fn().mockResolvedValue(createdDetail("s5"));
        const { mockFn, done } = streamOf("a1");
        plugin.api.chatStream = mockFn;
        const { view, container } = await openChat(plugin);

        await send(container, "q1", done);
        await (view as any).resumeSession("s5");
        create.reject(new Error("store down"));
        await tick();
        await tick();

        expect((view as any).sessionId).toBe("s5");
    });

    it("a transient store failure drops the write but keeps the conversation bound", async () => {
        const plugin = makePlugin();
        const first = streamOf("a1");
        plugin.api.chatStream = first.mockFn;
        const { container } = await openChat(plugin);
        await send(container, "q1", first.done);

        plugin.api.appendSessionMessage = vi.fn().mockRejectedValue(new Error("timeout"));
        const second = streamOf("a2");
        plugin.api.chatStream = second.mockFn;
        await send(container, "q2", second.done);

        plugin.api.appendSessionMessage = vi.fn().mockResolvedValue({ meta: { id: "s1" }, messages: [], summary: "" });
        const third = streamOf("a3");
        plugin.api.chatStream = third.mockFn;
        await send(container, "q3", third.done);

        expect(plugin.api.createSession).toHaveBeenCalledTimes(1);
        expect(plugin.api.appendSessionMessage).toHaveBeenCalledWith("s1", "user", "q3", []);
    });

    it("sessions turned off mid-chat unbinds so the conversation continues in memory", async () => {
        const plugin = makePlugin();
        const first = streamOf("a1");
        plugin.api.chatStream = first.mockFn;
        const { view, container } = await openChat(plugin);
        await send(container, "q1", first.done);

        plugin.api.appendSessionMessage = vi
            .fn()
            .mockRejectedValue(new Error('Server responded 404: {"detail":"Sessions are off."}'));
        const second = streamOf("a2");
        plugin.api.chatStream = second.mockFn;
        await send(container, "q2", second.done);

        expect((view as any).sessionId).toBeNull();
    });

    it("clearing the chat unbinds the session so the next turn opens a new one", async () => {
        const plugin = makePlugin();
        const first = streamOf("a1");
        plugin.api.chatStream = first.mockFn;
        const { container } = await openChat(plugin);
        await send(container, "q1", first.done);

        container.find("lilbee-chat-clear")!.trigger("click");

        const second = streamOf("a2");
        plugin.api.chatStream = second.mockFn;
        await send(container, "q2", second.done);

        expect(plugin.api.createSession).toHaveBeenCalledTimes(2);
    });

    describe("compaction over the wire", () => {
        function compactionStream(data: { summary: string; condensed: number; stranded: number }) {
            return makeStream([
                { event: SSE_EVENT.COMPACTING, data: {} },
                { event: SSE_EVENT.COMPACTING, data: { batch: 1, batches: 2 } },
                { event: SSE_EVENT.COMPACTING, data: { batch: 2, batches: 2 } },
                { event: SSE_EVENT.COMPACTION, data },
                { event: SSE_EVENT.TOKEN, data: { token: "a2" } },
                { event: SSE_EVENT.DONE, data: {} },
            ]);
        }

        it("marks the fold in the transcript and adopts the new summary", async () => {
            const plugin = makePlugin();
            const first = streamOf("a1");
            plugin.api.chatStream = first.mockFn;
            const { view, container, messagesEl } = await openChat(plugin);
            await send(container, "q1", first.done);

            const second = compactionStream({ summary: "the notes", condensed: 2, stranded: 0 });
            plugin.api.chatStream = second.mockFn;
            await send(container, "q2", second.done);

            const marker = messagesEl.find("lilbee-chat-compaction");
            expect(marker).not.toBeNull();
            expect(marker!.textContent).toBe(MESSAGES.CHAT_COMPACTED(2));
            expect((view as any).summary).toBe("the notes");
        });

        it("sends the trimmed history and the summary on the following turn", async () => {
            const plugin = makePlugin();
            const first = streamOf("a1");
            plugin.api.chatStream = first.mockFn;
            const { container } = await openChat(plugin);
            await send(container, "q1", first.done);

            const second = compactionStream({ summary: "the notes", condensed: 2, stranded: 0 });
            plugin.api.chatStream = second.mockFn;
            await send(container, "q2", second.done);

            const third = streamOf("a3");
            plugin.api.chatStream = third.mockFn;
            await send(container, "q3", third.done);

            // q1/a1 were folded away; the model's view resumes at q2.
            expect(third.mockFn.mock.calls[0][1]).toEqual([
                { role: "user", content: "q2" },
                { role: "assistant", content: "a2" },
            ]);
            expect(third.mockFn.mock.calls[0][6]).toEqual({ summary: "the notes", sessionId: "s1" });
        });

        it("labels the spinner while the chat engine warms, once", async () => {
            const plugin = makePlugin();
            const { mockFn, done } = makeStream([
                { event: SSE_EVENT.WARMING, data: { role: "chat" } },
                { event: SSE_EVENT.WARMING, data: { role: "chat" } },
                { event: SSE_EVENT.TOKEN, data: { token: "a1" } },
                { event: SSE_EVENT.DONE, data: {} },
            ]);
            plugin.api.chatStream = mockFn;
            const { container, messagesEl } = await openChat(plugin);
            await send(container, "q1", done);

            // The label rides inside the spinner, so it leaves with it when content reveals.
            const labels = messagesEl.findAll("lilbee-chat-warming-label");
            expect(labels).toHaveLength(1);
            expect(labels[0].textContent).toBe(MESSAGES.CHAT_WARMING);
            expect(messagesEl.children[1].find("lilbee-chat-content")!.textContent).toBe("a1");
        });

        it("renders the warming label exactly once for repeated warming events", async () => {
            const plugin = makePlugin();
            const { view } = await openChat(plugin);
            const bubble = new MockElement() as unknown as HTMLElement;
            const spinner = (bubble as unknown as MockElement).createDiv({ cls: "lilbee-thinking-dots" });
            const state = { compactionEl: null, anchorEl: bubble, spinnerEl: spinner, warmingShown: false };

            const fire = () =>
                (view as any).handleStreamEvent(
                    { event: SSE_EVENT.WARMING, data: {} },
                    bubble,
                    bubble,
                    state,
                    () => {},
                    () => {},
                );
            fire();
            fire();

            expect((spinner as unknown as MockElement).findAll("lilbee-chat-warming-label")).toHaveLength(1);
        });

        it("ticks the marker with the server's batch progress", async () => {
            const plugin = makePlugin();
            const { view, container, messagesEl } = await openChat(plugin);
            const first = streamOf("a1");
            plugin.api.chatStream = first.mockFn;
            await send(container, "q1", first.done);

            const bubble = (messagesEl as unknown as MockElement).createDiv({ cls: "probe" });
            const spinner = (bubble as unknown as MockElement).createDiv({ cls: "lilbee-thinking-dots" });
            const state = {
                compactionEl: null,
                anchorEl: bubble,
                spinnerEl: spinner,
                warmingShown: false,
            };
            (view as any).handleStreamEvent(
                { event: SSE_EVENT.COMPACTING, data: { batch: 1, batches: 3 } },
                bubble,
                bubble,
                state,
                () => {},
                () => {},
            );
            await Promise.resolve();

            expect((state.compactionEl as unknown as MockElement | null)?.textContent).toBe(
                MESSAGES.CHAT_COMPACTING_PROGRESS(1, 3),
            );
        });

        it("keeps one marker when the server announces condensing twice", async () => {
            const plugin = makePlugin();
            const { mockFn, done } = makeStream([
                { event: SSE_EVENT.COMPACTING, data: {} },
                { event: SSE_EVENT.COMPACTING, data: {} },
                { event: SSE_EVENT.TOKEN, data: { token: "a1" } },
                { event: SSE_EVENT.DONE, data: {} },
            ]);
            plugin.api.chatStream = mockFn;
            const { container, messagesEl } = await openChat(plugin);
            await send(container, "q1", done);

            expect(messagesEl.findAll("lilbee-chat-compaction")).toHaveLength(1);
            expect(messagesEl.find("lilbee-chat-compaction")!.textContent).toBe(MESSAGES.CHAT_COMPACTING);
        });

        it("adopts a compaction that arrived without its announcement", async () => {
            const plugin = makePlugin();
            const { mockFn, done } = makeStream([
                { event: SSE_EVENT.COMPACTION, data: { summary: "notes", condensed: 1, stranded: 0 } },
                { event: SSE_EVENT.TOKEN, data: { token: "a1" } },
                { event: SSE_EVENT.DONE, data: {} },
            ]);
            plugin.api.chatStream = mockFn;
            const { view, container, messagesEl } = await openChat(plugin);
            await send(container, "q1", done);

            expect((view as any).summary).toBe("notes");
            expect(messagesEl.find("lilbee-chat-compaction")).toBeNull();
        });

        it("ignores a condensing announcement after the messages pane is gone", async () => {
            const plugin = makePlugin();
            const { view } = await openChat(plugin);
            const el = new MockElement() as unknown as HTMLElement;
            const state = { compactionEl: null, anchorEl: el };

            (view as any).messagesEl = null;
            (view as any).handleStreamEvent(
                { event: SSE_EVENT.COMPACTING, data: {} },
                el,
                el,
                state,
                () => {},
                () => {},
            );

            expect(state.compactionEl).toBeNull();
        });

        it("a resumed conversation carries its stored summary into the next turn", async () => {
            const plugin = makePlugin();
            plugin.api.getSession = vi.fn().mockResolvedValue({
                ...createdDetail("s5"),
                summary: "stored notes",
            });
            const { view, container } = await openChat(plugin);
            await (view as any).resumeSession("s5");

            const { mockFn, done } = streamOf("a1");
            plugin.api.chatStream = mockFn;
            await send(container, "q", done);

            expect(mockFn.mock.calls[0][6]).toEqual({ summary: "stored notes", sessionId: "s5" });
        });
    });
});

describe("ChatView — resuming a session", () => {
    beforeEach(() => {
        Notice.clear();
    });

    function detail(overrides: Record<string, unknown> = {}) {
        return {
            meta: {
                id: "s5",
                title: "Earlier chat",
                created_at: "2026-07-16T00:00:00Z",
                updated_at: "2026-07-16T01:00:00Z",
                model_ref: "llama3",
                scope: "both",
                message_count: 2,
                origin: "http",
            },
            messages: [
                { role: "user", content: "old question", sources: [], ts: "t1" },
                { role: "assistant", content: "old answer", sources: ["notes.md"], ts: "t2" },
            ],
            summary: "",
            ...overrides,
        };
    }

    async function resume(plugin: LilbeePlugin, id = "s5") {
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        // Let onOpen's model/config fetches land before resume reads chatActive/chatInstalled.
        await tick();
        await (view as any).resumeSession(id);
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        return { view, container, messagesEl: container.find("lilbee-chat-messages")! };
    }

    it("renders the saved transcript and notices the title", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue(detail());

        const { messagesEl } = await resume(plugin);

        expect(messagesEl.children[0].textContent).toContain("old question");
        expect(messagesEl.children[1].find("lilbee-chat-content")!.textContent).toBe("old answer");
        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_SESSION_RESUMED("Earlier chat"))).toBe(true);
    });

    it("restores saved source paths as chips", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue(detail());

        const { messagesEl } = await resume(plugin);

        const chip = messagesEl.children[1].find("lilbee-source-chip-file");
        expect(chip!.textContent).toBe("notes.md");
    });

    it("continues a resumed conversation in the same session", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue(detail());
        const { container } = await resume(plugin);
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "new" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;

        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "follow up";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();
        await tick();

        expect(plugin.api.createSession).not.toHaveBeenCalled();
        expect(plugin.api.appendSessionMessage).toHaveBeenCalledWith("s5", "user", "follow up", []);
    });

    it("sends the restored history back with the next question", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue(detail());
        const { container } = await resume(plugin);
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;

        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "follow up";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        expect(mockFn.mock.calls[0][1]).toEqual([
            { role: "user", content: "old question" },
            { role: "assistant", content: "old answer" },
        ]);
    });

    it("switches to the session's model when it is installed", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue(detail({ meta: { ...detail().meta, model_ref: "phi3" } }));

        await resume(plugin);

        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
    });

    it("never points chat at a model that is not installed, and says so", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue(detail({ meta: { ...detail().meta, model_ref: "gone-7b" } }));

        const { messagesEl } = await resume(plugin);

        expect(plugin.api.setChatModel).not.toHaveBeenCalled();
        expect(
            Notice.instances.some((n) => n.message === MESSAGES.NOTICE_SESSION_MODEL_UNAVAILABLE("gone-7b", "llama3")),
        ).toBe(true);
        expect(messagesEl.children[0].textContent).toContain("old question");
    });

    it("leaves the model alone when the session already used it", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue(detail());

        await resume(plugin);

        expect(plugin.api.setChatModel).not.toHaveBeenCalled();
    });

    it("restores the session's scope, translating 'both' back to 'all'", async () => {
        const plugin = makePlugin();
        plugin.settings.searchChunkType = "wiki";
        plugin.api.getSession = vi.fn().mockResolvedValue(detail());

        await resume(plugin);

        expect(plugin.settings.searchChunkType).toBe("all");
        expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it("ignores a scope this build does not know", async () => {
        const plugin = makePlugin();
        plugin.settings.searchChunkType = "all";
        plugin.api.getSession = vi.fn().mockResolvedValue(detail({ meta: { ...detail().meta, scope: "future" } }));

        await resume(plugin);

        expect(plugin.settings.searchChunkType).toBe("all");
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });

    it("renders a compaction summary above the transcript when the server sends one", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue(detail({ summary: "They discussed bees." }));

        const { messagesEl } = await resume(plugin);

        const summary = messagesEl.find("lilbee-chat-summary");
        expect(summary).not.toBeNull();
        expect(summary!.find("lilbee-chat-summary-body")!.textContent).toBe("They discussed bees.");
    });

    it("renders no summary block when there is nothing folded away", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue(detail());

        const { messagesEl } = await resume(plugin);

        expect(messagesEl.find("lilbee-chat-summary")).toBeNull();
    });

    it("replaces the current transcript rather than appending to it", async () => {
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "first" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const messagesEl = container.find("lilbee-chat-messages")!;
        container.find("lilbee-chat-textarea")!.value = "live question";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();

        plugin.api.getSession = vi.fn().mockResolvedValue(detail());
        await (view as any).resumeSession("s5");
        await tick();

        expect(messagesEl.children).toHaveLength(2);
        expect(messagesEl.children[0].textContent).toContain("old question");
    });

    it("warns and keeps the view intact when the session cannot be loaded", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockRejectedValue(new Error("gone"));

        const { messagesEl } = await resume(plugin);

        expect(Notice.instances.some((n) => n.message.includes("Could not resume conversation"))).toBe(true);
        expect(messagesEl.children).toHaveLength(0);
    });
});

describe("ChatView — sessions toolbar button", () => {
    beforeEach(() => {
        Notice.clear();
        sessionsHooks.length = 0;
    });

    async function openChat(plugin: LilbeePlugin) {
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        return { view, container, messagesEl: container.find("lilbee-chat-messages")! };
    }

    it("opens the sessions modal with no active conversation on a fresh view", async () => {
        const { container } = await openChat(makePlugin());

        container.find("lilbee-chat-sessions")!.trigger("click");

        expect(sessionsHooks).toHaveLength(1);
        expect(sessionsHooks[0].activeId).toBeNull();
    });

    it("hands the modal the id of the conversation in progress", async () => {
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "a" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const { container } = await openChat(plugin);
        container.find("lilbee-chat-textarea")!.value = "q";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();
        await tick();

        container.find("lilbee-chat-sessions")!.trigger("click");

        expect(sessionsHooks[0].activeId).toBe("s1");
    });

    it("the modal's resume hook loads the chosen conversation", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue({
            meta: {
                id: "s5",
                title: "Earlier chat",
                created_at: "t",
                updated_at: "t",
                model_ref: "llama3",
                scope: "both",
                message_count: 1,
            },
            messages: [{ role: "user", content: "old question", sources: [], ts: "t" }],
            summary: "",
        });
        const { container, messagesEl } = await openChat(plugin);
        container.find("lilbee-chat-sessions")!.trigger("click");

        sessionsHooks[0].resume("s5");
        await tick();

        expect(plugin.api.getSession).toHaveBeenCalledWith("s5");
        expect(messagesEl.children[0].textContent).toContain("old question");
    });

    it("the modal's new-chat hook clears the transcript and says so", async () => {
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.TOKEN, data: "a" },
            { event: SSE_EVENT.DONE, data: {} },
        ]);
        plugin.api.chatStream = mockFn;
        const { container, messagesEl } = await openChat(plugin);
        container.find("lilbee-chat-textarea")!.value = "q";
        container.find("lilbee-chat-send")!.trigger("click");
        await done;
        await tick();
        container.find("lilbee-chat-sessions")!.trigger("click");

        sessionsHooks[0].startNew();

        expect(messagesEl.children).toHaveLength(0);
        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_SESSION_NEW)).toBe(true);
    });
});

describe("ChatView — restored session guards", () => {
    beforeEach(() => {
        Notice.clear();
    });

    it("clicking a restored source chip opens the file in the vault", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue({
            meta: {
                id: "s5",
                title: "Earlier chat",
                created_at: "t",
                updated_at: "t",
                model_ref: "llama3",
                scope: "both",
                message_count: 1,
            },
            messages: [{ role: "assistant", content: "answer", sources: ["notes.md"], ts: "t" }],
            summary: "",
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        await (view as any).resumeSession("s5");
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        container.find("lilbee-source-chip")!.trigger("click");

        expect(view.app.workspace.openLinkText).toHaveBeenCalledWith("notes.md", "");
    });

    it("restoring a transcript no-ops once the view has been torn down", async () => {
        const view = new ChatView(makeLeaf(), makePlugin());
        await view.onOpen();
        (view as any).messagesEl = null;

        expect(() =>
            (view as any).renderRestoredMessage({ role: "user", content: "x", sources: [], ts: "t" }),
        ).not.toThrow();
        expect(() => (view as any).renderSummaryBoundary("summary")).not.toThrow();
    });

    it("resume tolerates the view being torn down mid-load", async () => {
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockImplementation(() => {
            (view as any).messagesEl = null;
            return Promise.resolve({
                meta: {
                    id: "s5",
                    title: "Earlier chat",
                    created_at: "t",
                    updated_at: "t",
                    model_ref: "llama3",
                    scope: "both",
                    message_count: 0,
                },
                messages: [],
                summary: "",
            });
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        await expect((view as any).resumeSession("s5")).resolves.toBeUndefined();
        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_SESSION_RESUMED("Earlier chat"))).toBe(true);
    });
});

describe("ChatView — restored turns without sources", () => {
    it("renders no source block for an answer that cited nothing", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.getSession = vi.fn().mockResolvedValue({
            meta: {
                id: "s5",
                title: "Earlier chat",
                created_at: "t",
                updated_at: "t",
                model_ref: "llama3",
                scope: "both",
                message_count: 1,
            },
            messages: [{ role: "assistant", content: "answer", sources: [], ts: "t" }],
            summary: "",
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        await (view as any).resumeSession("s5");
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        expect(container.find("lilbee-chat-sources")).toBeNull();
        expect(container.find("lilbee-chat-content")!.textContent).toBe("answer");
    });
});

describe("ChatView — resume interactions with live state", () => {
    beforeEach(() => {
        Notice.clear();
    });

    function detail(scope = "both") {
        return {
            meta: {
                id: "s5",
                title: "Earlier chat",
                created_at: "t",
                updated_at: "t",
                model_ref: "llama3",
                scope,
                message_count: 1,
            },
            messages: [{ role: "user", content: "old question", sources: [], ts: "t" }],
            summary: "",
        };
    }

    it("does not let an aborted answer leak into the restored transcript", async () => {
        const plugin = makePlugin();
        // Yields a token then hangs until aborted, mirroring how the real stream unwinds on stop.
        plugin.api.chatStream = vi
            .fn()
            .mockImplementation((_q: string, _h: unknown, _k: unknown, signal: AbortSignal) =>
                (async function* () {
                    yield { event: SSE_EVENT.TOKEN, data: "partial answer" };
                    await new Promise((_resolve, reject) => {
                        signal.addEventListener("abort", () => {
                            const err = new Error("aborted");
                            err.name = "AbortError";
                            reject(err);
                        });
                    });
                })(),
            );
        plugin.api.getSession = vi.fn().mockResolvedValue(detail());
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;
        container.find("lilbee-chat-textarea")!.value = "live question";
        container.find("lilbee-chat-send")!.trigger("click");
        await tick();

        await (view as any).resumeSession("s5");
        await tick();
        await tick();

        expect((view as any).history).toEqual([{ role: "user", content: "old question" }]);
        expect((view as any).sending).toBe(false);
    });

    it("moves the search-scope highlight when a session restores a different scope", async () => {
        const plugin = makePlugin();
        plugin.settings.searchChunkType = "all";
        plugin.api.getSession = vi.fn().mockResolvedValue(detail("raw"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        const container = view.containerEl.children[1] as unknown as MockElement;

        await (view as any).resumeSession("s5");
        await tick();

        const active = container.findAll("lilbee-search-mode-btn").filter((b) => b.classList.contains("active"));
        expect(active).toHaveLength(1);
        expect(active[0].textContent).toBe(MESSAGES.LABEL_SEARCH_RAW);
        expect(plugin.settings.searchChunkType).toBe("raw");
    });

    it("keeps the current scope when a wiki-scoped session resumes with the wiki feature off", async () => {
        const plugin = makePlugin();
        plugin.settings.wikiEnabled = false;
        plugin.settings.searchChunkType = "all";
        plugin.api.getSession = vi.fn().mockResolvedValue(detail("wiki"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        await (view as any).resumeSession("s5");
        await tick();

        expect(plugin.settings.searchChunkType).toBe("all");
        expect(plugin.saveSettings).not.toHaveBeenCalled();
    });
});
