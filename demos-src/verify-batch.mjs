// End-to-end verification of the upload-batching fix: reload the (freshly
// built) plugin, trigger addToLilbee on the 150-file Code folder, wait for the
// ingest to finish, and report the resulting doc count + any error notices.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const TOK = readFileSync("/tmp/realtok", "utf8").trim();
const browser = await chromium.connectOverCDP("http://localhost:9222");
let done = false;
for (const ctx of browser.contexts()) {
  for (const page of ctx.pages()) {
    const title = await page.title().catch(() => "");
    if (!title.includes("Obsidian")) continue;
    const base = await page.evaluate(() => globalThis.app?.vault?.adapter?.basePath ?? "").catch(() => "");
    if (!base.includes("obsidian-lilbee-demo")) continue;
    const res = await page.evaluate(async (tok) => {
      const app = globalThis.app;
      // Reload the plugin so the freshly-built main.js (with batching) is live.
      await app.plugins.disablePlugin("lilbee");
      await app.plugins.enablePlugin("lilbee");
      const p = app.plugins.plugins.lilbee;
      p.settings.manualToken = tok;
      p.api?.setToken?.(tok);
      const hasBatch = typeof p.uploadInBatches === "function";
      // A freshly reloaded plugin has no active model yet; refresh it so the
      // addToLilbee guard passes.
      try { await p.refreshActiveModel(); } catch (e) {}
      for (let i = 0; i < 20 && !p.activeModel; i++) await new Promise((r) => setTimeout(r, 500));
      const activeModel = p.activeModel;
      // Trigger the folder upload (fire-and-forget) and poll the KB to completion.
      const folder = app.vault.getAbstractFileByPath("Code");
      p.addToLilbee(folder);
      const baseUrl = p.settings.serverUrl;
      let total = 0;
      for (let i = 0; i < 90; i++) {
        try {
          const r = await fetch(baseUrl + "/api/documents", { headers: { Authorization: "Bearer " + tok } });
          const n = (await r.json()).total || 0;
          if (n === total && n >= 140) break;
          total = n;
        } catch (e) {}
        await new Promise((r) => setTimeout(r, 1000));
      }
      // Collect any surfaced notice text (to catch a "too many files" error).
      const notices = Array.from(document.querySelectorAll(".notice")).map((n) => n.textContent || "");
      return { hasBatch, activeModel, total, notices };
    }, TOK);
    console.log("RESULT " + JSON.stringify(res));
    done = true;
  }
}
await browser.close();
if (!done) console.log("NO demo-vault Obsidian page on CDP");
