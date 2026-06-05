import { vi, describe, it, expect, beforeEach } from "vitest";
import { App, MockElement, Notice } from "../__mocks__/obsidian";
import { RememberModal } from "../../src/views/remember-modal";
import type LilbeePlugin from "../../src/main";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function makePlugin(remember = vi.fn().mockResolvedValue({ id: "n1", kind: "fact" })) {
    const refreshMemoryViews = vi.fn();
    const plugin = {
        api: { remember },
        settings: { serverMode: "managed" },
        refreshMemoryViews,
    } as unknown as LilbeePlugin;
    return { plugin, remember, refreshMemoryViews };
}

function openModal(plugin: LilbeePlugin): { modal: RememberModal; contentEl: MockElement } {
    const modal = new RememberModal(new App(), plugin);
    modal.onOpen();
    return { modal, contentEl: (modal as unknown as { contentEl: MockElement }).contentEl };
}

beforeEach(() => Notice.clear());

describe("RememberModal.onOpen", () => {
    it("renders a textarea, kind select, share button, and actions", () => {
        const { contentEl } = openModal(makePlugin().plugin);
        expect(contentEl.classList.contains("lilbee-remember-modal")).toBe(true);
        expect(contentEl.find("lilbee-remember-text")).not.toBeNull();
        expect(contentEl.find("lilbee-remember-kind")).not.toBeNull();
        expect(contentEl.find("lilbee-remember-shared")).not.toBeNull();
        expect(contentEl.find("lilbee-remember-actions")).not.toBeNull();
        expect(contentEl.find("lilbee-remember-kind")!.options.map((o) => o.textContent)).toEqual([
            "Fact",
            "Preference",
        ]);
    });
});

describe("RememberModal submit", () => {
    it("warns and saves nothing when the text is empty", async () => {
        const { plugin, remember } = makePlugin();
        const { contentEl } = openModal(plugin);
        contentEl.find("lilbee-remember-actions")!.findAll("mod-cta")[0]!.trigger("click");
        await flush();
        expect(remember).not.toHaveBeenCalled();
        expect(Notice.instances.map((n) => n.message)).toContain("Enter something to remember.");
    });

    it("remembers a fact, notifies, refreshes, and closes", async () => {
        const { plugin, remember, refreshMemoryViews } = makePlugin();
        const { modal, contentEl } = openModal(plugin);
        const closeSpy = vi.spyOn(modal, "close");

        const textEl = contentEl.find("lilbee-remember-text")!;
        textEl.value = "  deadline is march  ";
        textEl.trigger("input");
        contentEl.find("lilbee-remember-actions")!.find("mod-cta")!.trigger("click");
        await flush();

        expect(remember).toHaveBeenCalledWith("deadline is march", "fact", false);
        expect(Notice.instances.map((n) => n.message)).toContain("Remembered (fact).");
        expect(refreshMemoryViews).toHaveBeenCalled();
        expect(closeSpy).toHaveBeenCalled();
    });

    it("remembers a shared preference when those controls are toggled", async () => {
        const { plugin, remember } = makePlugin(vi.fn().mockResolvedValue({ id: "p", kind: "preference" }));
        const { contentEl } = openModal(plugin);

        const textEl = contentEl.find("lilbee-remember-text")!;
        textEl.value = "use british english";
        textEl.trigger("input");

        const kindEl = contentEl.find("lilbee-remember-kind")!;
        kindEl.value = "preference";
        kindEl.trigger("change");

        contentEl.find("lilbee-remember-shared")!.trigger("click");
        contentEl.find("lilbee-remember-actions")!.find("mod-cta")!.trigger("click");
        await flush();

        expect(remember).toHaveBeenCalledWith("use british english", "preference", true);
        expect(Notice.instances.map((n) => n.message)).toContain("Remembered (preference).");
    });

    it("keeps the kind as fact when the select changes back from preference", async () => {
        const { plugin, remember } = makePlugin();
        const { contentEl } = openModal(plugin);
        const textEl = contentEl.find("lilbee-remember-text")!;
        textEl.value = "x";
        textEl.trigger("input");
        const kindEl = contentEl.find("lilbee-remember-kind")!;
        kindEl.value = "fact";
        kindEl.trigger("change");
        contentEl.find("lilbee-remember-actions")!.find("mod-cta")!.trigger("click");
        await flush();
        expect(remember).toHaveBeenCalledWith("x", "fact", false);
    });

    it("notifies on a save failure", async () => {
        const { plugin } = makePlugin(vi.fn().mockRejectedValue(new Error("offline")));
        const { contentEl } = openModal(plugin);
        const textEl = contentEl.find("lilbee-remember-text")!;
        textEl.value = "remember me";
        textEl.trigger("input");
        contentEl.find("lilbee-remember-actions")!.find("mod-cta")!.trigger("click");
        await flush();
        expect(Notice.instances.map((n) => n.message).join(" ")).toContain("Could not save the memory: offline");
    });

    it("closes when cancel is clicked", () => {
        const { plugin } = makePlugin();
        const { modal, contentEl } = openModal(plugin);
        const closeSpy = vi.spyOn(modal, "close");
        const cancel = contentEl.find("lilbee-remember-actions")!.children.find((c) => c.textContent === "Cancel")!;
        cancel.trigger("click");
        expect(closeSpy).toHaveBeenCalled();
    });
});
