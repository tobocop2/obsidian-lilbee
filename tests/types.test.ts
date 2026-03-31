import { vi, describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, SSE_EVENT, JSON_HEADERS, SERVER_MODE } from "../src/types";
import type {
    Excerpt,
    DocumentResult,
    AskResponse,
    Source,
    ModelInfo,
    ModelCatalog,
    ModelsResponse,
    StatusResponse,
    SyncDone,
    SSEEvent,
    Message,
    LilbeeSettings,
    GenerationOptions,
    ModelVariant,
    ModelFamily,
    CatalogResponse,
    InstalledModel,
    InstalledResponse,
    DocumentEntry,
    DocumentsResponse,
    ConfigUpdateResponse,
    EmbeddingModelResponse,
} from "../src/types";

describe("DEFAULT_SETTINGS", () => {
    it("has the correct serverUrl", () => {
        expect(DEFAULT_SETTINGS.serverUrl).toBe("http://127.0.0.1:7433");
    });

    it("has topK of 5", () => {
        expect(DEFAULT_SETTINGS.topK).toBe(5);
    });

    it("has syncMode set to manual", () => {
        expect(DEFAULT_SETTINGS.syncMode).toBe("manual");
    });

    it("has syncDebounceMs of 5000", () => {
        expect(DEFAULT_SETTINGS.syncDebounceMs).toBe(5000);
    });

    it("is a plain object with exactly the expected keys", () => {
        const keys = Object.keys(DEFAULT_SETTINGS).sort();
        const expected = [
            "adaptiveThreshold",
            "lilbeeVersion",
            "maxDistance",
            "num_ctx",
            "repeat_penalty",
            "seed",
            "serverMode",
            "serverPort",
            "serverUrl",
            "setupCompleted",
            "syncDebounceMs",
            "syncMode",
            "systemPrompt",
            "temperature",
            "topK",
            "top_k_sampling",
            "top_p",
        ].sort();
        expect(keys).toEqual(expected);
    });
});

// Interface shape tests — TypeScript compiles these so runtime values
// are only needed for the constant; the interface tests below verify
// that objects conforming to each interface can be assigned correctly.

describe("Excerpt interface", () => {
    it("accepts all fields including nulls", () => {
        const e: Excerpt = {
            content: "some text",
            page_start: 1,
            page_end: 2,
            line_start: 10,
            line_end: 20,
            relevance: 0.95,
        };
        expect(e.content).toBe("some text");
        expect(e.relevance).toBe(0.95);
    });

    it("accepts null for optional page/line fields", () => {
        const e: Excerpt = {
            content: "text",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
            relevance: 0.5,
        };
        expect(e.page_start).toBeNull();
        expect(e.line_end).toBeNull();
    });
});

describe("DocumentResult interface", () => {
    it("holds a list of excerpts", () => {
        const excerpt: Excerpt = {
            content: "chunk",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
            relevance: 0.8,
        };
        const doc: DocumentResult = {
            source: "file.md",
            content_type: "text/markdown",
            excerpts: [excerpt],
            best_relevance: 0.8,
        };
        expect(doc.excerpts).toHaveLength(1);
        expect(doc.source).toBe("file.md");
    });
});

describe("Source interface", () => {
    it("accepts required fields", () => {
        const s: Source = {
            source: "doc.pdf",
            content_type: "application/pdf",
            distance: 0.12,
            chunk: "some text",
            page_start: null,
            page_end: null,
            line_start: null,
            line_end: null,
        };
        expect(s.page_start).toBeNull();
        expect(s.distance).toBe(0.12);
    });

    it("accepts all optional fields", () => {
        const s: Source = {
            source: "doc.pdf",
            content_type: "application/pdf",
            distance: 0.1,
            chunk: "text",
            page_start: 1,
            page_end: 2,
            line_start: 5,
            line_end: 10,
        };
        expect(s.page_end).toBe(2);
        expect(s.line_start).toBe(5);
    });
});

