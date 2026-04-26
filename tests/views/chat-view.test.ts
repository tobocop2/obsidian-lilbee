import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Polyfill requestAnimationFrame for Node — execute callback on next microtask.
if (typeof globalThis.requestAnimationFrame === "undefined") {
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
        void Promise.resolve().then(() => cb(0));
        return 0;
    };
}

import { Notice, WorkspaceLeaf } from "../__mocks__/obsidian";
import { MockElement } from "../__mocks__/obsidian";
import { ChatView, VIEW_TYPE_CHAT, VaultFilePickerModal, electronDialog } from "../../src/views/chat-view";
import { ok, err } from "neverthrow";
import type LilbeePlugin from "../../src/main";
import { SSE_EVENT } from "../../src/types";
import { MESSAGES } from "../../src/locales/en";

const mockChatViewConfirmResult = true;
vi.mock("../../src/views/confirm-pull-modal", () => ({
    ConfirmPullModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() {
            return Promise.resolve(mockChatViewConfirmResult);
        },
        close: vi.fn(),
    })),
}));

vi.mock("../../src/views/crawl-modal", () => ({
    CrawlModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        result: Promise.resolve(true),
        close: vi.fn(),
    })),
}));

vi.mock("../../src/views/catalog-modal", () => ({
    CatalogModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
    })),
}));

let confirmModalResult = true;
vi.mock("../../src/views/confirm-modal", () => ({
    ConfirmModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() {
            return Promise.resolve(confirmModalResult);
        },
        close: vi.fn(),
    })),
}));
import type { SSEEvent, Source } from "../../src/types";
import { TaskQueue } from "../../src/task-queue";

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

