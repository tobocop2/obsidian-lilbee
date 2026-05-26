/**
 * what_is_lilbee demo: the full loop on lilbee's own README. Add the
 * lilbee README to the vault's library, watch it ingest, then ask "What is
 * lilbee in one sentence?" and get a cited answer straight from the README
 * it just indexed — the citation clicks back to the source.
 *
 * Retrieval is constrained to the single top hit for this one question so
 * the answer cites only the README (the dominant match for "what is
 * lilbee"), never a stray car-manual chunk. top_k is stashed and restored,
 * so the demo leaves no trace in settings.
 */
import {
  beat,
  clickChip,
  clickSend,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  type_,
  waitChatIdle,
} from "../src/lib.ts";

// Add the README from a normal vault folder (Code/), not lilbee's own managed
// `lilbee/` folder — adding a file that already lives in the managed folder
// fails with "same file". Adding the Code/ copy ingests cleanly; the citation
// then opens the managed copy under lilbee/.
const README_VAULT_FILE = "Code/lilbee-README.md";
// The server tracks documents by filename, so freshIngest removes it by the
// basename (not the vault path) to force a real re-ingest on camera.
const README_FILENAME = "lilbee-README.md";
const QUESTION = "What is lilbee in one sentence?";

export default storyboard("what_is_lilbee", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  // Re-add the README fresh so the Task Center shows a real ingest on camera.
  // Clear the Task Center first so the ingest reads as a deliberate action.
  freshIngest: [README_FILENAME],
  clearTaskCenter: true,
  clearChat: true,
  preloadChatModel: true,
  beats: [
    beat("Opening hold on the clean workspace", sleep(300)),

    // Constrain retrieval to the single top hit so the answer cites only the
    // README it just ingested (the dominant match for "what is lilbee").
    beat(
      "Constrain retrieval to a README-only citation",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        window.__lilbeeOrigTopK = p.settings.topK;
        p.settings.topK = 1;
        await p.saveSettings();
      `),
      { holdMs: 200 },
    ),

    // Open the lilbee README, then add it to the library via the palette.
    beat(
      "Open the lilbee README in a new tab",
      runJs(`
        await window.app.workspace.openLinkText(${JSON.stringify(README_VAULT_FILE)}, '', 'tab');
        await new Promise(r => setTimeout(r, 250));
      `),
      { holdMs: 1100 },
    ),
    beat("Open the command palette", runJs(`window.app.commands.executeCommandById("command-palette:open");`), {
      holdMs: 700,
      keyHint: "⌘P",
    }),
    beat("Filter to the Add command", type_("Add current file"), { holdMs: 1500 }),
    beat("Run the command — the README starts ingesting", key("enter"), { holdMs: 700 }),
    beat(
      "Task Center fills with the README ingest",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        let sawActive = false;
        for (let i = 0; i < 240; i++) {
          const busy = tq.activeAll.length + tq.queued.length;
          if (busy > 0) sawActive = true;
          if (sawActive && busy === 0) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 1000, speedup: 4 },
    ),

    // Close the README tab so the chat panel has focus, then ask.
    beat(
      "Close the README tab and activate a clean chat panel",
      runJs(`
        for (const leaf of window.app.workspace.getLeavesOfType('markdown')) leaf.detach();
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 400));
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta) ta.focus();
      `),
      { holdMs: 700 },
    ),
    beat("Ask the question", fillChat(QUESTION), { holdMs: 600 }),
    beat(
      "Ensure the question is in the box",
      runJs(`
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta && !ta.value.trim()) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, ${JSON.stringify(QUESTION)});
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `),
      { holdMs: 300 },
    ),
    beat("Send", clickSend(), { holdMs: 600 }),
    beat("Stream the cited answer", waitChatIdle(120_000), { holdMs: 1400, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    // Click the citation; it opens the README as a real Obsidian note. Park
    // the cursor in the pane's empty right margin so scrolling stays natural
    // but never dwells on a link (which triggers Obsidian's preview popup).
    beat("Click the citation chip", clickChip(0), { holdMs: 900, cursorParkTo: [1245, 520] }),
    beat(
      "Render the README in reading mode",
      runJs(`
        const leaf = window.app.workspace.activeLeaf;
        if (leaf && leaf.view?.getViewType?.() === 'markdown') {
          const s = leaf.getViewState();
          s.state = { ...s.state, mode: 'preview' };
          await leaf.setViewState(s);
        }
      `),
      { holdMs: 300 },
    ),
    // Glide down past the header (the top logo SVG renders broken in
    // Obsidian) through the demo GIFs, landing on the "Offline copies of
    // websites" section whose crawl GIF is the one to stop on.
    beat(
      "Scroll through the README, stopping at the Offline copies of websites GIF",
      runJs(`
        const view = window.app.workspace.activeLeaf?.view;
        if (view?.file && view.currentMode?.applyScroll) {
          const lines = (await window.app.vault.read(view.file)).split('\\n');
          let target = lines.findIndex((l) => /^#{1,6}\\s+offline copies of websites/i.test(l));
          if (target < 0) target = lines.findIndex((l) => /offline copies of websites/i.test(l));
          if (target >= 0) {
            const steps = 5;
            for (let i = 1; i < steps; i++) {
              view.currentMode.applyScroll(Math.round((target * i) / steps));
              await new Promise(r => setTimeout(r, 2200));
            }
            view.currentMode.applyScroll(target);
          }
        }
      `),
      { holdMs: 3000 },
    ),

    beat(
      "Restore the original top_k",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        if (window.__lilbeeOrigTopK !== undefined) {
          p.settings.topK = window.__lilbeeOrigTopK;
          await p.saveSettings();
        }
      `),
      { holdMs: 200 },
    ),
  ],
});
