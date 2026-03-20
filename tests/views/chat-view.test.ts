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
import { ChatView, VIEW_TYPE_CHAT, VaultFilePickerModal, electronDialog, buildGenerationOptions } from "../../src/views/chat-view";
import type LilbeePlugin from "../../src/main";
import { NOTICE, SSE_EVENT } from "../../src/types";

let mockChatViewConfirmResult = true;
vi.mock("../../src/views/confirm-pull-modal", () => ({
    ConfirmPullModal: vi.fn().mockImplementation(() => ({
        open: vi.fn(),
        get result() { return Promise.resolve(mockChatViewConfirmResult); },
        close: vi.fn(),
    })),
}));
import type { SSEEvent, Source } from "../../src/types";

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
    const done = new Promise<void>((r) => { resolveStream = r; });
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
                vision: { active: "", installed: [], catalog: [] },
            }),
            setChatModel: vi.fn().mockResolvedValue({ model: "phi3" }),
            setVisionModel: vi.fn().mockResolvedValue({ model: "" }),
            pullModel: vi.fn(),
        },
        ollama: {
            pull: vi.fn(),
            delete: vi.fn(),
        },
        settings: { topK: 5 },
        activeModel: "llama3",
        activeVisionModel: "",
        fetchActiveModel: vi.fn(),
        onProgress: null,
        cancelSync: vi.fn(),
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

    it("creates a progress banner (hidden by default)", () => {
        const banner = container.find("lilbee-progress-banner");
        expect(banner).not.toBeNull();
        expect(banner!.dataset.hidden).toBe("");
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

        expect(plugin.api.chatStream).toHaveBeenCalledWith("hello", [], 5, expect.any(AbortSignal), {});
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
    it("shows a Notice and renders error inline when error event is received", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.ERROR, data: "something went wrong" },
        ]);
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
        const assistantBubble = messagesEl.children[1];
        const textEl = assistantBubble.find("lilbee-chat-content");
        expect(textEl!.textContent).toBe("something went wrong");
        expect(textEl!.classList.contains("lilbee-chat-error")).toBe(true);
    });
});

describe("ChatView.sendMessage — API throws", () => {
    it("sets assistant text to unavailable message and adds error class when chatStream throws", async () => {
        Notice.clear();
        const plugin = makePlugin();
        let resolveThrown!: () => void;
        const thrown = new Promise<void>((r) => { resolveThrown = r; });
        plugin.api.chatStream = vi.fn().mockReturnValue(
            (async function* () {
                resolveThrown();
                throw new Error("network");
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

        const assistantBubble = messagesEl.children[1];
        const textEl = assistantBubble.find("lilbee-chat-content");
        expect(textEl!.textContent).toBe("Server unavailable — retries exhausted. Is lilbee running?");
        expect(textEl!.classList.contains("lilbee-chat-error")).toBe(true);
    });
});

describe("ChatView.sendMessage — messagesEl null guard", () => {
    it("returns immediately if messagesEl is null (onOpen not called)", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        // Do NOT call onOpen — messagesEl stays null

        // Access the private method directly for coverage
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

        const visionSelect = container.find("lilbee-chat-vision-select")!;
        const visionOptions = visionSelect.children.filter((c) => c.tagName === "OPTION");
        expect(visionOptions.some((o) => o.textContent === "(connecting...)")).toBe(true);

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
        plugin.api.setChatModel = vi.fn().mockRejectedValue(new Error("fail"));
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
            vision: { active: "", installed: [], catalog: [] },
        });

        async function* fakePull() {
            yield { status: "pulling", completed: 50, total: 100 };
            yield { status: "success" };
        }
        plugin.ollama.pull = vi.fn().mockReturnValue(fakePull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue({ model: "phi3" });

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

        expect(plugin.ollama.pull).toHaveBeenCalledWith("phi3", expect.any(AbortSignal));
        expect(plugin.api.setChatModel).toHaveBeenCalledWith("phi3");
        expect(Notice.instances.some((n) => n.message === "lilbee: phi3 pulled and activated")).toBe(true);
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
            vision: { active: "", installed: [], catalog: [] },
        });

        async function* failingPull(): AsyncGenerator<never> {
            throw new Error("network");
        }
        plugin.ollama.pull = vi.fn().mockReturnValue(failingPull());

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
            vision: { active: "", installed: [], catalog: [] },
        });

        async function* fakePull() {
            yield { status: "pulling", completed: 0, total: 0 };
            yield { status: "success" };
        }
        plugin.ollama.pull = vi.fn().mockReturnValue(fakePull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue({ model: "phi3" });

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
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.ERROR, data: { message: "model not found" } },
        ]);
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
        const { mockFn, done } = makeStream([
            { event: SSE_EVENT.DONE, data: {} },
        ]);
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
        await done;
        await tick();

        // After streaming, spinner should be removed and text visible
        const messagesEl = container.find("lilbee-chat-messages")!;
        const assistantBubble = messagesEl.children[1];
        const textEl = assistantBubble.find("lilbee-chat-content");
        expect(textEl!.textContent).toBe("Hi");
        expect(textEl!.style.display).toBe("");
    });
});

