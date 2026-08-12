import type { DataAdapter } from "obsidian";
import type { WikiPage, WikiPageDetail } from "./types";
import { PUBLISHED_WIKI_PAGE_TYPES } from "./types";
import type { LilbeeClient } from "./api";

const MANAGED_MARKER = "lilbee_managed";

function pageVaultPath(folder: string, page: WikiPage): string {
    // The slug already includes the subdir (e.g. "summaries/lilbee for Obsidian")
    return `${folder}/${page.slug}.md`;
}

function buildFileContent(page: WikiPageDetail): string {
    // The server's content already includes YAML frontmatter (generated_by, sources, etc.).
    // Inject the managed marker into the frontmatter so Obsidian parses it correctly.
    // Obsidian requires `---` as the very first line to recognize frontmatter.
    const content = page.content;
    if (content.startsWith("---\n")) {
        return content.replace("---\n", `---\n${MANAGED_MARKER}: true\n`);
    }
    // No frontmatter — wrap content with frontmatter containing only the marker
    return `---\n${MANAGED_MARKER}: true\n---\n\n${content}`;
}

function isManagedFile(content: string): boolean {
    return content.includes(MANAGED_MARKER);
}

export class WikiSync {
    private api: LilbeeClient;
    private vault: DataAdapter;
    private folder: string;

    constructor(api: LilbeeClient, vault: DataAdapter, folder: string) {
        this.api = api;
        this.vault = vault;
        this.folder = folder;
    }

    async reconcile(): Promise<{ written: number; removed: number }> {
        const pages = await this.api.wikiList();
        const publishedPages = pages.filter((p) => PUBLISHED_WIKI_PAGE_TYPES.has(p.page_type));

        await this.ensureFolders(publishedPages);

        let written = 0;
        for (const page of publishedPages) {
            const path = pageVaultPath(this.folder, page);
            const needsWrite = await this.needsUpdate(path, page);
            if (needsWrite) {
                const detail = await this.api.wikiPage(page.slug);
                await this.vault.write(path, buildFileContent(detail));
                written++;
            }
        }

        const removed = await this.removeStalePages(publishedPages);
        return { written, removed };
    }

    async writePage(slug: string): Promise<void> {
        const detail = await this.api.wikiPage(slug);
        const path = pageVaultPath(this.folder, detail);
        await this.ensureFolders([detail]);
        await this.vault.write(path, buildFileContent(detail));
    }

    async removeStalePages(currentPages: WikiPage[]): Promise<number> {
        const currentPaths = new Set(currentPages.map((p) => pageVaultPath(this.folder, p)));

        // Walk whatever folders are actually there. Naming summaries and
        // concepts here left every entity page unprunable: a page deleted on
        // the server stayed in the vault forever, because the folder holding it
        // was never looked at.
        let removed = 0;
        const queue: string[] = [this.folder];
        while (queue.length > 0) {
            const dirPath = queue.pop()!;
            const dirExists = await this.vault.exists(dirPath);
            if (!dirExists) continue;

            const listing = await this.vault.list(dirPath);
            queue.push(...listing.folders);
            for (const filePath of listing.files) {
                if (!filePath.endsWith(".md")) continue;
                if (currentPaths.has(filePath)) continue;

                const content = await this.vault.read(filePath);
                if (isManagedFile(content)) {
                    await this.vault.remove(filePath);
                    removed++;
                }
            }
        }
        return removed;
    }

    isWikiPath(path: string): boolean {
        return path.startsWith(this.folder + "/");
    }

    private async needsUpdate(path: string, page: WikiPage): Promise<boolean> {
        const exists = await this.vault.exists(path);
        if (!exists) return true;

        const content = await this.vault.read(path);
        if (!isManagedFile(content)) return false;

        const match = content.match(/generated_at:\s*(.+)/);
        if (!match) return true;
        return page.created_at === null || match[1].trim() !== page.created_at;
    }

    /**
     * Create every folder the given pages will be written into.
     *
     * Derived from the slugs rather than listed here. The list used to name
     * summaries and concepts only, so entity pages — fifty of the fifty-four in
     * a real wiki — were written into a folder that did not exist. `write`
     * rejects on a missing parent, that aborted the reconcile loop partway, and
     * the caller treats reconcile as best-effort, so most of the wiki silently
     * never reached the vault. Synthesis pages had the same problem.
     */
    private async ensureFolders(pages: readonly WikiPage[]): Promise<void> {
        const dirs = new Set<string>([this.folder]);
        for (const page of pages) {
            const segments = `${this.folder}/${page.slug}`.split("/");
            segments.pop(); // drop the file name
            for (let i = 1; i <= segments.length; i++) {
                dirs.add(segments.slice(0, i).join("/"));
            }
        }
        // Shallowest first, so a nested folder is never created before its parent.
        for (const dir of [...dirs].sort((a, b) => a.length - b.length)) {
            const exists = await this.vault.exists(dir);
            if (!exists) {
                await this.vault.mkdir(dir);
            }
        }
    }
}

export { pageVaultPath, buildFileContent, isManagedFile, MANAGED_MARKER };