function makePlugin(): LilbeePlugin {
    return {
        api: {
            chatStream: vi.fn(),
            listModels: vi.fn().mockResolvedValue({
                chat: { active: "llama3", installed: ["llama3", "phi3"], catalog: [] },
            }),
            installedModels: vi.fn().mockResolvedValue({
                models: [
                    { name: "llama3", source: "native" },
                    { name: "phi3", source: "native" },
                ],
            }),
            setChatModel: vi.fn().mockResolvedValue(ok(undefined)),
            setEmbeddingModel: vi.fn().mockResolvedValue(ok(undefined)),
            pullModel: vi.fn(),
            catalog: vi.fn().mockResolvedValue(
                ok({
                    total: 1,
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
                            hf_repo: "nomic-embed-text",
                            tag: "",
                            task: "embedding",
                            featured: true,
                            downloads: 1000,
                            quality_tier: "good",
                        },
                    ],
                    has_more: false,
                }),
            ),
            config: vi.fn().mockResolvedValue({ embedding_model: "nomic-embed-text" }),
        },
        settings: { topK: 5, enableOcr: null as boolean | null, wikiEnabled: true, searchChunkType: "all" as const },
        activeModel: "llama3",
        fetchActiveModel: vi.fn(),
        saveSettings: vi.fn().mockResolvedValue(undefined),
        cancelSync: vi.fn(),
        triggerSync: vi.fn().mockResolvedValue(undefined),
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

    it("creates a clear button inside the toolbar", () => {
        const clearBtn = container.find("lilbee-chat-clear");
        expect(clearBtn).not.toBeNull();
        expect(clearBtn!.tagName).toBe("BUTTON");
        expect(clearBtn!.textContent).toBe("Clear chat");
    });

    it("creates a paperclip add-file button inside the input area", () => {
        const inputArea = container.find("lilbee-chat-input");
        const addBtn = inputArea!.find("lilbee-chat-add-file");
        expect(addBtn).not.toBeNull();
        expect(addBtn!.tagName).toBe("BUTTON");
        expect(addBtn!.attributes["data-icon"]).toBe("paperclip");
    });

    it("creates toolbar groups for icon+select pairs", () => {
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

        expect(plugin.api.chatStream).toHaveBeenCalledWith("hello", [], 5, expect.any(AbortSignal), undefined, "all");
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

    it("renders source chips inside details element", async () => {
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
        expect(chip!.textContent).toBe("chip-doc.md");
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
    it("creates a select element with class lilbee-chat-model-select", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select");
        expect(select).not.toBeNull();
        expect(select!.tagName).toBe("SELECT");
    });

    it("populates options from listModels API with catalog+Other pattern", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        const options = select.children.filter((c) => c.tagName === "OPTION");
        // With empty catalog, all installed go under separator: separator + llama3 + phi3
        expect(options.length).toBe(3);
        expect(options[0].disabled).toBe(true); // separator
        expect(options[1].textContent).toBe("llama3");
        expect(options[2].textContent).toBe("phi3");
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
        const select = c.find("lilbee-chat-model-select")!;
        const options = select.children.filter((ch) => ch.tagName === "OPTION");
        const labels = options.map((o) => o.textContent);
        expect(labels).toContain("llama3");
        expect(labels).toContain("phi3 [ollama]");
        await view.onClose();
    });

    it("shows (connecting...) option on both selects when listModels fails", async () => {
        vi.useFakeTimers();
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockRejectedValue(new Error("offline"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        const container = view.containerEl.children[1] as unknown as MockElement;
        const chatSelect = container.find("lilbee-chat-model-select")!;
        const chatOptions = chatSelect.children.filter((c) => c.tagName === "OPTION");
        expect(chatOptions.some((o) => o.textContent === "(connecting...)")).toBe(true);

        await view.onClose();
        vi.useRealTimers();
    });

    it("change event calls setChatModel and updates activeModel", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
        await tick();

        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
    });

    it("change event shows Notice on setChatModel failure", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.setChatModel = vi.fn().mockResolvedValue(err(new Error("fail")));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "bad-model";
        select.trigger("change");
        await tick();

        expect(Notice.instances.some((n) => n.message.includes("failed to switch"))).toBe(true);
    });

    it("change event does nothing when value is empty", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "";
        select.trigger("change");
        await tick();

        expect(plugin.api.setChatModel).not.toHaveBeenCalled();
    });

    it("change event does nothing when value is separator key", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "__separator__";
        select.trigger("change");
        await tick();

        expect(plugin.api.setChatModel).not.toHaveBeenCalled();
    });

    it("excludes uninstalled catalog models from dropdown options", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
        });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        const options = select.children.filter((c: MockElement) => c.tagName === "OPTION");
        const labels = options.map((o: MockElement) => o.textContent);
        expect(labels).toContain("llama3");
        expect(labels).not.toContain("phi3 (not installed)");
        expect(labels).not.toContain("phi3");
    });

    it("selecting uninstalled catalog model triggers auto-pull with progress", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
        });

        async function* fakePull() {
            yield { event: "progress", data: { percent: 50 } };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(fakePull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
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
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
        });

        async function* fakePull() {
            yield { event: "progress", data: {} };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(fakePull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
    });

    it("auto-pull progress with current/total computes percentage", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
        });

        async function* fakePull() {
            yield { event: "progress", data: { current: 50, total: 100 } };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(fakePull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
    });

    it("auto-pull failure shows failure notice", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
        });

        async function* failingPull(): AsyncGenerator<never> {
            throw new Error("network");
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(failingPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
    });

    it("auto-pull SSE_EVENT.ERROR shows failure notice and fails task", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
        });

        async function* errorPull() {
            yield { event: SSE_EVENT.ERROR, data: { message: "pull exploded" } };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(errorPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
        expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
    });

    it("auto-pull SSE_EVENT.ERROR with string data fails the task", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
        });

        async function* errorPull() {
            yield { event: SSE_EVENT.ERROR, data: "raw error string" };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(errorPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
        expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
    });

    it("auto-pull SSE_EVENT.ERROR with empty object uses fallback message", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
        });

        async function* errorPull() {
            yield { event: SSE_EVENT.ERROR, data: {} };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(errorPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
        expect(plugin.taskQueue.completed.some((t: any) => t.status === "failed")).toBe(true);
    });

    it("auto-pull AbortError shows Pull cancelled notice", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
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

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_PULL_CANCELLED)).toBe(true);
    });

    it("auto-pull non-Error throw uses 'unknown' in taskQueue", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
        });

        async function* failingPull(): AsyncGenerator<never> {
            throw "string error";
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(failingPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        const failed = plugin.taskQueue.completed.find((t: any) => t.status === "failed");
        expect(failed).toBeDefined();
        expect(failed!.error).toBe("unknown error");
    });

    it("auto-pull with total=0 does not send progress", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
        });

        async function* fakePull() {
            yield { event: "progress", data: { percent: 0 } };
        }
        plugin.api.pullModel = vi.fn().mockReturnValue(fakePull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue(ok(undefined));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
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
    it("groups chat icon+select in first toolbar group", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const groups = container.findAll("lilbee-toolbar-group");
        expect(groups.length).toBe(2);
        const chatGroup = groups[0];
        expect(chatGroup.find("lilbee-toolbar-icon")).not.toBeNull();
        expect(chatGroup.find("lilbee-chat-model-select")).not.toBeNull();
    });

    it("toolbar has OCR toggle element", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const ocrToggle = container.find("lilbee-ocr-toggle");
        expect(ocrToggle).not.toBeNull();
    });

    it("OCR toggle shows Auto state by default", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const ocrToggle = container.find("lilbee-ocr-toggle")!;
        expect(ocrToggle.classList.contains("is-auto")).toBe(true);
        expect(ocrToggle.attributes["title"]).toBe(MESSAGES.LABEL_OCR_AUTO);
    });

    it("OCR toggle cycles Auto -> On -> Off -> Auto", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const ocrToggle = container.find("lilbee-ocr-toggle")!;

        // Auto -> On
        await ocrToggle.trigger("click");
        expect(plugin.settings.enableOcr).toBe(true);
        expect(ocrToggle.classList.contains("is-on")).toBe(true);
        expect(ocrToggle.attributes["title"]).toBe(MESSAGES.LABEL_OCR_ON);

        // On -> Off
        await ocrToggle.trigger("click");
        expect(plugin.settings.enableOcr).toBe(false);
        expect(ocrToggle.classList.contains("is-off")).toBe(true);
        expect(ocrToggle.attributes["title"]).toBe(MESSAGES.LABEL_OCR_OFF);

        // Off -> Auto
        await ocrToggle.trigger("click");
        expect(plugin.settings.enableOcr).toBeNull();
        expect(ocrToggle.classList.contains("is-auto")).toBe(true);
        expect(ocrToggle.attributes["title"]).toBe(MESSAGES.LABEL_OCR_AUTO);
    });

    it("OCR toggle persists to settings", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const ocrToggle = container.find("lilbee-ocr-toggle")!;

        await ocrToggle.trigger("click");
        expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it("updateOcrToggle no-ops when ocrToggleEl is null", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        (view as any).ocrToggleEl = null;
        // Should not throw
        (view as any).updateOcrToggle();
    });

    it("OCR toggle has eye icon", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const ocrToggle = container.find("lilbee-ocr-toggle")!;
        const icon = ocrToggle.find("lilbee-toolbar-icon");
        expect(icon).not.toBeNull();
        expect(icon!.attributes["data-icon"]).toBe("eye");
    });

    it("chat icon has title tooltip", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const groups = container.findAll("lilbee-toolbar-group");
        const chatIcon = groups[0].find("lilbee-toolbar-icon")!;
        expect(chatIcon.attributes["title"]).toBe("Chat model");
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
        await tick();

        expect(Notice.instances.some((n) => n.message.includes("could not open file picker"))).toBe(true);
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

describe("ChatView.onOpen — OCR toggle", () => {
    it("creates an OCR toggle element in the toolbar", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const toggle = container.find("lilbee-ocr-toggle");
        expect(toggle).not.toBeNull();
    });

    it("defaults to Auto state with is-auto class", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.enableOcr = null;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const toggle = container.find("lilbee-ocr-toggle")!;
        expect(toggle.classList.contains("is-auto")).toBe(true);
        expect(toggle.attributes["title"]).toBe("OCR: Auto");
    });

    it("cycles null -> true -> false -> null on click", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.enableOcr = null;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const toggle = container.find("lilbee-ocr-toggle")!;

        // Click 1: null -> true
        toggle.trigger("click");
        expect(plugin.settings.enableOcr).toBe(true);
        expect(toggle.classList.contains("is-on")).toBe(true);
        expect(toggle.attributes["title"]).toBe("OCR: On");

        // Click 2: true -> false
        toggle.trigger("click");
        expect(plugin.settings.enableOcr).toBe(false);
        expect(toggle.classList.contains("is-off")).toBe(true);
        expect(toggle.attributes["title"]).toBe("OCR: Off");

        // Click 3: false -> null
        toggle.trigger("click");
        expect(plugin.settings.enableOcr).toBe(null);
        expect(toggle.classList.contains("is-auto")).toBe(true);
        expect(toggle.attributes["title"]).toBe("OCR: Auto");
    });

    it("persists OCR state via saveSettings on click", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.enableOcr = null;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const toggle = container.find("lilbee-ocr-toggle")!;

        toggle.trigger("click");
        await tick();

        expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it("renders with is-on class when enableOcr is true", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.enableOcr = true;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const toggle = container.find("lilbee-ocr-toggle")!;
        expect(toggle.classList.contains("is-on")).toBe(true);
        expect(toggle.attributes["title"]).toBe("OCR: On");
    });

    it("renders with is-off class when enableOcr is false", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.enableOcr = false;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const toggle = container.find("lilbee-ocr-toggle")!;
        expect(toggle.classList.contains("is-off")).toBe(true);
        expect(toggle.attributes["title"]).toBe("OCR: Off");
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
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3"],
                catalog: [
                    { name: "llama3", size_gb: 4.7, min_ram_gb: 8, description: "Meta", installed: true },
                    { name: "phi3", size_gb: 2.3, min_ram_gb: 4, description: "MS", installed: false },
                ],
            },
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

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
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

        expect(plugin.api.chatStream).toHaveBeenCalledWith("hi", [], 5, expect.any(AbortSignal), undefined, "all");
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
        expect(plugin.api.chatStream).toHaveBeenCalledWith("q", [], 5, expect.any(AbortSignal), undefined, "wiki");
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
        expect(plugin.api.chatStream).toHaveBeenCalledWith("q", [], 5, expect.any(AbortSignal), undefined, "raw");
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

