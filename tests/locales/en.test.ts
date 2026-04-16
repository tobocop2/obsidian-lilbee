import { describe, it, expect } from "vitest";
import { MESSAGES, FILTERS, TASK_LABELS, RELATIVE_TIME } from "../../src/locales/en";
import { MODEL_TASK } from "../../src/types";

describe("MESSAGES", () => {
    describe("BUTTON_ constants", () => {
        it("has all button labels", () => {
            expect(MESSAGES.BUTTON_SKIP_SETUP).toBe("Skip setup");
            expect(MESSAGES.BUTTON_GET_STARTED).toBe("Get started");
            expect(MESSAGES.BUTTON_BACK).toBe("Back");
            expect(MESSAGES.BUTTON_NEXT).toBe("Next");
            expect(MESSAGES.BUTTON_CONTINUE).toBe("Continue");
            expect(MESSAGES.BUTTON_CANCEL).toBe("Cancel");
            expect(MESSAGES.BUTTON_PULL).toBe("Pull");
            expect(MESSAGES.BUTTON_PULL_MODEL).toBe("Pull Model");
            expect(MESSAGES.BUTTON_USE).toBe("Use");
            expect(MESSAGES.BUTTON_REMOVE).toBe("Delete");
            expect(MESSAGES.BUTTON_REFRESH).toBe("Refresh");
            expect(MESSAGES.BUTTON_BROWSE_CATALOG).toBe("Browse Catalog");
            expect(MESSAGES.BUTTON_BROWSE_FULL_CATALOG).toBe("Browse full catalog");
            expect(MESSAGES.BUTTON_DOWNLOAD_CONTINUE).toBe("Download & continue");
            expect(MESSAGES.BUTTON_DELETE_SELECTED).toBe("Delete selected");
            expect(MESSAGES.BUTTON_LOAD_MORE).toBe("Load more");
            expect(MESSAGES.BUTTON_CRAWL).toBe("Crawl");
            expect(MESSAGES.BUTTON_START).toBe("Start");
            expect(MESSAGES.BUTTON_STOP).toBe("Stop");
            expect(MESSAGES.BUTTON_RESTART).toBe("Restart");
            expect(MESSAGES.BUTTON_TEST).toBe("Test");
            expect(MESSAGES.BUTTON_RESET_MANAGED).toBe("Reset to managed");
            expect(MESSAGES.BUTTON_RUN_SETUP_WIZARD).toBe("Run setup wizard");
            expect(MESSAGES.BUTTON_CHECK_UPDATES).toBe("Check for updates");
            expect(MESSAGES.BUTTON_CLEAR_TASKS).toBe("Clear");
            expect(MESSAGES.BUTTON_CLEAR_CHAT).toBe("Clear chat");
            expect(MESSAGES.BUTTON_SEND).toBe("Send");
            expect(MESSAGES.BUTTON_OPEN_CHAT).toBe("Open chat");
        });
    });

    describe("LABEL_ constants", () => {
        it("has all label constants", () => {
            expect(MESSAGES.LABEL_DISABLED).toBe("Disabled");
            expect(MESSAGES.LABEL_NOT_SET).toBe("Not set");
            expect(MESSAGES.LABEL_NO_MODEL_SELECTED).toBe("no model selected");
            expect(MESSAGES.LABEL_ALL_TASKS).toBe("All tasks");
            expect(MESSAGES.LABEL_ALL_SIZES).toBe("All sizes");
            expect(MESSAGES.LABEL_FEATURED).toBe("Featured");
            expect(MESSAGES.LABEL_DOWNLOADS).toBe("Downloads");
            expect(MESSAGES.LABEL_NAME).toBe("Name");
            expect(MESSAGES.LABEL_SIZE_ASC).toBe("Size (asc)");
            expect(MESSAGES.LABEL_SIZE_DESC).toBe("Size (desc)");
            expect(MESSAGES.LABEL_ACTIVE).toBe("Active");
            expect(MESSAGES.LABEL_INSTALLED).toBe("Installed");
            expect(MESSAGES.LABEL_NOT_INSTALLED).toBe(" (not installed)");
            expect(MESSAGES.LABEL_MODEL).toBe("Model");
            expect(MESSAGES.LABEL_SIZE).toBe("Size");
            expect(MESSAGES.LABEL_DESCRIPTION).toBe("Description");
            expect(MESSAGES.LABEL_CHAT_MODEL).toBe("Chat Model");
            expect(MESSAGES.LABEL_OCR_AUTO).toBe("OCR: Auto");
            expect(MESSAGES.LABEL_OCR_ON).toBe("OCR: On");
            expect(MESSAGES.LABEL_OCR_OFF).toBe("OCR: Off");
            expect(MESSAGES.LABEL_REASONING).toBe("Reasoning");
            expect(MESSAGES.LABEL_SOURCES).toBe("Sources");
            expect(MESSAGES.LABEL_OUR_PICKS).toBe("Our picks");
            expect(MESSAGES.LABEL_SECTION_INSTALLED).toBe("Installed");
            expect(MESSAGES.LABEL_SECTION_CHAT).toBe("Chat");
            expect(MESSAGES.LABEL_SECTION_EMBEDDING).toBe("Embedding");
            expect(MESSAGES.LABEL_SECTION_VISION).toBe("Vision");
            expect(MESSAGES.LABEL_PICK).toBe("pick");
            expect(MESSAGES.LABEL_SWITCH_TO_LIST).toBe("Switch to list view");
            expect(MESSAGES.LABEL_SWITCH_TO_GRID).toBe("Switch to grid view");
            expect(MESSAGES.LABEL_BROWSE_MORE).toBe("Browse more models");
            expect(MESSAGES.LABEL_VIEW_TOGGLE_CTA).toBe("Switch to list view for the full catalog");
            expect(MESSAGES.LABEL_NO_MODELS_FOUND).toBe("No models match your filters.");
            expect(MESSAGES.LABEL_TASK).toBe("Task");
            expect(MESSAGES.LABEL_QUANT).toBe("Quant");
            expect(MESSAGES.LABEL_DOWNLOADS_COUNT("1.5K")).toBe("1.5K downloads");
            expect(MESSAGES.LABEL_SIZE_SMALL).toBe("Small");
            expect(MESSAGES.LABEL_SIZE_MEDIUM).toBe("Medium");
            expect(MESSAGES.LABEL_SIZE_LARGE).toBe("Large");
            expect(MESSAGES.LABEL_DOWNLOAD_QUEUED).toBe("+{count} queued");
        });
    });

    describe("TITLE_ constants", () => {
        it("has all title constants", () => {
            expect(MESSAGES.TITLE_SEARCH).toBe("Search knowledge base");
            expect(MESSAGES.TITLE_MODEL_CATALOG).toBe("Model Catalog");
            expect(MESSAGES.TITLE_DOCUMENTS).toBe("Documents");
            expect(MESSAGES.TITLE_CRAWL_WEB_PAGE).toBe("Crawl web page");
            expect(MESSAGES.TITLE_DOWNLOAD_MODEL).toBe("Download model?");
            expect(MESSAGES.TITLE_WELCOME).toBe("Welcome to lilbee");
            expect(MESSAGES.TITLE_SERVER_MODE).toBe("How do you want to run lilbee?");
            expect(MESSAGES.TITLE_PICK_MODEL).toBe("Pick a chat model");
            expect(MESSAGES.TITLE_INDEX_VAULT).toBe("Index your vault");
            expect(MESSAGES.TITLE_ALL_SET).toBe("You're all set!");
        });
    });

    describe("DESC_ constants", () => {
        it("has all description constants", () => {
            expect(MESSAGES.DESC_SERVER_MODE).toBe("How the lilbee server is managed");
            expect(MESSAGES.DESC_MANAGED_BUILTIN).toBe("Managed (built-in)");
            expect(MESSAGES.DESC_EXTERNAL_MANUAL).toBe("External (manual)");
            expect(MESSAGES.DESC_MODELS_HELP).toBe(
                "Browse the catalog for available models. Requires the lilbee server.",
            );
            expect(MESSAGES.DESC_SYNC_MANUAL).toBe("Manual (command only)");
            expect(MESSAGES.DESC_SYNC_AUTO).toBe("Auto (watch for changes)");
            expect(MESSAGES.DESC_RESULTS_COUNT).toBe(
                "How many matching passages to return when you search or ask a question",
            );
            expect(MESSAGES.DESC_MAX_DISTANCE).toBe(
                "How closely results must match your query. Lower = only very close matches, higher = broader results",
            );
            expect(MESSAGES.DESC_ADAPTIVE_THRESHOLD).toBe(
                "Automatically broaden the search if too few results are found",
            );
            expect(MESSAGES.DESC_CRAWL_MAX_DEPTH).toBe("How many links deep to follow (0 = just the page itself)");
            expect(MESSAGES.DESC_CRAWL_MAX_PAGES).toBe("Maximum number of pages to crawl from a website");
            expect(MESSAGES.DESC_CRAWL_TIMEOUT).toBe("How long to wait for each page to load before giving up");
            expect(MESSAGES.DESC_CHUNK_SIZE).toBe(
                "How many tokens per text segment. Most users should not change this.",
            );
            expect(MESSAGES.DESC_CHUNK_OVERLAP).toBe(
                "Token overlap between segments. Most users should not change this.",
            );
            expect(MESSAGES.DESC_EMBEDDING_MODEL).toBe(
                "The AI model used to understand your documents. Changing requires re-indexing.",
            );
            expect(MESSAGES.DESC_LLM_PROVIDER).toBe(
                "Auto picks the best available. Use External to connect to OpenAI, Claude, or other services.",
            );
            expect(MESSAGES.DESC_LLM_PROVIDER_AUTO).toBe("Auto (recommended)");
            expect(MESSAGES.DESC_LLM_PROVIDER_EXTERNAL).toBe("External (OpenAI, Claude, etc.)");
            expect(MESSAGES.DESC_API_KEY).toBe(
                "Your API key for external AI services (OpenAI, Anthropic, etc.). Stored securely on the server.",
            );
            expect(MESSAGES.DESC_HF_TOKEN).toBe(
                "Needed for some models. Get one free at huggingface.co/settings/tokens",
            );
            expect(MESSAGES.DESC_LITELLM_BASE_URL).toBe(
                "The URL of your external AI service. Only needed when using the External backend.",
            );
            expect(MESSAGES.DESC_WIKI_PRUNE_RAW).toBe(
                "After wiki summaries are created, remove the original text chunks that were summarized",
            );
            expect(MESSAGES.DESC_WIKI_FAITHFULNESS).toBe(
                "How accurate wiki summaries must be. Higher = stricter quality, lower = more content",
            );
            expect(MESSAGES.DESC_WIKI_RUN_LINT).toBe(
                "Scan wiki pages for broken references, missing sources, or outdated content",
            );
            expect(MESSAGES.DESC_WIKI_RUN_PRUNE).toBe(
                "Remove wiki pages that are outdated or no longer have valid sources",
            );
        });
    });

    describe("PLACEHOLDER_ constants", () => {
        it("has all placeholder constants", () => {
            expect(MESSAGES.PLACEHOLDER_AUTO).toBe("Auto");
            expect(MESSAGES.PLACEHOLDER_DEFAULT).toBe("Default");
            expect(MESSAGES.PLACEHOLDER_NOT_SET).toBe("Not set");
            expect(MESSAGES.PLACEHOLDER_SEARCH_MODELS).toBe("Search models...");
            expect(MESSAGES.PLACEHOLDER_SEARCH_DOCUMENTS).toBe("Search documents...");
            expect(MESSAGES.PLACEHOLDER_TYPE_SEARCH).toBe("Type to search...");
            expect(MESSAGES.PLACEHOLDER_HTTP_LOCALHOST).toBe("http://127.0.0.1:7433");
        });
    });

    describe("STATUS_ constants", () => {
        it("has all status constants", () => {
            expect(MESSAGES.STATUS_DOWNLOADING).toBe("lilbee: downloading...");
            expect(MESSAGES.STATUS_STARTING).toBe("lilbee: starting...");
            expect(MESSAGES.STATUS_READY).toBe("lilbee: ready");
            expect(MESSAGES.STATUS_READY_EXTERNAL).toBe("lilbee: ready [external]");
            expect(MESSAGES.STATUS_ERROR).toBe("lilbee: error");
            expect(MESSAGES.STATUS_STOPPED).toBe("lilbee: stopped");
            expect(MESSAGES.STATUS_DONE).toBe("Done!");
        });
    });

    describe("ERROR_ constants", () => {
        it("has all error constants", () => {
            expect(MESSAGES.ERROR_COULD_NOT_CONNECT).toBe("lilbee: cannot connect to server");
            expect(MESSAGES.ERROR_COULD_NOT_REACH).toBe("Could not connect to lilbee server. Is it running?");
            expect(MESSAGES.ERROR_LOAD_CATALOG).toBe("lilbee: failed to load catalog");
            expect(MESSAGES.ERROR_LOAD_DOCUMENTS).toBe("lilbee: failed to load documents");
            expect(MESSAGES.ERROR_SERVER_UNREACHABLE).toBe("Could not connect to lilbee server. Is it running?");
        });
    });

    describe("NOTICE_ template functions", () => {
        it("NOTICE_MODEL_ACTIVATED produces correct output", () => {
            expect(MESSAGES.NOTICE_MODEL_ACTIVATED("llama3")).toBe("Now using llama3");
            expect(MESSAGES.NOTICE_MODEL_ACTIVATED("qwen3:8b")).toBe("Now using qwen3:8b");
        });

        it("NOTICE_MODEL_ACTIVATED_FULL produces correct output", () => {
            expect(MESSAGES.NOTICE_MODEL_ACTIVATED_FULL("llama3")).toBe("lilbee: llama3 pulled and activated");
        });

        it("NOTICE_SET_MODEL produces correct output", () => {
            expect(MESSAGES.NOTICE_SET_MODEL("Chat model", "llama3")).toBe("Chat model set to llama3");
            expect(MESSAGES.NOTICE_SET_MODEL("Embedding", "bge")).toBe("Embedding set to bge");
        });

        it("NOTICE_FAILED_SET_MODEL produces correct output", () => {
            expect(MESSAGES.NOTICE_FAILED_SET_MODEL("chat")).toBe("Failed to set chat model");
            expect(MESSAGES.NOTICE_FAILED_SET_MODEL("embedding")).toBe("Failed to set embedding model");
        });

        it("NOTICE_UPDATED produces correct output", () => {
            expect(MESSAGES.NOTICE_UPDATED("Chunk size")).toBe("lilbee: Chunk size updated");
            expect(MESSAGES.NOTICE_UPDATED("Temperature")).toBe("lilbee: Temperature updated");
        });

        it("NOTICE_FAILED_UPDATE produces correct output", () => {
            expect(MESSAGES.NOTICE_FAILED_UPDATE("Chunk size")).toBe("lilbee: failed to update Chunk size");
        });

        it("NOTICE_FIELD_UPDATED produces correct output", () => {
            expect(MESSAGES.NOTICE_FIELD_UPDATED("Temperature")).toBe("lilbee: Temperature updated");
        });

        it("NOTICE_STATUS produces correct output", () => {
            expect(MESSAGES.NOTICE_STATUS(10, 50)).toBe("lilbee: 10 documents, 50 chunks");
            expect(MESSAGES.NOTICE_STATUS(0, 0)).toBe("lilbee: 0 documents, 0 chunks");
        });

        it("NOTICE_DELETED produces correct output", () => {
            expect(MESSAGES.NOTICE_DELETED(5)).toBe("lilbee: deleted 5 documents");
            expect(MESSAGES.NOTICE_DELETED(1)).toBe("lilbee: deleted 1 documents");
        });

        it("NOTICE_SAVED produces correct output", () => {
            expect(MESSAGES.NOTICE_SAVED("lilbee/chat-2026.md")).toBe("Saved to lilbee/chat-2026.md");
        });

        it("NOTICE_REMOVED produces correct output", () => {
            expect(MESSAGES.NOTICE_REMOVED("llama3")).toBe("Deleted llama3");
        });

        it("NOTICE_SYNC_SUMMARY produces correct output", () => {
            expect(MESSAGES.NOTICE_SYNC_SUMMARY("5 added, 2 updated")).toBe("lilbee: 5 added, 2 updated");
        });

        it("NOTICE_CRAWL_DONE produces correct output", () => {
            expect(MESSAGES.NOTICE_CRAWL_DONE(10)).toBe("lilbee: crawl done — 10 pages");
        });

        it("NOTICE_UPDATED_TO produces correct output", () => {
            expect(MESSAGES.NOTICE_UPDATED_TO("v0.1.0")).toBe("lilbee: updated to v0.1.0");
        });

        it("NOTICE_FAILED_UPDATE produces correct output", () => {
            expect(MESSAGES.NOTICE_FAILED_UPDATE("Chunk size")).toBe("lilbee: failed to update Chunk size");
        });

        it("NOTICE_STATUS produces correct output", () => {
            expect(MESSAGES.NOTICE_STATUS(10, 50)).toBe("lilbee: 10 documents, 50 chunks");
            expect(MESSAGES.NOTICE_STATUS(0, 0)).toBe("lilbee: 0 documents, 0 chunks");
        });

        it("NOTICE_DELETED produces correct output", () => {
            expect(MESSAGES.NOTICE_DELETED(5)).toBe("lilbee: deleted 5 documents");
            expect(MESSAGES.NOTICE_DELETED(1)).toBe("lilbee: deleted 1 documents");
        });

        it("NOTICE_SAVED produces correct output", () => {
            expect(MESSAGES.NOTICE_SAVED("lilbee/chat-2026.md")).toBe("Saved to lilbee/chat-2026.md");
        });

        it("NOTICE_REMOVED produces correct output", () => {
            expect(MESSAGES.NOTICE_REMOVED("llama3")).toBe("Deleted llama3");
        });

        it("NOTICE_CRAWL_DONE produces correct output", () => {
            expect(MESSAGES.NOTICE_CRAWL_DONE(10)).toBe("lilbee: crawl done — 10 pages");
        });

        it("NOTICE_SYNC_SUMMARY produces correct output", () => {
            expect(MESSAGES.NOTICE_SYNC_SUMMARY("5 added, 2 updated")).toBe("lilbee: 5 added, 2 updated");
        });

        it("NOTICE_UPDATED_TO produces correct output", () => {
            expect(MESSAGES.NOTICE_UPDATED_TO("v0.1.0")).toBe("lilbee: updated to v0.1.0");
        });

        it("NOTICE_PULL_MODEL produces correct output", () => {
            expect(MESSAGES.ERROR_PULL_MODEL).toBe("lilbee: failed to pull {model}");
        });

        it("LABEL_WIKI_SOURCES_COUNT produces correct output", () => {
            expect(MESSAGES.LABEL_WIKI_SOURCES_COUNT(3)).toBe("3 sources");
            expect(MESSAGES.LABEL_WIKI_SOURCES_COUNT(0)).toBe("0 sources");
            expect(MESSAGES.LABEL_WIKI_SOURCES_COUNT(1)).toBe("1 sources");
        });

        it("LABEL_LINT_ISSUES produces correct output", () => {
            expect(MESSAGES.LABEL_LINT_ISSUES(5, 2)).toBe("5 issues across 2 pages");
            expect(MESSAGES.LABEL_LINT_ISSUES(0, 0)).toBe("0 issues across 0 pages");
        });

        it("NOTICE_WIKI_LINT_DONE produces correct output", () => {
            expect(MESSAGES.NOTICE_WIKI_LINT_DONE(3)).toBe("lilbee: lint complete — 3 issues found");
            expect(MESSAGES.NOTICE_WIKI_LINT_DONE(0)).toBe("lilbee: lint complete — 0 issues found");
        });

        it("NOTICE_WIKI_GENERATE_DONE produces correct output", () => {
            expect(MESSAGES.NOTICE_WIKI_GENERATE_DONE("notes/foo.md")).toBe("lilbee: wiki generated for notes/foo.md");
        });

        it("NOTICE_WIKI_PRUNE_DONE produces correct output", () => {
            expect(MESSAGES.NOTICE_WIKI_PRUNE_DONE(5)).toBe("lilbee: pruned 5 pages");
            expect(MESSAGES.NOTICE_WIKI_PRUNE_DONE(0)).toBe("lilbee: pruned 0 pages");
        });

        it("NOTICE_WIKI_SYNC produces correct output", () => {
            expect(MESSAGES.NOTICE_WIKI_SYNC(3, 1)).toBe("lilbee: wiki sync — 3 written, 1 removed");
            expect(MESSAGES.NOTICE_WIKI_SYNC(0, 0)).toBe("lilbee: wiki sync — 0 written, 0 removed");
        });
    });

    describe("COMMAND_ constants", () => {
        it("has all command names", () => {
            expect(MESSAGES.COMMAND_SEARCH).toBe("Search knowledge base");
            expect(MESSAGES.COMMAND_CHAT).toBe("Open chat");
            expect(MESSAGES.COMMAND_ADD_FILE).toBe("Add current file to lilbee");
            expect(MESSAGES.COMMAND_ADD_FOLDER).toBe("Add current folder to lilbee");
            expect(MESSAGES.COMMAND_SYNC).toBe("Sync vault");
            expect(MESSAGES.COMMAND_CATALOG).toBe("Browse model catalog");
            expect(MESSAGES.COMMAND_CRAWL).toBe("Crawl web page");
            expect(MESSAGES.COMMAND_DOCUMENTS).toBe("Browse documents");
            expect(MESSAGES.COMMAND_SETUP).toBe("Run setup wizard");
            expect(MESSAGES.COMMAND_TASKS).toBe("Show task center");
            expect(MESSAGES.COMMAND_STATUS).toBe("Show status");
            expect(MESSAGES.COMMAND_ADD_TO_LILBEE).toBe("Add to lilbee");
        });
    });

    describe("WIZARD_ constants", () => {
        it("has all wizard strings", () => {
            expect(MESSAGES.WIZARD_INTRO_DESC).toContain("lilbee turns your Obsidian vault");
            expect(MESSAGES.WIZARD_INTRO_STEPS).toBe("This wizard will help you:");
            expect(MESSAGES.WIZARD_STEP_CHOOSE_MODEL).toBe("Choose an AI model that fits your computer");
            expect(MESSAGES.WIZARD_STEP_INDEX).toBe("Index your vault so you can search and chat");
            expect(MESSAGES.WIZARD_LOCAL_ONLY).toContain("Everything runs locally");
            expect(MESSAGES.WIZARD_MODEL_HELP).toContain("This is the AI that answers your questions");
            expect(MESSAGES.WIZARD_SUMMARY_FILES).toBe("{count} files indexed");
        });
    });

    describe("all strings are non-empty", () => {
        it("has no empty string values", () => {
            for (const [_key, value] of Object.entries(MESSAGES)) {
                if (typeof value === "string") {
                    expect(value.length > 0).toBe(true);
                } else if (typeof value === "function") {
                    // Template functions are tested separately
                }
            }
        });
    });
});

