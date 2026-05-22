/**
 * lilbee-on-lilbee demo: visibly select the README, run "Add to
 * lilbee" via the command palette, watch it ingest, then ask the
 * question.
 *
 * The right-click context menu would be ideal but Obsidian renders
 * it outside the page DOM, so Playwright can't see or trigger it.
 * Command palette gets the same intent across with a path the viewer
 * can follow end-to-end.
 */
import {
  beat,
  clickChip,
  clickSelector,
  clickSend,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  type_,
  waitChatIdle,
  wheelScroll,
} from "../src/lib.ts";

const README_DISPLAY = "lilbee-README";
const QUESTION = "What is lilbee?";

export default storyboard("lilbee_on_lilbee", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  freshIngest: ["lilbee-README.md"],
  clearTaskCenter: true,
  clearChat: true,
  beats: [
    beat("Opening hold", sleep(700)),
    beat(
      "Open the lilbee README in a new tab",
      runJs(`
        await window.app.workspace.openLinkText("Code/lilbee-README.md", '', 'tab');
        await new Promise(r => setTimeout(r, 250));
      `),
      { holdMs: 1000 },
    ),
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 800 },
    ),
    beat("Filter to the Add command", type_("Add to lilbee"), { holdMs: 1000 }),
    beat("Run the command", key("enter"), { holdMs: 600 }),
    beat(
      "Wait for ingest done (Task Center fills in real time)",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        let sawActive = false;
        for (let i = 0; i < 80; i++) {
          const busy = tq.activeAll.length + tq.queued.length;
          if (busy > 0) sawActive = true;
          if (sawActive && busy === 0) return;
          await new Promise(r => setTimeout(r, 300));
        }
      `),
      { holdMs: 700, speedup: 4 },
    ),
    // Scroll through the README in the main pane so the demo shows
    // the badges, gifs, and rest of the page instead of holding on
    // the same top of file.
    beat(
      "Scroll the README #1",
      wheelScroll(".workspace-leaf.mod-active .cm-scroller, .workspace-leaf.mod-active .markdown-preview-view", -28),
      { holdMs: 900 },
    ),
    beat("Scroll the README #2", wheelScroll(".workspace-leaf.mod-active .cm-scroller, .workspace-leaf.mod-active .markdown-preview-view", -28), { holdMs: 900 }),
    beat("Scroll the README #3", wheelScroll(".workspace-leaf.mod-active .cm-scroller, .workspace-leaf.mod-active .markdown-preview-view", -28), { holdMs: 1100 }),
    beat(
      "Activate chat",
      runJs(`
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
      `),
      { holdMs: 500 },
    ),
    beat("Ask what lilbee is", fillChat(QUESTION), { holdMs: 600 }),
    beat("Send", clickSend(), { holdMs: 600 }),
    beat("Cited answer from the freshly-ingested README", waitChatIdle(120_000), { holdMs: 1400, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    beat("Click the citation", clickChip(0), { holdMs: 2200 }),
    beat("Close source preview", key("escape"), { holdMs: 500 }),
  ],
});
