import { vi, describe, it, expect, beforeEach } from "vitest";
import { Notice } from "obsidian";
import { applyProfile } from "../../src/utils/reindex";
import { MESSAGES } from "../../src/locales/en";
import { APPLY } from "../profile-fixtures";

function makePlugin(reindexRequired: boolean) {
    return {
        triggerSync: vi.fn(),
        api: { applyProfile: vi.fn().mockResolvedValue({ ...APPLY, reindex_required: reindexRequired }) },
    };
}

describe("applyProfile", () => {
    beforeEach(() => Notice.clear());

    it("rebuilds the index when the user asked to and the server says the change needs it", async () => {
        const plugin = makePlugin(true);
        const result = await applyProfile(plugin, "Notes and markdown", true);
        expect(plugin.api.applyProfile).toHaveBeenCalledWith("Notes and markdown");
        expect(plugin.triggerSync).toHaveBeenCalledWith({ forceRebuild: true });
        expect(Notice.instances.map((n) => n.message)).toContain(MESSAGES.NOTICE_REINDEX_REQUIRED);
        expect(result.name).toBe("Notes and markdown");
    });

    it("leaves the index alone when the user chose Apply without reindex", async () => {
        const plugin = makePlugin(true);
        await applyProfile(plugin, "Notes and markdown", false);
        expect(plugin.triggerSync).not.toHaveBeenCalled();
    });

    it("runs no sync when the server says nothing needs a rebuild", async () => {
        const plugin = makePlugin(false);
        await applyProfile(plugin, "Notes and markdown", true);
        expect(plugin.triggerSync).not.toHaveBeenCalled();
    });
});