describe("FILTERS", () => {
    describe("TASK filter", () => {
        it("has correct values", () => {
            expect(FILTERS.TASK.ALL).toBe("");
            expect(FILTERS.TASK.CHAT).toBe("chat");
            expect(FILTERS.TASK.EMBEDDING).toBe("embedding");
            expect(FILTERS.TASK.VISION).toBe("vision");
        });
    });

    describe("SIZE filter", () => {
        it("has correct values", () => {
            expect(FILTERS.SIZE.ALL).toBe("");
            expect(FILTERS.SIZE.SMALL).toBe("small");
            expect(FILTERS.SIZE.MEDIUM).toBe("medium");
            expect(FILTERS.SIZE.LARGE).toBe("large");
        });
    });

    describe("SORT filter", () => {
        it("has correct values", () => {
            expect(FILTERS.SORT.FEATURED).toBe("featured");
            expect(FILTERS.SORT.DOWNLOADS).toBe("downloads");
            expect(FILTERS.SORT.NAME).toBe("name");
            expect(FILTERS.SORT.SIZE_ASC).toBe("size_asc");
            expect(FILTERS.SORT.SIZE_DESC).toBe("size_desc");
        });
    });
});

describe("TASK_LABELS", () => {
    it("has labels for all task types", () => {
        expect(TASK_LABELS[MODEL_TASK.CHAT]).toBe("Chat");
        expect(TASK_LABELS[MODEL_TASK.VISION]).toBe("Vision");
        expect(TASK_LABELS[MODEL_TASK.EMBEDDING]).toBe("Embedding");
    });
});