describe("VaultFilePickerModal", () => {
    it("getItems returns vault files", () => {
        const plugin = makePlugin();
        const files = [{ path: "a.md", name: "a.md" }, { path: "b.md", name: "b.md" }];
        const leaf = makeLeaf();
        (leaf.app.vault as any).getFiles = vi.fn().mockReturnValue(files);
        const modal = new VaultFilePickerModal(leaf.app as any, plugin);
        expect(modal.getItems()).toEqual(files);
    });

    it("getItemText returns file path", () => {
        const plugin = makePlugin();
        const modal = new VaultFilePickerModal(makeLeaf().app as any, plugin);
        const file = { path: "notes/test.md", name: "test.md" } as any;
        expect(modal.getItemText(file)).toBe("notes/test.md");
    });

    it("onChooseItem calls plugin.addToLilbee", () => {
        const plugin = makePlugin();
        (plugin as any).addToLilbee = vi.fn().mockResolvedValue(undefined);
        const modal = new VaultFilePickerModal(makeLeaf().app as any, plugin);
        const file = { path: "test.md", name: "test.md" } as any;
        modal.onChooseItem(file, undefined);
        expect((plugin as any).addToLilbee).toHaveBeenCalledWith(file);
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

    it("groups vision icon+select in second toolbar group", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const groups = container.findAll("lilbee-toolbar-group");
        const visionGroup = groups[1];
        expect(visionGroup.find("lilbee-toolbar-icon")).not.toBeNull();
        expect(visionGroup.find("lilbee-chat-vision-select")).not.toBeNull();
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

    it("vision icon has title tooltip", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const groups = container.findAll("lilbee-toolbar-group");
        const visionIcon = groups[1].find("lilbee-toolbar-icon")!;
        expect(visionIcon.attributes["title"]).toBe("Vision model");
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

describe("ChatView — progress banner", () => {
    it("handleProgress shows banner on file_start event", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const banner = container.find("lilbee-progress-banner")!;

        view.handleProgress({
            event: SSE_EVENT.FILE_START,
            data: { file: "paper.pdf", current_file: 3, total_files: 10 },
        });

        expect(banner.dataset.hidden).toBeUndefined();
        const label = container.find("lilbee-progress-top-label")!;
        expect(label.textContent).toContain("3/10");
    });

    it("handleProgress updates sub-label on extract event", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        view.handleProgress({
            event: SSE_EVENT.EXTRACT,
            data: { file: "paper.pdf", page: 5, total_pages: 50 },
        });

        const container = view.containerEl.children[1] as unknown as MockElement;
        const subLabel = container.find("lilbee-progress-sub-label")!;
        expect(subLabel.textContent).toContain("Extracting");
        expect(subLabel.textContent).toContain("page 5/50");
    });

    it("handleProgress updates sub-label on embed event", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        view.handleProgress({
            event: SSE_EVENT.EMBED,
            data: { file: "paper.pdf", chunk: 30, total_chunks: 100 },
        });

        const container = view.containerEl.children[1] as unknown as MockElement;
        const subLabel = container.find("lilbee-progress-sub-label")!;
        expect(subLabel.textContent).toContain("Embedding");
        expect(subLabel.textContent).toContain("30/100");
    });

    it("handleProgress shows banner on progress event", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        view.handleProgress({
            event: SSE_EVENT.PROGRESS,
            data: { file: "notes.md", current: 2, total: 5 },
        });

        const container = view.containerEl.children[1] as unknown as MockElement;
        const label = container.find("lilbee-progress-top-label")!;
        expect(label.textContent).toContain("2/5");
        expect(label.textContent).toContain("notes.md");
    });

    it("handleProgress hides banner on done event", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        // Show first
        view.handleProgress({
            event: SSE_EVENT.FILE_START,
            data: { file: "a.md", current_file: 1, total_files: 1 },
        });
        // Then complete
        view.handleProgress({
            event: SSE_EVENT.DONE,
            data: {},
        });

        const container = view.containerEl.children[1] as unknown as MockElement;
        const banner = container.find("lilbee-progress-banner")!;
        expect(banner.dataset.hidden).toBe("");
    });

    it("handleProgress no-ops when progressBanner is null (before onOpen)", () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);

        expect(() => {
            view.handleProgress({
                event: SSE_EVENT.FILE_START,
                data: { file: "x", current_file: 1, total_files: 1 },
            });
        }).not.toThrow();
    });

    it("handleProgress ignores unknown event types", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const banner = container.find("lilbee-progress-banner")!;

        view.handleProgress({ event: "unknown_event", data: {} });

        // Banner stays hidden (data-hidden attribute still present)
        expect(banner.dataset.hidden).toBe("");
    });

    it("handleProgress shows pull-specific label on pull event", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const banner = container.find("lilbee-progress-banner")!;
        const label = container.find("lilbee-progress-top-label")!;

        view.handleProgress({
            event: SSE_EVENT.PULL,
            data: { model: "mistral", current: 50, total: 100 },
        });

        expect(banner.dataset.hidden).toBeUndefined();
        expect(label.textContent).toBe("Pulling model — 50%");
    });

    it("hideProgress no-ops when progressBanner is null", () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        expect(() => view.hideProgress()).not.toThrow();
    });

    it("handleProgress with missing data fields uses fallback values", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        // FILE_START with missing fields
        view.handleProgress({ event: SSE_EVENT.FILE_START, data: {} });
        const container = view.containerEl.children[1] as unknown as MockElement;
        const label = container.find("lilbee-progress-top-label")!;
        expect(label.textContent).toContain("0/0");

        // EXTRACT with missing fields
        view.handleProgress({ event: SSE_EVENT.EXTRACT, data: {} });
        const subLabel = container.find("lilbee-progress-sub-label")!;
        expect(subLabel.textContent).toContain("0/0");

        // EMBED with missing fields
        view.handleProgress({ event: SSE_EVENT.EMBED, data: {} });
        expect(subLabel.textContent).toContain("0/0");

        // PROGRESS with missing fields
        view.handleProgress({ event: SSE_EVENT.PROGRESS, data: {} });
        expect(label.textContent).toContain("0/0");

        // PULL with missing fields (tests ?? fallback)
        view.handleProgress({ event: SSE_EVENT.PULL, data: {} });
        expect(label.textContent).toContain("0%");
    });

    it("updateSubLabel no-ops before onOpen", () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        // EXTRACT before onOpen — progressSubLabel is null
        expect(() => {
            view.handleProgress({ event: SSE_EVENT.EXTRACT, data: { file: "x", page: 1, total_pages: 1 } });
        }).not.toThrow();
    });

    it("showFileProgress with total=0 sets bar width to 0%", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        view.handleProgress({ event: SSE_EVENT.FILE_START, data: { current_file: 0, total_files: 0 } });

        const container = view.containerEl.children[1] as unknown as MockElement;
        const bar = container.find("lilbee-progress-bar")!;
        expect(bar.style.width).toBe("0%");
    });

    it("cancel button aborts pullController when set", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        // Simulate a pullController being set
        const controller = new AbortController();
        (view as any).pullController = controller;
        const abortSpy = vi.spyOn(controller, "abort");

        const container = view.containerEl.children[1] as unknown as MockElement;
        const cancelBtn = container.find("lilbee-progress-cancel")!;
        cancelBtn.trigger("click");

        expect(abortSpy).toHaveBeenCalled();
        expect((plugin as any).cancelSync).toHaveBeenCalled();
    });
});

