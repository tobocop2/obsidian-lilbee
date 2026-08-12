// Obsidian's renderer always defines window/activeWindow/activeDocument; the
// Node test env does not, so mirror them onto globalThis. Pointing window at
// globalThis keeps vi.useFakeTimers() patching window.setTimeout too.
import { MockElement } from "./__mocks__/obsidian";

const g = globalThis as Record<string, unknown>;
if (typeof g.window === "undefined") g.window = globalThis;
if (typeof g.activeWindow === "undefined") g.activeWindow = globalThis;

// Obsidian exposes a bare `createSpan` global alongside the HTMLElement helpers;
// the Node test env does not, so mirror it onto a detached mock span.
if (typeof g.createSpan === "undefined") {
    g.createSpan = (opts?: { cls?: string; text?: string }): MockElement => {
        const el = new MockElement("span");
        if (opts?.cls) opts.cls.split(" ").forEach((c) => el.classList.add(c));
        if (opts?.text) el.textContent = opts.text;
        return el;
    };
}

// Silence lilbee's intentional error-path logging so negative-path tests don't
// flood the output; anything without the [lilbee] prefix still passes through.
for (const method of ["error", "warn"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]): void => {
        if (typeof args[0] === "string" && args[0].includes("[lilbee]")) return;
        (original as (...a: unknown[]) => void)(...args);
    };
}
