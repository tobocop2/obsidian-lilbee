// Wipe the lilbee plugin's task history (live + persisted) so the Task Center
// shows only the current run — no stale "done"/"failed" clutter in a recording.
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9222");
let done = false;
for (const ctx of browser.contexts()) {
  for (const page of ctx.pages()) {
    const title = await page.title().catch(() => "");
    if (!title.includes("Obsidian")) continue;
    const base = await page.evaluate(() => globalThis.app?.vault?.adapter?.basePath ?? "").catch(() => "");
    if (!base.includes("obsidian-lilbee-demo")) continue;
    const res = await page.evaluate(async () => {
      const p = globalThis.app.plugins.plugins.lilbee;
      const tq = p.taskQueue;
      const ownKeys = Object.keys(tq);
      const protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(tq));
      const cleared = {};
      // empty every array-valued field on the queue (history / active / queued)
      for (const k of ownKeys) {
        if (Array.isArray(tq[k])) { cleared[k] = tq[k].length; tq[k].length = 0; }
        else if (tq[k] instanceof Map) { cleared[k] = tq[k].size; tq[k].clear(); }
      }
      // best-effort call to any clear/persist method the queue exposes
      for (const m of ["clearHistory", "clear", "clearCompleted", "persist", "save", "saveHistory", "notify", "emit"]) {
        if (typeof tq[m] === "function") { try { await tq[m](); } catch (e) {} }
      }
      // rewrite the persisted shape without clobbering settings
      try {
        const data = (await p.loadData()) || {};
        data.taskHistory = { history: [] };
        await p.saveData(data);
      } catch (e) {}
      // re-render any open task views
      globalThis.app.workspace.getLeavesOfType("lilbee-tasks").forEach((l) => l.view?.render?.());
      return { ownKeys, protoKeys, cleared };
    });
    console.log("RESULT " + JSON.stringify(res));
    done = true;
  }
}
await browser.close();
if (!done) console.log("NO demo-vault Obsidian page on CDP");