describe("ChatView.onClose", () => {
    it("clears onProgress callback", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        expect(plugin.onProgress).not.toBeNull();

        await (view as any).onClose();

        expect(plugin.onProgress).toBeNull();
    });
});

describe("ChatView — onProgress registration", () => {
    it("registers onProgress callback on open that forwards to handleProgress", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        expect(plugin.onProgress).toBeTypeOf("function");

        // Call through the registered callback
        plugin.onProgress!({
            event: SSE_EVENT.FILE_START,
            data: { file: "test.md", current_file: 1, total_files: 2 },
        });

        const container = view.containerEl.children[1] as unknown as MockElement;
        const label = container.find("lilbee-progress-top-label")!;
        expect(label.textContent).toContain("1/2");
        const banner = container.find("lilbee-progress-banner")!;
        expect(banner.dataset.hidden).toBeUndefined();
    });
});

describe("ChatView.onOpen — add file button opens menu", () => {
    let dialogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        dialogSpy = vi.spyOn(electronDialog, "showOpenDialog")
            .mockResolvedValue({ canceled: true, filePaths: [] });
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

describe("ChatView.onOpen — vision selector", () => {
    it("creates a select element with class lilbee-chat-vision-select", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-vision-select");
        expect(select).not.toBeNull();
        expect(select!.tagName).toBe("SELECT");
    });

    it("first option is Disabled with empty value", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-vision-select")!;
        const options = select.children.filter((c) => c.tagName === "OPTION");
        expect(options[0].textContent).toBe("Disabled");
        expect((options[0] as any).value).toBe("");
    });

    it("selecting installed vision model calls setVisionModel", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: { active: "llama3", installed: ["llama3"], catalog: [] },
            vision: {
                active: "",
                installed: ["llava"],
                catalog: [{ name: "llava", size_gb: 4.7, min_ram_gb: 8, description: "Vision", installed: true }],
            },
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-vision-select")!;
        (select as any).value = "llava";
        select.trigger("change");
        await tick();

        expect(plugin.api.setVisionModel).toHaveBeenCalledWith("llava");
    });

    it("selecting Disabled calls setVisionModel with empty string", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: { active: "llama3", installed: ["llama3"], catalog: [] },
            vision: {
                active: "llava",
                installed: ["llava"],
                catalog: [{ name: "llava", size_gb: 4.7, min_ram_gb: 8, description: "Vision", installed: true }],
            },
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-vision-select")!;
        (select as any).value = "";
        select.trigger("change");
        await tick();

        expect(plugin.api.setVisionModel).toHaveBeenCalledWith("");
    });

    it("setVisionModel failure shows Notice", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.setVisionModel = vi.fn().mockRejectedValue(new Error("fail"));
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: { active: "llama3", installed: ["llama3"], catalog: [] },
            vision: {
                active: "",
                installed: ["llava"],
                catalog: [{ name: "llava", size_gb: 4.7, min_ram_gb: 8, description: "Vision", installed: true }],
            },
        });
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-vision-select")!;
        (select as any).value = "llava";
        select.trigger("change");
        await tick();

        expect(Notice.instances.some((n) => n.message.includes("failed to switch vision"))).toBe(true);
    });

    it("separator key does nothing in vision selector", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-vision-select")!;
        (select as any).value = "__separator__";
        select.trigger("change");
        await tick();

        expect(plugin.api.setVisionModel).not.toHaveBeenCalled();
    });

    it("uninstalled catalog vision model triggers auto-pull", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: { active: "llama3", installed: ["llama3"], catalog: [] },
            vision: {
                active: "",
                installed: [],
                catalog: [
                    { name: "llava", size_gb: 4.7, min_ram_gb: 8, description: "Vision", installed: false },
                ],
            },
        });

        async function* fakePull() {
            yield { status: "pulling", completed: 50, total: 100 };
            yield { status: "success" };
        }
        plugin.ollama.pull = vi.fn().mockReturnValue(fakePull());
        plugin.api.setVisionModel = vi.fn().mockResolvedValue({ model: "llava" });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-vision-select")!;
        (select as any).value = "llava";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(plugin.ollama.pull).toHaveBeenCalledWith("llava", expect.any(AbortSignal));
        expect(plugin.api.setVisionModel).toHaveBeenCalledWith("llava");
        expect(Notice.instances.some((n) => n.message === "lilbee: llava pulled and activated")).toBe(true);
    });

    it("vision auto-pull failure shows failure notice", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: { active: "llama3", installed: ["llama3"], catalog: [] },
            vision: {
                active: "",
                installed: [],
                catalog: [
                    { name: "llava", size_gb: 4.7, min_ram_gb: 8, description: "Vision", installed: false },
                ],
            },
        });

        async function* failingPull(): AsyncGenerator<never> {
            throw new Error("network");
        }
        plugin.ollama.pull = vi.fn().mockReturnValue(failingPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-vision-select")!;
        (select as any).value = "llava";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message.includes("failed to pull"))).toBe(true);
    });

    it("vision auto-pull with total=0 does not crash", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockResolvedValue({
            chat: { active: "llama3", installed: ["llama3"], catalog: [] },
            vision: {
                active: "",
                installed: [],
                catalog: [
                    { name: "llava", size_gb: 4.7, min_ram_gb: 8, description: "Vision", installed: false },
                ],
            },
        });

        async function* fakePull() {
            yield { status: "pulling", completed: 0, total: 0 };
            yield { status: "success" };
        }
        plugin.ollama.pull = vi.fn().mockReturnValue(fakePull());
        plugin.api.setVisionModel = vi.fn().mockResolvedValue({ model: "llava" });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-vision-select")!;
        (select as any).value = "llava";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(plugin.api.setVisionModel).toHaveBeenCalledWith("llava");
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
        const waitPromise = new Promise<void>((r) => { resolveWait = r; });
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

describe("ChatView — cancel model pull", () => {
    it("progress cancel button exists in banner", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const cancelBtn = container.find("lilbee-progress-cancel")!;
        expect(cancelBtn).not.toBeNull();
        expect(cancelBtn.tagName).toBe("BUTTON");
    });

    it("cancel button calls both pullController.abort and plugin.cancelSync", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const cancelBtn = container.find("lilbee-progress-cancel")!;

        // Trigger cancel click
        cancelBtn.trigger("click");

        expect((plugin as any).cancelSync).toHaveBeenCalled();
    });

    it("clicking cancel button during pull aborts and shows Pull cancelled Notice", async () => {
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
            vision: { active: "", installed: [], catalog: [] },
        });

        const abortError = new Error("Aborted");
        abortError.name = "AbortError";
        async function* abortingPull() {
            yield { status: "pulling", completed: 50, total: 100 };
            throw abortError;
        }
        plugin.ollama.pull = vi.fn().mockReturnValue(abortingPull());

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await tick();

        const container = view.containerEl.children[1] as unknown as MockElement;
        const select = container.find("lilbee-chat-model-select")!;
        (select as any).value = "phi3";
        select.trigger("change");
        await tick();
        await new Promise((r) => setTimeout(r, 50));

        expect(Notice.instances.some((n) => n.message === NOTICE.PULL_CANCELLED)).toBe(true);
    });
});


