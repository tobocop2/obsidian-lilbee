/**
 * lilbee-on-lilbee demo: the README headline. The corpus is wiped down
 * to just the lilbee README so the cited answer can only come from the
 * README and the citation chip lands on the README itself.
 *
 * Every UI surface that opens here is triggered via a visible action
 * (Cmd-P + typed command, or a mouse click). No invisible runJs calls
 * to executeCommandById.
 */
import {
  beat,
  clickChip,
  clickSend,
  clickSelector,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  type_,
  waitChatIdle,
} from "../src/lib.ts";

const QUESTION = "What is lilbee in one sentence?";

export default storyboard("lilbee_on_lilbee", {
  window: [1400, 900],
  layout: "chat-and-tasks",
  preloadChatModel: true,
  clearTaskCenter: true,
  clearChat: true,
  beats: [
    beat("Opening hold on the chat panel", sleep(600)),

    // Wipe the corpus down to nothing so the demo can rebuild it cleanly
    // with just the README. Then re-ingest the README. The cited answer
    // that follows can only reference the README itself, which is the
    // whole point of this demo.
    beat(
      "Wipe the corpus down to nothing, then ingest only the README",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        // List every document, then remove them as one batch call.
        const list = await p.api.listDocuments().catch(() => ({ documents: [] }));
        const docs = list.documents ?? [];
        const names = docs.map(d => d.name ?? d.path ?? d.id).filter(Boolean);
        if (names.length > 0) {
          await p.api.removeDocuments(names).catch(() => {});
        }
        // Re-ingest just the README.
        const file = window.app.vault.getFiles().find(f => /lilbee-README\\.md$/i.test(f.path));
        if (file) await p.addToLilbee(file);
        for (let i = 0; i < 60; i++) {
          const busy = p.taskQueue.activeAll.length + p.taskQueue.queued.length;
          if (busy === 0 && i > 4) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 800, speedup: 6 },
    ),

    // Single question. Single citation. Single source.
    beat("Ask the question", fillChat(QUESTION), { holdMs: 500 }),
    beat("Send", clickSend(), { holdMs: 500 }),
    beat("Stream the cited answer", waitChatIdle(120_000), { holdMs: 1200, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    beat("Click the citation chip", clickChip(0), { holdMs: 2200 }),
    beat("Close source preview", key("escape"), { holdMs: 500 }),
  ],
});
