import { App, Modal, Notice, setIcon } from "obsidian";
import type LilbeePlugin from "../main";
import { MESSAGES } from "../locales/en";
import { bindEscapeToClose, ensureUrlScheme } from "../utils";
import { CRAWL_RENDER_MODE, CRAWL_RENDER_MODE_CONFIG_KEY, type CrawlRenderMode } from "../types";

type ParseResult = { value: number | null; error: string | null };

function parseOptionalCount(raw: string, opts: { allowZero: boolean }): ParseResult {
    const errMsg = opts.allowZero ? MESSAGES.ERROR_CRAWL_DEPTH_INVALID : MESSAGES.ERROR_CRAWL_MAX_PAGES_POSITIVE;
    const trimmed = raw.trim();
    if (trimmed === "") return { value: null, error: null };
    const n = Number(trimmed);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
        return { value: null, error: errMsg };
    }
    if (n === 0 && !opts.allowZero) {
        return { value: null, error: errMsg };
    }
    return { value: n, error: null };
}

const asInput = (el: HTMLElement): HTMLInputElement => el as unknown as HTMLInputElement;

export class CrawlModal extends Modal {
    private plugin: LilbeePlugin;

    constructor(app: App, plugin: LilbeePlugin) {
        super(app);
        this.plugin = plugin;
        bindEscapeToClose(this);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("lilbee-crawl-modal");

        contentEl.createEl("h2", { text: MESSAGES.TITLE_CRAWL_WEB_PAGE });

        const urlInput = contentEl.createEl("input", {
            cls: "lilbee-crawl-url",
            placeholder: MESSAGES.PLACEHOLDER_URL,
            attr: { type: "text" },
        });

        const recursiveRow = contentEl.createDiv({ cls: "lilbee-crawl-recursive-row" });
        const recursiveLabel = recursiveRow.createEl("label", { cls: "lilbee-crawl-recursive" });
        const recursiveInput = recursiveLabel.createEl("input", {
            cls: "lilbee-crawl-recursive-input",
            attr: { type: "checkbox" },
        });
        asInput(recursiveInput).checked = false;
        recursiveLabel.createSpan({ text: MESSAGES.LABEL_CRAWL_RECURSIVE });

        const infoBtn = recursiveRow.createEl("button", {
            cls: "lilbee-crawl-info-btn",
            attr: {
                type: "button",
                "aria-label": MESSAGES.LABEL_CRAWL_RECURSIVE_INFO,
                "aria-expanded": "false",
            },
        });
        setIcon(infoBtn, "info");

        const notice = contentEl.createDiv({ cls: "lilbee-crawl-notice" });
        notice.setAttribute("hidden", "hidden");
        notice.textContent = MESSAGES.NOTICE_CRAWL_RECURSIVE;

        let noticeOpen = false;
        const setNoticeOpen = (open: boolean): void => {
            noticeOpen = open;
            if (open) {
                notice.removeAttribute("hidden");
                infoBtn.setAttribute("aria-expanded", "true");
            } else {
                notice.setAttribute("hidden", "hidden");
                infoBtn.setAttribute("aria-expanded", "false");
            }
        };
        infoBtn.addEventListener("click", () => setNoticeOpen(!noticeOpen));

        const browserRow = contentEl.createDiv({ cls: "lilbee-crawl-browser-row" });
        const browserLabel = browserRow.createEl("label", { cls: "lilbee-crawl-browser" });
        const browserInput = browserLabel.createEl("input", {
            cls: "lilbee-crawl-browser-input",
            attr: { type: "checkbox" },
        });
        asInput(browserInput).checked = false;
        browserLabel.createSpan({ text: MESSAGES.LABEL_CRAWL_USE_BROWSER });

        // Pre-set the toggle from the server's current crawl_render_mode (sticky default).
        void this.plugin.api
            .config()
            .then((cfg) => {
                asInput(browserInput).checked = cfg.crawl_render_mode === CRAWL_RENDER_MODE.BROWSER;
            })
            .catch(() => {
                /* Leave the toggle at its lightweight default if config is unreachable. */
            });

        const advanced = contentEl.createEl("details", { cls: "lilbee-crawl-advanced" });
        advanced.createEl("summary", { text: MESSAGES.LABEL_CRAWL_ADVANCED });

        const options = advanced.createDiv({ cls: "lilbee-crawl-options" });

        const depthLabel = options.createEl("label", { text: MESSAGES.LABEL_DEPTH });
        const depthInput = depthLabel.createEl("input", {
            cls: "lilbee-crawl-depth",
            placeholder: MESSAGES.HINT_CRAWL_BLANK_NO_LIMIT,
            attr: { type: "number", min: "0" },
        });
        asInput(depthInput).value = "";

        const maxLabel = options.createEl("label", { text: MESSAGES.LABEL_MAX_PAGES });
        const maxInput = maxLabel.createEl("input", {
            cls: "lilbee-crawl-max-pages",
            placeholder: MESSAGES.HINT_CRAWL_BLANK_NO_LIMIT,
            attr: { type: "number", min: "1" },
        });
        asInput(maxInput).value = "";

        // Error element lives OUTSIDE the Advanced disclosure so it's visible
        // even when the user collapses Advanced after typing bad input.
        const errorEl = contentEl.createEl("div", { cls: "lilbee-crawl-error" });

        const syncRecursiveState = (): void => {
            const recursive = asInput(recursiveInput).checked;
            asInput(depthInput).disabled = !recursive;
            asInput(maxInput).disabled = !recursive;
            advanced.style.display = recursive ? "" : "none";
            infoBtn.style.display = recursive ? "" : "none";
            if (!recursive) {
                errorEl.textContent = "";
                setNoticeOpen(false);
            }
        };
        recursiveInput.addEventListener("change", syncRecursiveState);
        syncRecursiveState();

        const actions = contentEl.createDiv({ cls: "lilbee-crawl-actions" });
        const crawlBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CRAWL, cls: "mod-cta" });
        crawlBtn.addEventListener("click", () => {
            const raw = asInput(urlInput).value.trim();
            if (!raw) {
                new Notice(MESSAGES.NOTICE_ENTER_URL);
                return;
            }
            const url = ensureUrlScheme(raw);

            const recursive = asInput(recursiveInput).checked;
            let depth: number | null;
            let maxPages: number | null;

            if (!recursive) {
                depth = 0;
                maxPages = null;
                errorEl.textContent = "";
            } else {
                const depthRes = parseOptionalCount(asInput(depthInput).value, { allowZero: true });
                const maxRes = parseOptionalCount(asInput(maxInput).value, { allowZero: false });
                const err = maxRes.error ?? depthRes.error;
                if (err) {
                    errorEl.textContent = err;
                    advanced.open = true;
                    return;
                }
                errorEl.textContent = "";
                depth = depthRes.value;
                maxPages = maxRes.value;
            }

            const renderMode: CrawlRenderMode = asInput(browserInput).checked
                ? CRAWL_RENDER_MODE.BROWSER
                : CRAWL_RENDER_MODE.HTTP;
            // Persist the choice so the toggle is sticky next time; the explicit render_mode below
            // drives this crawl regardless, so a failed write must not block it.
            void this.plugin.api.updateConfig({ [CRAWL_RENDER_MODE_CONFIG_KEY]: renderMode }).catch(() => {
                /* Non-fatal: the crawl still runs with the explicit render_mode below. */
            });

            void this.plugin.runCrawl(url, depth, maxPages, renderMode);
            this.close();
        });

        const cancelBtn = actions.createEl("button", { text: MESSAGES.BUTTON_CANCEL });
        cancelBtn.addEventListener("click", () => this.close());
    }
}
