/**
 * embed: a local codebase embedding across three H100s. The GPU placement
 * matrix is live on the left (util bars ramp on every card because the embedder
 * is mirrored x3), the Task Center on the right fills 0 -> 100%. Opens straight
 * on the running fleet (no navigation), uploads the codebase, and ends the
 * moment the last file is embedded. No chat.
 *
 * The fleet is pre-placed (embed mirrored on 0/1/2) and warm; the KB starts
 * empty so the whole folder embeds fresh.
 */
import { beat, runJs, storyboard, waitForSelector } from "../src/lib.ts";

export default storyboard("embed", {
  window: [1400, 900],
  layout: "placement-and-tasks",
  skipModelPin: true,
  preloadChatModel: false,
  beats: [
    beat("Open on the running fleet", waitForSelector(".lilbee-gpu-row"), {
      holdMs: 2200,
      caption: "Three H100s, the embedder mirrored across all three.",
    }),
    beat(
      "Upload the codebase to the box",
      runJs(`
        const app = window.app;
        const folder = app.vault.getAbstractFileByPath('Code');
        // External mode streams the file bytes straight from the vault to the box.
        window.app.plugins.plugins.lilbee.addToLilbee(folder);
      `),
      { holdMs: 1400, caption: "Point lilbee at your codebase." },
    ),
    beat("Watch it embed across the cards", waitForSelector(".lilbee-task-row"), {
      holdMs: 9000,
      caption: "Every file, embedding across all three GPUs at once.",
    }),
    beat(
      "Run the ingest to completion",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const base = p.settings.serverUrl, tok = p.settings.manualToken;
        // Exit as soon as the indexed count stops growing (embed done), whatever
        // the final total — no fixed threshold that can hang on a small corpus.
        let last = -1, stable = 0;
        for (let i = 0; i < 60; i++) {
          try {
            const r = await fetch(base + '/api/documents', { headers: { Authorization: 'Bearer ' + tok } });
            const n = (await r.json()).total || 0;
            if (n > 0 && n === last) stable++; else stable = 0;
            last = n;
            if (stable >= 4) break;
          } catch (e) {}
          await new Promise(r => setTimeout(r, 1000));
        }
      `),
      { holdMs: 2000, maxMs: 120000, caption: "Mirrored on every card, so the whole codebase lands fast." },
    ),
    beat("Settle on the finished index", waitForSelector(".lilbee-gpu-row"), {
      holdMs: 3200,
      caption: "Done. Your codebase is embedded across every GPU.",
    }),
  ],
});
