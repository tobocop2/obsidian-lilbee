/**
 * add demo: ingest the Crown Victoria owner's manual, then ask a cited
 * question about it. One real ingest (heavy PDF, real chunk-embedding
 * progress in the Task Center), then a cited answer whose citation opens
 * the manual at the referenced page.
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
  // Re-add the manual fresh so the Task Center shows real chunk-embedding
  // progress. Keep the Task Center's seeded history (actively-used vault).
  freshIngest: [PDF_VAULT_FILE],
  clearTaskCenter: false,
  clearChat: true,
  beats: [
    beat("Opening hold on the used workspace", sleep(900)),

    // Open the Crown Vic PDF, then add it via the command palette.
    beat(
      "Open the Crown Vic Owner's Manual in a new tab",
      runJs(`
        await window.app.workspace.openLinkText(${JSON.stringify(PDF_VAULT_FILE)}, '', 'tab');
        await new Promise(r => setTimeout(r, 250));
      `),
      { holdMs: 1100 },
    ),
    beat("Open the command palette", runJs(`window.app.commands.executeCommandById("command-palette:open");`), {
      holdMs: 700,
    }),
    beat("Filter to the Add command", type_("Add current file"), { holdMs: 1500 }),
    beat("Run the command — the manual starts ingesting", key("enter"), { holdMs: 700 }),
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
      { holdMs: 1000, speedup: 4 },
    ),

    // Ask the towing question against the just-ingested manual.
    // Close the PDF tab first so the chat panel has focus (otherwise the
    // pasted question can land nowhere and Send fires empty).
    beat(
      "Close the PDF tab and activate a clean chat panel",
      runJs(`
        for (const leaf of window.app.workspace.getLeavesOfType('pdf')) leaf.detach();
        for (const leaf of window.app.workspace.getLeavesOfType('markdown')) leaf.detach();
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 400));
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta) ta.focus();
      `),
      { holdMs: 700 },
    ),
    beat("Ask the towing question", fillChat(QUESTION), { holdMs: 600 }),
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
    // Open the manual's citation; the source preview lands on the cited page.
    beat("Open the cited page of the manual", clickSourceFile("Crown Victoria"), { holdMs: 4500 }),
    beat("Close source preview", key("escape"), { holdMs: 600 }),
  ],
});
