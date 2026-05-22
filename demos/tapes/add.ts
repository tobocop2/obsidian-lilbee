/**
 * add demo: two real ingests + cited answer.
 *
 * Adds the Crown Vic manual (PDF) and the lilbee README (markdown) so
 * the viewer sees the palette path work end-to-end on both a heavy
 * file (real chunking progress in the Task Center) and a light one
 * (fast completion). The cited answer that follows queries the PDF.
 *
 * Why we open files via runJs + workspace.openLinkText(path, '', 'tab')
 * instead of clicking the file title in the explorer: a plain click
 * on a nav-file-title replaces the active leaf with the file. With
 * the chat leaf active, that destroys chat. Opening in a new tab
 * keeps the chat leaf intact and just makes the file active so
 * "Add current file to lilbee" picks it up.
 *
 * Right-click + "Add to lilbee" was the original intent for one of
 * the two files but doesn't run while Obsidian is on
 * --remote-debugging-port (DevTools mode suppresses Obsidian's
 * contextmenu IPC). When the harness no longer needs CDP, swap one
 * of the README beats for a real right-click flow.
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

const PDF_VAULT_FILE = "Crown Victoria Owner's Manual.pdf";
const MD_VAULT_FILE = "Code/lilbee-README.md";
const QUESTION = "I'm prepping this car to tow my boat. What does the manual say I need to check?";

export default storyboard("add", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  freshIngest: [PDF_VAULT_FILE, "lilbee-README.md"],
  clearTaskCenter: true,
  clearChat: true,
  beats: [
    beat("Opening hold on chat + tasks + file explorer", sleep(700)),

    // --- File 1: Crown Vic PDF via command palette ---
    beat(
      "Open the PDF in a new tab so chat stays put",
      runJs(`
        await window.app.workspace.openLinkText(${JSON.stringify(PDF_VAULT_FILE)}, '', 'tab');
        await new Promise(r => setTimeout(r, 300));
      `),
      { holdMs: 800 },
    ),
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700 },
    ),
    beat("Filter to the Add command", type_("Add current file"), { holdMs: 1500 }),
    beat("Run the command — PDF starts ingesting", key("enter"), { holdMs: 700 }),
    beat(
      "Task Center fills with chunk-embedding progress",
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
      { holdMs: 700, speedup: 4 },
    ),

    // --- File 2: README, also via the palette. ---
    beat(
      "Open the README in another new tab",
      runJs(`
        await window.app.workspace.openLinkText(${JSON.stringify(MD_VAULT_FILE)}, '', 'tab');
        await new Promise(r => setTimeout(r, 300));
      `),
      { holdMs: 800 },
    ),
    beat(
      "Open the command palette again",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700 },
    ),
    beat("Filter to the Add command", type_("Add current file"), { holdMs: 1500 }),
    beat("Run the command — README ingests quickly", key("enter"), { holdMs: 700 }),
    beat(
      "Wait for the README ingest to land in the Task Center",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        let sawActive = false;
        for (let i = 0; i < 120; i++) {
          const busy = tq.activeAll.length + tq.queued.length;
          if (busy > 0) sawActive = true;
          if (sawActive && busy === 0) return;
          await new Promise(r => setTimeout(r, 300));
        }
      `),
      { holdMs: 700 },
    ),

    // --- Ask the towing question against the just-ingested PDF ---
    beat(
      "Activate chat",
      runJs(`
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 250));
      `),
      { holdMs: 600 },
    ),
    beat("Ask the towing question", fillChat(QUESTION), { holdMs: 600 }),
    beat("Send", clickSend(), { holdMs: 600 }),
    beat("Stream the cited answer", waitChatIdle(180_000), { holdMs: 1400, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    beat("Click the first citation", clickChip(0), { holdMs: 4500 }),
    beat("Close source preview", key("escape"), { holdMs: 600 }),
  ],
});
