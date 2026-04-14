import type { DataAdapter } from "obsidian";
import type { WikiPage, WikiPageDetail } from "./types";
import type { LilbeeClient } from "./api";

const MANAGED_MARKER = "lilbee_managed: true";

function pageVaultPath(folder: string, page: WikiPage): string {
    // The slug already includes the subdir (e.g. "summaries/lilbee for Obsidian")
    return `${folder}/${page.slug}.md`;
}

function buildFileContent(page: WikiPageDetail): string {
    // The server's content already includes frontmatter (generated_by, sources, etc.).
    // We prepend only the managed marker so the plugin can identify synced files.
    const marker = `<!-- ${MANAGED_MARKER} -->\n`;
    return `${marker}${page.content}`;
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
        const publishedPages = pages.filter((p) => p.page_type === "summary" || p.page_type === "synthesis");

        await this.ensureFolders();

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
        await this.ensureFolders();
        await this.vault.write(path, buildFileContent(detail));
    }

    async removeStalePages(currentPages: WikiPage[]): Promise<number> {
        const currentPaths = new Set(currentPages.map((p) => pageVaultPath(this.folder, p)));

        let removed = 0;
        for (const subdir of ["summaries", "concepts"]) {
            const dirPath = `${this.folder}/${subdir}`;
            const dirExists = await this.vault.exists(dirPath);
            if (!dirExists) continue;

            const listing = await this.vault.list(dirPath);
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

    private async ensureFolders(): Promise<void> {
        for (const dir of [this.folder, `${this.folder}/summaries`, `${this.folder}/concepts`]) {
            const exists = await this.vault.exists(dir);
            if (!exists) {
                await this.vault.mkdir(dir);
            }
        }
    }
}

export { pageVaultPath, buildFileContent, isManagedFile, MANAGED_MARKER };
