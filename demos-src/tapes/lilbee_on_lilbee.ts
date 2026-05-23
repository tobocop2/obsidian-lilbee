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
        // Fully empty the corpus: listDocuments paginates, so loop until
        // it reports zero. Otherwise leftover docs (e.g. the Crown Vic PDF
        // from a prior demo) keep showing up in the cited sources, and
        // this demo is supposed to cite ONLY the README.
        for (let pass = 0; pass < 20; pass++) {
          const list = await p.api.listDocuments(undefined, 1000, 0).catch(() => ({ documents: [] }));
          const docs = list.documents ?? [];
          const names = docs.map(d => d.name ?? d.path ?? d.id).filter(Boolean);
          if (names.length === 0) break;
          await p.api.removeDocuments(names).catch(() => {});
          await new Promise(r => setTimeout(r, 300));
        }
        // Re-ingest just the README via the API directly (awaiting the
        // plugin's addToLilbee hangs on the open SSE stream, and routing
        // through the task queue churns the chat panel's polling so the
        // textarea gets recreated mid-fill). Drive the add endpoint and
        // wait for it to finish, all off the chat panel's render path.
        const file = window.app.vault.getFiles().find(f => /lilbee-README\\.md$/i.test(f.path));
        if (file) {
          const abs = window.app.vault.adapter.getFullPath
            ? window.app.vault.adapter.getFullPath(file.path)
            : (window.app.vault.adapter.basePath + "/" + file.path);
          try {
            for await (const _ of p.api.addFiles([abs], true)) { /* drain stream to completion */ }
          } catch {}
        }
      `),
      { holdMs: 600, speedup: 6 },
    ),

    // Re-activate the chat leaf so the textarea is fresh + focused before
    // we type — the corpus mutation above can have triggered a re-render.
    beat(
      "Re-activate the chat panel",
      runJs(`
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 300));
      `),
      { holdMs: 400 },
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