describe("AskResponse interface", () => {
    it("holds answer and sources", () => {
        const r: AskResponse = {
            answer: "42",
            sources: [],
        };
        expect(r.answer).toBe("42");
        expect(r.sources).toEqual([]);
    });
});

describe("ModelInfo interface", () => {
    it("captures all model metadata", () => {
        const m: ModelInfo = {
            name: "llama3",
            size_gb: 4.7,
            min_ram_gb: 8,
            description: "A good model",
            installed: true,
        };
        expect(m.installed).toBe(true);
    });
});

describe("ModelCatalog interface", () => {
    it("has active model and catalog list", () => {
        const c: ModelCatalog = {
            active: "llama3",
            catalog: [],
            installed: ["llama3"],
        };
        expect(c.active).toBe("llama3");
    });
});

describe("ModelsResponse interface", () => {
    it("has chat and vision catalogs", () => {
        const catalog: ModelCatalog = { active: "m", catalog: [], installed: [] };
        const r: ModelsResponse = { chat: catalog, vision: catalog };
        expect(r.chat).toBe(catalog);
        expect(r.vision).toBe(catalog);
    });
});

describe("StatusResponse interface", () => {
    it("holds config, sources, and total_chunks", () => {
        const s: StatusResponse = {
            config: { model: "llama3" },
            sources: [{ filename: "a.md", chunk_count: 3 }],
            total_chunks: 3,
        };
        expect(s.total_chunks).toBe(3);
        expect(s.sources[0].filename).toBe("a.md");
    });
});

describe("SyncDone interface", () => {
    it("holds sync result summary", () => {
        const d: SyncDone = {
            added: ["a.md"],
            updated: [],
            removed: ["b.md"],
            unchanged: 10,
            failed: [],
        };
        expect(d.added).toContain("a.md");
        expect(d.unchanged).toBe(10);
    });
});

describe("SSEEvent interface", () => {
    it("holds event name and arbitrary data", () => {
        const e: SSEEvent = { event: "progress", data: { pct: 50 } };
        expect(e.event).toBe("progress");
    });
});

describe("Message interface", () => {
    it("accepts user role", () => {
        const m: Message = { role: "user", content: "hello" };
        expect(m.role).toBe("user");
    });

    it("accepts assistant role", () => {
        const m: Message = { role: "assistant", content: "hi" };
        expect(m.role).toBe("assistant");
    });

    it("accepts system role", () => {
        const m: Message = { role: "system", content: "you are helpful" };
        expect(m.role).toBe("system");
    });
});

describe("LilbeeSettings interface", () => {
    it("accepts manual syncMode", () => {
        const s: LilbeeSettings = {
            serverUrl: "http://localhost:7433",
            maxDistance: 0.9,
            adaptiveThreshold: false,
            topK: 3,
            syncMode: "manual",
            syncDebounceMs: 2000,
            temperature: null,
            top_p: null,
            top_k_sampling: null,
            repeat_penalty: null,
            num_ctx: null,
            seed: null,
            serverMode: "managed",
            serverPort: null,
            lilbeeVersion: "",
            systemPrompt: "",
            setupCompleted: false,
        };
        expect(s.syncMode).toBe("manual");
    });

    it("accepts auto syncMode", () => {
        const s: LilbeeSettings = {
            serverUrl: "http://localhost:7433",
            maxDistance: 0.9,
            adaptiveThreshold: false,
            topK: 3,
            syncMode: "auto",
            syncDebounceMs: 2000,
            temperature: null,
            top_p: null,
            top_k_sampling: null,
            repeat_penalty: null,
            num_ctx: null,
            seed: null,
            serverMode: "managed",
            serverPort: null,
            lilbeeVersion: "",
            systemPrompt: "",
            setupCompleted: true,
        };
        expect(s.syncMode).toBe("auto");
    });
});