describe("ChatView.createToolbar — toolbar icons", () => {
    it("renders message-circle and database icons inside toolbar groups", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const groups = container.findAll("lilbee-toolbar-group");
        expect(groups.length).toBe(2);
        const chatIcon = groups[0].find("lilbee-toolbar-icon")!;
        expect(chatIcon.attributes["data-icon"]).toBe("message-circle");
        expect(chatIcon.attributes["title"]).toBe("Chat model");
        const embedIcon = groups[1].find("lilbee-toolbar-icon")!;
        expect(embedIcon.attributes["data-icon"]).toBe("database");
        expect(embedIcon.attributes["title"]).toBe("Embed");
        // OCR toggle is a separate element, not in a toolbar-group
        const ocrToggle = container.find("lilbee-ocr-toggle");
        expect(ocrToggle).not.toBeNull();
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
        let callCount = 0;
        plugin.api.listModels = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.reject(new Error("offline"));
            return Promise.resolve({
                chat: { active: "llama3", installed: ["llama3"], catalog: [] },
            });
        });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        // Let the first (rejected) promise settle
        await vi.advanceTimersByTimeAsync(0);

        const container = view.containerEl.children[1] as unknown as MockElement;
        const chatSelect = container.find("lilbee-chat-model-select")!;
        const chatOptions = chatSelect.children.filter((c) => c.tagName === "OPTION");
        expect(chatOptions.some((o) => o.textContent === "(connecting...)")).toBe(true);

        // Advance past the 5s retry
        await vi.advanceTimersByTimeAsync(5000);

        const updatedOptions = chatSelect.children.filter((c) => c.tagName === "OPTION");
        expect(updatedOptions.some((o) => o.textContent === "llama3")).toBe(true);
        expect(updatedOptions.some((o) => o.textContent === "(connecting...)")).toBe(false);

        await view.onClose();
    });

    it("shows offline notice only at threshold", async () => {
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockRejectedValue(new Error("offline"));

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
        let callCount = 0;
        plugin.api.listModels = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.reject(new Error("offline"));
            return Promise.resolve({
                chat: { active: "llama3", installed: ["llama3"], catalog: [] },
            });
        });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        // After first failure, retryTimer should be set
        expect((view as any).retryTimer).not.toBeNull();
        expect((view as any).retryCount).toBe(1);

        // Advance past retry — success
        await vi.advanceTimersByTimeAsync(5000);

        expect((view as any).retryTimer).toBeNull();
        expect((view as any).retryCount).toBe(0);

        await view.onClose();
    });

    it("clears retry timer and retryCount on close", async () => {
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockRejectedValue(new Error("offline"));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        expect((view as any).retryTimer).not.toBeNull();
        expect((view as any).retryCount).toBe(1);

        await view.onClose();

        expect((view as any).retryTimer).toBeNull();
        expect((view as any).retryCount).toBe(0);
    });

    it("clears existing options before retry", async () => {
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockRejectedValue(new Error("offline"));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        const container = view.containerEl.children[1] as unknown as MockElement;
        const chatSelect = container.find("lilbee-chat-model-select")!;

        // After first failure: exactly one (connecting...) option
        let connectingOptions = chatSelect.children.filter(
            (c) => c.tagName === "OPTION" && c.textContent === "(connecting...)",
        );
        expect(connectingOptions.length).toBe(1);

        // Advance past retry — second failure
        await vi.advanceTimersByTimeAsync(5000);

        // Still exactly one (connecting...) option (not duplicated)
        connectingOptions = chatSelect.children.filter(
            (c) => c.tagName === "OPTION" && c.textContent === "(connecting...)",
        );
        expect(connectingOptions.length).toBe(1);

        await view.onClose();
    });

    it("shows (connecting...) then (offline) after threshold", async () => {
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockRejectedValue(new Error("offline"));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const chatSelect = container.find("lilbee-chat-model-select")!;

        // Failure 1 — connecting
        await vi.advanceTimersByTimeAsync(0);
        expect(chatSelect.children.some((c) => c.textContent === "(connecting...)")).toBe(true);

        // Failure 2 — still connecting
        await vi.advanceTimersByTimeAsync(5000);
        expect(chatSelect.children.some((c) => c.textContent === "(connecting...)")).toBe(true);

        // Failure 3 — switches to offline
        await vi.advanceTimersByTimeAsync(5000);
        expect(chatSelect.children.some((c) => c.textContent === "(offline)")).toBe(true);
        expect(chatSelect.children.some((c) => c.textContent === "(connecting...)")).toBe(false);

        await view.onClose();
    });

    it("retries when server reachable but no models installed", async () => {
        const plugin = makePlugin();
        let callCount = 0;
        plugin.api.listModels = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount <= 2) {
                return Promise.resolve({
                    chat: { active: "", installed: [], catalog: [{ name: "llama3", installed: false }] },
                });
            }
            return Promise.resolve({
                chat: { active: "llama3", installed: ["llama3"], catalog: [{ name: "llama3", installed: true }] },
            });
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
        const chatSelect = container.find("lilbee-chat-model-select")!;
        const options = chatSelect.children.filter((c) => c.tagName === "OPTION");
        expect(options.some((o) => o.textContent === "llama3")).toBe(true);

        await view.onClose();
    });

    it("stops no-installed-models retry on close", async () => {
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: { active: "", installed: [], catalog: [] },
        });

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
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: { active: "", installed: [], catalog: [] },
        });

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
        let callCount = 0;
        plugin.api.listModels = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount <= 2) return Promise.reject(new Error("offline"));
            return Promise.resolve({
                chat: { active: "llama3", installed: ["llama3"], catalog: [] },
            });
        });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        // Failure 1
        await vi.advanceTimersByTimeAsync(0);
        expect((view as any).retryCount).toBe(1);

        // Failure 2
        await vi.advanceTimersByTimeAsync(5000);
        expect((view as any).retryCount).toBe(2);

        // Success — resets to 0
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

    it("creates an embedding select element with class lilbee-embed-model-select", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select");
        expect(select).not.toBeNull();
        expect(select!.tagName).toBe("SELECT");
    });

    it("populates embedding options from catalog API", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        const options = select.children.filter((c) => c.tagName === "OPTION");
        expect(options.length).toBe(1);
        expect(options[0].textContent).toBe("nomic-embed-text");
        expect(options[0].value).toBe("nomic-embed-text");
    });

    it("marks the active embedding model as selected", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        const options = select.children.filter((c) => c.tagName === "OPTION");
        expect(options[0].selected).toBe(true);
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
        const select = container.find("lilbee-embed-model-select")!;
        const options = select.children.filter((c) => c.tagName === "OPTION");
        expect(options.length).toBe(1);
        expect(options[0].textContent).toBe("custom-embed");
        expect(options[0].selected).toBe(true);
    });

    it("shows fallback option when catalog returns error", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockResolvedValue(err(new Error("fail")));
        plugin.api.config = vi.fn().mockResolvedValue({ embedding_model: "fallback-embed" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        const options = select.children.filter((c) => c.tagName === "OPTION");
        expect(options.length).toBe(1);
        expect(options[0].textContent).toBe("fallback-embed");
    });

    it("shows no options when catalog is empty and config has no embedding_model", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi
            .fn()
            .mockResolvedValue(ok({ total: 0, limit: 50, offset: 0, models: [], has_more: false }));
        plugin.api.config = vi.fn().mockResolvedValue({});
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        const options = select.children.filter((c) => c.tagName === "OPTION");
        expect(options.length).toBe(0);
    });

    it("shows confirmation modal when embedding model is changed", async () => {
        const { ConfirmModal } = await import("../../src/views/confirm-modal");
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        (select as any).value = "nomic-embed-text";
        select.trigger("change");
        await tick();

        expect(ConfirmModal).toHaveBeenCalled();
    });

    it("calls setEmbeddingModel and shows notices on confirm", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        (select as any).value = "nomic-embed-text";
        select.trigger("change");
        await tick();

        expect(plugin.api.setEmbeddingModel).toHaveBeenCalledWith("nomic-embed-text");
        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_EMBEDDING_UPDATED)).toBe(true);
        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_REINDEX_REQUIRED)).toBe(true);
        expect(plugin.triggerSync).toHaveBeenCalled();
    });

    it("reverts dropdown on cancel", async () => {
        confirmModalResult = false;
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        (select as any).value = "other-model";
        select.trigger("change");
        await tick();

        expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
        expect(select.value).toBe("nomic-embed-text");
    });

    it("reverts dropdown and shows notice on setEmbeddingModel failure", async () => {
        const plugin = makePlugin();
        plugin.api.setEmbeddingModel = vi.fn().mockResolvedValue(err(new Error("fail")));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        (select as any).value = "other-model";
        select.trigger("change");
        await tick();

        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_FAILED_EMBEDDING)).toBe(true);
        expect(select.value).toBe("nomic-embed-text");
    });

    it("reverts dropdown and shows notice on setEmbeddingModel network error", async () => {
        const plugin = makePlugin();
        plugin.api.setEmbeddingModel = vi.fn().mockResolvedValue(err(new Error("network")));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        (select as any).value = "other-model";
        select.trigger("change");
        await tick();

        expect(Notice.instances.some((n) => n.message === MESSAGES.NOTICE_FAILED_EMBEDDING)).toBe(true);
        expect(select.value).toBe("nomic-embed-text");
    });

    it("does nothing when change value is empty", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        (select as any).value = "";
        select.trigger("change");
        await tick();

        expect(plugin.api.setEmbeddingModel).not.toHaveBeenCalled();
    });

    it("Browse more button opens CatalogModal pre-filtered to embedding", async () => {
        const { CatalogModal } = await import("../../src/views/catalog-modal");
        (CatalogModal as unknown as ReturnType<typeof vi.fn>).mockClear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const browseBtn = container.find("lilbee-embed-browse")!;
        expect(browseBtn).not.toBeNull();
        expect(browseBtn.textContent).toBe(MESSAGES.BUTTON_BROWSE_MORE);

        browseBtn.trigger("click");
        expect(CatalogModal).toHaveBeenCalledWith(expect.anything(), plugin, "embedding");
    });

    it("shows connecting label on embedding select when offline", async () => {
        vi.useFakeTimers();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockRejectedValue(new Error("offline"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        const container = view.containerEl.children[1] as unknown as MockElement;
        const embedSelect = container.find("lilbee-embed-model-select")!;
        const options = embedSelect.children.filter((c) => c.tagName === "OPTION");
        expect(options.some((o) => o.textContent === "(connecting...)")).toBe(true);

        await view.onClose();
        vi.useRealTimers();
    });

    it("shows offline label on embedding select after threshold", async () => {
        vi.useFakeTimers();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockRejectedValue(new Error("offline"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        // Failure 1
        await vi.advanceTimersByTimeAsync(0);
        // Failure 2
        await vi.advanceTimersByTimeAsync(5000);
        // Failure 3 — threshold
        await vi.advanceTimersByTimeAsync(5000);

        const container = view.containerEl.children[1] as unknown as MockElement;
        const embedSelect = container.find("lilbee-embed-model-select")!;
        const options = embedSelect.children.filter((c) => c.tagName === "OPTION");
        expect(options.some((o) => o.textContent === "(offline)")).toBe(true);

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
        const select = container.find("lilbee-embed-model-select")!;
        const options = select.children.filter((c) => c.tagName === "OPTION");
        expect(options.length).toBe(1);
        expect(options[0].textContent).toBe("nomic-embed-text");
    });

    it("handles null config gracefully", async () => {
        const plugin = makePlugin();
        plugin.api.config = vi.fn().mockRejectedValue(new Error("fail"));
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        const options = select.children.filter((c) => c.tagName === "OPTION");
        // Should still show models from catalog, just none marked active
        expect(options.length).toBe(1);
        expect(options[0].textContent).toBe("nomic-embed-text");
    });

    it("revertEmbeddingSelect no-ops when embeddingSelectEl is null", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        (view as any).embeddingSelectEl = null;
        // Should not throw
        (view as any).revertEmbeddingSelect("test");
    });

    it("revertEmbeddingSelect falls back to a server refresh when the previous value is not in options", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const fetchSpy = vi
            .spyOn(view as unknown as { fetchAndFillSelectors: () => Promise<void> }, "fetchAndFillSelectors")
            .mockResolvedValue();

        (view as any).revertEmbeddingSelect("totally-unknown-model");

        expect(fetchSpy).toHaveBeenCalled();
    });

    it("handles null catalog result in fillEmbeddingSelector", async () => {
        const plugin = makePlugin();
        plugin.api.catalog = vi.fn().mockRejectedValue(new Error("fail"));
        plugin.api.config = vi.fn().mockResolvedValue({ embedding_model: "fallback" });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-embed-model-select")!;
        const options = select.children.filter((c) => c.tagName === "OPTION");
        expect(options.length).toBe(1);
        expect(options[0].textContent).toBe("fallback");
    });

    it("fillEmbeddingSelector with null embeddingSelectEl is a no-op", async () => {
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        (view as any).embeddingSelectEl = null;
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
        await (view as any).autoPullAndSet({ name: "phi3" });
        const setFailed = MESSAGES.ERROR_SET_MODEL.replace("{model}", "phi3");
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
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: {
                active: "llama3",
                installed: ["llama3", "Qwen/Qwen2-VL-7B-Instruct", "BAAI/bge-reranker-v2-m3"],
                catalog: [],
            },
            embedding: {
                active: "nomic-embed-text",
                installed: ["nomic-embed-text"],
                catalog: [],
            },
            vision: {
                active: "Qwen/Qwen2-VL-7B-Instruct",
                installed: ["Qwen/Qwen2-VL-7B-Instruct"],
                catalog: [],
            },
            reranker: {
                active: "BAAI/bge-reranker-v2-m3",
                installed: ["BAAI/bge-reranker-v2-m3"],
                catalog: [],
            },
        });
        plugin.api.installedModels = vi.fn().mockResolvedValue({
            models: [
                { name: "llama3", source: "native" },
                { name: "nomic-embed-text", source: "native" },
                { name: "Qwen/Qwen2-VL-7B-Instruct", source: "native" },
                { name: "BAAI/bge-reranker-v2-m3", source: "native" },
            ],
        });
        // catalog({task: EMBEDDING}) returns embedding-only. If the plugin ever called
        // catalog with a different task or with no filter, this mock would not cover
        // those other tasks and the embedding selector would end up empty / wrong.
        plugin.api.catalog = vi.fn().mockResolvedValue(
            ok({
                total: 1,
                limit: 50,
                offset: 0,
                models: [
                    {
                        name: "nomic-embed-text",
                        display_name: "nomic-embed-text",
                        size_gb: 0.3,
                        min_ram_gb: 1,
                        description: "embedding",
                        installed: true,
                        source: "native",
                        hf_repo: "nomic-embed-text",
                        tag: "",
                        task: "embedding",
                        featured: true,
                        downloads: 100,
                        quality_tier: "good",
                    },
                ],
                has_more: false,
            }),
        );
        plugin.api.config = vi.fn().mockResolvedValue({ embedding_model: "nomic-embed-text" });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();
        await tick();

        // The plugin must ask the server for the embedding task specifically.
        expect(plugin.api.catalog).toHaveBeenCalledWith({ task: "embedding" });

        const container = view.containerEl.children[1] as unknown as MockElement;
        const chatSelect = container.find("lilbee-chat-model-select")!;
        const embedSelect = container.find("lilbee-embed-model-select")!;

        const chatOptionValues = chatSelect.children
            .map((c) => (c as any).value ?? c.textContent)
            .filter((v: string) => v !== "__separator__");
        const embedOptionValues = embedSelect.children.map((c) => (c as any).value ?? c.textContent);

        // Chat selector echoes models.chat.installed — including the contaminated names.
        // This proves the plugin delegates role filtering to the server (no client-side
        // re-filter that could drift out of sync with the server contract). Using sorted
        // equality pins BOTH directions: no entries dropped, no entries added. If the
        // plugin later adds a client-side filter, this fails. Order is normalized because
        // the dropdown renders entries sorted — the invariant is the set, not the order.
        expect([...chatOptionValues].sort()).toEqual(
            ["llama3", "Qwen/Qwen2-VL-7B-Instruct", "BAAI/bge-reranker-v2-m3"].sort(),
        );
        expect(chatOptionValues).toHaveLength(3);

        // Embedding selector is populated from catalog({task: EMBEDDING}), which the
        // server scopes to embedding models. If the plugin were reading from listModels
        // or a broader catalog call, vision/reranker names could leak here.
        expect(embedOptionValues).toEqual(["nomic-embed-text"]);
    });
});
