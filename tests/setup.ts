// Obsidian's renderer always defines window/activeWindow/activeDocument; the
// Node test env does not, so mirror them onto globalThis. Pointing window at
// globalThis keeps vi.useFakeTimers() patching window.setTimeout too.
const g = globalThis as Record<string, unknown>;
if (typeof g.window === "undefined") g.window = globalThis;
if (typeof g.activeWindow === "undefined") g.activeWindow = globalThis;
