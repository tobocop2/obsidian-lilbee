/**
 * add demo: two real ingests + cited answer.
 *
 * Adds the Crown Vic manual (PDF) and the lilbee README (markdown) so
 * the viewer sees the file-open + palette path work end-to-end on both
 * a heavy file (real chunking progress in the Task Center) and a light
 * one (fast completion). The cited answer that follows queries the PDF.
 *
 * Why the file is opened by clicking it in the explorer instead of via
 * `workspace.openLinkText`: viewers need to see the action that picks
 * the file. A runJs open is invisible. A click on the explorer file
 * row is the same action a user takes. The chat leaf is re-activated
 * at the end before the question is asked, so the layout reads right.
 */
import {
  beat,
  clickSourceFile,
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
const QUESTION = "I'm prepping this car to tow my boat. What does the manual say I need to check?";

export default storyboard("add", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  freshIngest: [PDF_VAULT_FILE, "lilbee-README.md"],
  clearTaskCenter: true,
  clearChat: true,
  beats: [
    beat("Opening hold on file explorer + chat + tasks", sleep(700)),

    // --- File 1: Crown Vic PDF ---
    // Open the PDF straight via the workspace API. Quick-switcher
    // sounds visible on paper but Obsidian's "create new file from
    // query" trap kept catching us when the typed search collided
    // with a leftover stub.
    beat(
      "Open the Crown Vic Owner's Manual in a new tab",
      runJs(`
        await window.app.workspace.openLinkText(${JSON.stringify(PDF_VAULT_FILE)}, '', 'tab');
        await new Promise(r => setTimeout(r, 250));
      `),
      { holdMs: 1100 },
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

    // --- File 2: README ---
    beat(
      "Open the lilbee README in a new tab",
      runJs(`
        await window.app.workspace.openLinkText("Code/lilbee-README.md", '', 'tab');
        await new Promise(r => setTimeout(r, 250));
      `),
      { holdMs: 1000 },
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
      { holdMs: 700, speedup: 4 },
    ),

    // --- Ask the towing question against the just-ingested PDF ---
    // Close the PDF/README tabs opened during the add steps first. They
    // clutter the layout AND steal keyboard focus from the chat textarea —
    // leaving fillChat focused on the input but the pasted question landing
    // nowhere, so Send fired on an empty chat. A clean single chat panel
    // (like lilbee_on_lilbee) makes the question land reliably.
    beat(
      "Close the add tabs and activate a clean chat panel",
      runJs(`
        for (const leaf of window.app.workspace.getLeavesOfType('markdown')) leaf.detach();
        for (const leaf of window.app.workspace.getLeavesOfType('pdf')) leaf.detach();
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 400));
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta) ta.focus();
      `),
      { holdMs: 700 },
    ),
    beat("Ask the towing question", fillChat(QUESTION), { holdMs: 600 }),
    // Safety net: in the multi-pane add layout the OS-level paste behind
    // fillChat occasionally fires before the textarea click settles focus,
    // leaving the box empty and Send firing on nothing. If the visible
    // typing didn't land, set the value directly so the send never goes out
    // empty (a no-op when fillChat worked).
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
    beat("Stream the cited answer", waitChatIdle(180_000), { holdMs: 1400, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    // Click the manual's citation specifically. The towing answer cites the
    // Crown Vic PDF, but retrieval ranks the README/Caprice chunks ahead of
    // it, so clickChip(0) would open an uncited source. Target the cited
    // file by name so the source preview lands on the manual page.
    beat("Open the cited page of the manual", clickSourceFile("Crown Victoria"), { holdMs: 4500 }),
    beat("Close source preview", key("escape"), { holdMs: 600 }),
  ],
});