describe("SSE_EVENT constants", () => {
    it("has all expected event types", () => {
        expect(SSE_EVENT.TOKEN).toBe("token");
        expect(SSE_EVENT.REASONING).toBe("reasoning");
        expect(SSE_EVENT.SOURCES).toBe("sources");
        expect(SSE_EVENT.DONE).toBe("done");
        expect(SSE_EVENT.ERROR).toBe("error");
        expect(SSE_EVENT.PROGRESS).toBe("progress");
        expect(SSE_EVENT.MESSAGE).toBe("message");
        expect(SSE_EVENT.FILE_START).toBe("file_start");
        expect(SSE_EVENT.EXTRACT).toBe("extract");
        expect(SSE_EVENT.EMBED).toBe("embed");
        expect(SSE_EVENT.FILE_DONE).toBe("file_done");
        expect(SSE_EVENT.CRAWL_START).toBe("crawl_start");
        expect(SSE_EVENT.CRAWL_PAGE).toBe("crawl_page");
        expect(SSE_EVENT.CRAWL_DONE).toBe("crawl_done");
        expect(SSE_EVENT.CRAWL_ERROR).toBe("crawl_error");
    });
});

describe("SERVER_MODE constants", () => {
    it("has MANAGED and EXTERNAL values", () => {
        expect(SERVER_MODE.MANAGED).toBe("managed");
        expect(SERVER_MODE.EXTERNAL).toBe("external");
    });
});

describe("JSON_HEADERS constant", () => {
    it("has Content-Type application/json", () => {
        expect(JSON_HEADERS["Content-Type"]).toBe("application/json");
    });
});

describe("ModelVariant interface", () => {
    it("accepts all fields", () => {
        const v: ModelVariant = {
            name: "8B",
            hf_repo: "qwen/qwen3-8B",
            size_gb: 5.0,
            min_ram_gb: 8,
            description: "Medium model",
            task: "chat",
            installed: true,
            source: "native",
        };
        expect(v.name).toBe("8B");
        expect(v.hf_repo).toBe("qwen/qwen3-8B");
        expect(v.installed).toBe(true);
        expect(v.source).toBe("native");
        expect(v.task).toBe("chat");
    });
});

describe("ModelFamily interface", () => {
    it("accepts all fields", () => {
        const f: ModelFamily = {
            family: "Qwen3",
            task: "chat",
            featured: true,
            recommended: "8B",
            variants: [],
        };
        expect(f.family).toBe("Qwen3");
        expect(f.featured).toBe(true);
        expect(f.recommended).toBe("8B");
    });
});

describe("CatalogResponse interface", () => {
    it("holds paginated catalog results", () => {
        const r: CatalogResponse = {
            total: 50,
            limit: 20,
            offset: 0,
            families: [],
        };
        expect(r.total).toBe(50);
    });
});

describe("InstalledModel interface", () => {
    it("holds model name and source", () => {
        const m: InstalledModel = { name: "qwen3:8b", source: "native" };
        expect(m.source).toBe("native");
    });
});

describe("InstalledResponse interface", () => {
    it("holds list of installed models", () => {
        const r: InstalledResponse = { models: [{ name: "qwen3:8b", source: "native" }] };
        expect(r.models).toHaveLength(1);
    });
});

describe("DocumentEntry interface", () => {
    it("holds document metadata", () => {
        const d: DocumentEntry = {
            filename: "notes.md",
            chunk_count: 5,
            ingested_at: "2026-03-28T00:00:00Z",
        };
        expect(d.chunk_count).toBe(5);
    });
});

describe("DocumentsResponse interface", () => {
    it("holds paginated documents", () => {
        const r: DocumentsResponse = {
            documents: [],
            total: 0,
            limit: 50,
            offset: 0,
        };
        expect(r.total).toBe(0);
    });
});

describe("ConfigUpdateResponse interface", () => {
    it("holds updated fields and reindex flag", () => {
        const r: ConfigUpdateResponse = {
            updated: ["temperature", "chunk_size"],
            reindex_required: true,
        };
        expect(r.reindex_required).toBe(true);
        expect(r.updated).toContain("chunk_size");
    });
});

describe("EmbeddingModelResponse interface", () => {
    it("holds model name", () => {
        const r: EmbeddingModelResponse = { model: "nomic-embed-text-v1.5" };
        expect(r.model).toBe("nomic-embed-text-v1.5");
    });
});