describe("ChatView — pull queue", () => {
    it("enqueueOrRunPull queues second pull while first is running", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();

        const firstRun = vi.fn().mockResolvedValue(undefined);
        const secondRun = vi.fn().mockResolvedValue(undefined);

        // Start first pull
        const p1 = (view as any).pullQueue.enqueue(firstRun);
        // Manually set pulling to simulate mid-pull state for queue test
        // (firstRun resolves immediately in test)
        await p1;
        expect(firstRun).toHaveBeenCalled();

        // Now test queue: start a slow first, queue a second
        let resolveSlow!: () => void;
        const slowRun = () => new Promise<void>((r) => { resolveSlow = r; });
        const p2 = (view as any).pullQueue.enqueue(slowRun);
        // Queue a second while slow is running
        (view as any).pullQueue.enqueue(secondRun);
        expect(Notice.instances.some((n) => n.message.startsWith("lilbee: download queued"))).toBe(true);
        expect(secondRun).not.toHaveBeenCalled();

        // Complete the slow pull
        resolveSlow();
        await p2;
        // Second should have run via runNextPull
        expect(secondRun).toHaveBeenCalled();
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
        const waitPromise = new Promise<void>((r) => { resolveWait = r; });
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
            vision: { active: "", installed: [], catalog: [] },
        });

        let resolveWait!: () => void;
        const waitPromise = new Promise<void>((r) => { resolveWait = r; });
        async function* slowPull() {
            yield { status: "pulling", completed: 50, total: 100 };
            await waitPromise;
            yield { status: "success" };
        }
        plugin.ollama.pull = vi.fn().mockReturnValue(slowPull());
        plugin.api.setChatModel = vi.fn().mockResolvedValue({ model: "phi3" });

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

describe("buildGenerationOptions", () => {
    it("returns empty object when all fields are null", () => {
        expect(buildGenerationOptions({
            temperature: null,
            top_p: null,
            top_k_sampling: null,
            repeat_penalty: null,
            num_ctx: null,
            seed: null,
        })).toEqual({});
    });

    it("includes only non-null fields", () => {
        expect(buildGenerationOptions({
            temperature: 0.7,
            top_p: null,
            top_k_sampling: 40,
            repeat_penalty: null,
            num_ctx: null,
            seed: null,
        })).toEqual({ temperature: 0.7, top_k: 40 });
    });

    it("maps top_k_sampling to top_k", () => {
        const opts = buildGenerationOptions({
            temperature: null,
            top_p: null,
            top_k_sampling: 50,
            repeat_penalty: null,
            num_ctx: null,
            seed: null,
        });
        expect(opts.top_k).toBe(50);
        expect((opts as any).top_k_sampling).toBeUndefined();
    });

    it("includes all fields when all are set", () => {
        expect(buildGenerationOptions({
            temperature: 0.8,
            top_p: 0.9,
            top_k_sampling: 40,
            repeat_penalty: 1.1,
            num_ctx: 4096,
            seed: 42,
        })).toEqual({
            temperature: 0.8,
            top_p: 0.9,
            top_k: 40,
            repeat_penalty: 1.1,
            num_ctx: 4096,
            seed: 42,
        });
    });
});

describe("ChatView.sendMessage — passes generation options", () => {
    it("passes non-null generation options to chatStream", async () => {
        Notice.clear();
        const plugin = makePlugin();
        plugin.settings.temperature = 0.5;
        plugin.settings.seed = 42;
        const { mockFn, done } = makeStream([{ event: SSE_EVENT.DONE, data: {} }]);
        plugin.api.chatStream = mockFn;
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const textarea = container.find("lilbee-chat-textarea")!;
        textarea.value = "hi";

        container.find("lilbee-chat-send")!.trigger("click");
        await done;

        expect(plugin.api.chatStream).toHaveBeenCalledWith(
            "hi", [], 5, expect.any(AbortSignal),
            { temperature: 0.5, seed: 42 },
        );
    });
});

describe("ChatView.createToolbar — toolbar icons", () => {
    it("renders message-circle and eye icons inside toolbar groups", async () => {
        Notice.clear();
        const plugin = makePlugin();
        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        const container = view.containerEl.children[1] as unknown as MockElement;
        const groups = container.findAll("lilbee-toolbar-group");
        expect(groups.length).toBe(2);
        const chatIcon = groups[0].find("lilbee-toolbar-icon")!;
        const visionIcon = groups[1].find("lilbee-toolbar-icon")!;
        expect(chatIcon.attributes["data-icon"]).toBe("message-circle");
        expect(visionIcon.attributes["data-icon"]).toBe("eye");
        expect(chatIcon.attributes["title"]).toBe("Chat model");
        expect(visionIcon.attributes["title"]).toBe("Vision model");
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
                vision: { active: "", installed: [], catalog: [] },
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

    it("shows Ollama notice only at threshold", async () => {
        const plugin = makePlugin();
        plugin.api.listModels = vi.fn().mockRejectedValue(new Error("offline"));

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        // First failure — no notice yet (connecting state)
        expect(Notice.instances.filter(
            (n) => n.message.includes("is Ollama running?"),
        ).length).toBe(0);

        // Second failure — still no notice
        await vi.advanceTimersByTimeAsync(5000);
        expect(Notice.instances.filter(
            (n) => n.message.includes("is Ollama running?"),
        ).length).toBe(0);

        // Third failure — notice fires at threshold
        await vi.advanceTimersByTimeAsync(5000);
        expect(Notice.instances.filter(
            (n) => n.message.includes("is Ollama running?"),
        ).length).toBe(1);

        // Fourth failure — no additional notice
        await vi.advanceTimersByTimeAsync(5000);
        expect(Notice.instances.filter(
            (n) => n.message.includes("is Ollama running?"),
        ).length).toBe(1);

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
                vision: { active: "", installed: [], catalog: [] },
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
                    vision: { active: "", installed: [], catalog: [] },
                });
            }
            return Promise.resolve({
                chat: { active: "llama3", installed: ["llama3"], catalog: [{ name: "llama3", installed: true }] },
                vision: { active: "", installed: [], catalog: [] },
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
            vision: { active: "", installed: [], catalog: [] },
        });

        const view = new ChatView(makeLeaf(), plugin);
        await view.onOpen();
        await vi.advanceTimersByTimeAsync(0);

        expect((view as any).retryTimer).not.toBeNull();

        await view.onClose();

        expect((view as any).retryTimer).toBeNull();
    });

    it("resets retryCount on success after failures", async () => {
        const plugin = makePlugin();
        let callCount = 0;
        plugin.api.listModels = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount <= 2) return Promise.reject(new Error("offline"));
            return Promise.resolve({
                chat: { active: "llama3", installed: ["llama3"], catalog: [] },
                vision: { active: "", installed: [], catalog: [] },
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