describe("RELATIVE_TIME", () => {
    it("produces correct relative time strings", () => {
        expect(RELATIVE_TIME.JUST_NOW).toBe("just now");
        expect(RELATIVE_TIME.MINUTES_AGO(5)).toBe("5m ago");
        expect(RELATIVE_TIME.HOURS_AGO(2)).toBe("2h ago");
        expect(RELATIVE_TIME.DAYS_AGO(1)).toBe("1d ago");
    });
});

describe("types", () => {
    it("ModelSize type has correct values", () => {
        const sizes: ("small" | "medium" | "large")[] = ["small", "medium", "large"];
        expect(sizes).toContain(FILTERS.SIZE.SMALL);
        expect(sizes).toContain(FILTERS.SIZE.MEDIUM);
        expect(sizes).toContain(FILTERS.SIZE.LARGE);
    });

    it("ModelSort type has correct values", () => {
        const sorts: ("featured" | "downloads" | "name" | "size_asc" | "size_desc")[] = [
            "featured",
            "downloads",
            "name",
            "size_asc",
            "size_desc",
        ];
        expect(sorts).toContain(FILTERS.SORT.FEATURED);
        expect(sorts).toContain(FILTERS.SORT.DOWNLOADS);
        expect(sorts).toContain(FILTERS.SORT.NAME);
        expect(sorts).toContain(FILTERS.SORT.SIZE_ASC);
        expect(sorts).toContain(FILTERS.SORT.SIZE_DESC);
    });
});
