/**
 * multipart demo: a fresh vault. Add the Crown Victoria manual, then ask a
 * MULTI-PART question in one shot — two unrelated facts from different sections
 * of the manual — and watch a native model (Qwen3 8B, run by lilbee) answer both
 * and cite each.
 *
 * Verified answer: "park lamp and tail lamp bulb part number 3457 AK / 3157K
 * [..]; firing order for the 4.6L V8 engine is 1-3-7-2-6-5-4-8 [..]." The bulb
 * chart and the engine spec live on different pages, so the citations point to
 * both. (The firing-order chunk is keyed on "4.6L V8", so the question names it.)
 *
 * Environment this tape assumes (verify before recording):
 *  - Qwen3 8B installed natively and warm; query expansion on; top_k 8.
 *  - The DB is reset EMPTY before recording; the manual PDF exists in the vault.
 */
import { beat, clickSourceFile, clickSend, fillChat, key, runJs, sleep, storyboard, type_, waitChatIdle } from "../src/lib.ts";

const PDF_VAULT_FILE = "Crown Victoria Owner's Manual.pdf";
const QUESTION =
  "What is the park lamp and tail lamp bulb part number, and what is the firing order for the 4.6L V8 engine?";

const openCatalog = runJs(`window.app.commands.executeCommandById("command-palette:open");`);

export default storyboard("multipart", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  clearTaskCenter: true,
  // Qwen3 8B is the answering model; preload so the on-camera answer is warm.
  pinChatModel: "Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf",
  preloadChatModel: true,
  clearChat: true,
  beats: [
    beat("Opening hold — Qwen3 8B in the rail, fresh vault", sleep(400), {
      caption: "A native model, run by lilbee — fresh vault.",
    }),
    // Add the manual.
    beat(
      "Open the Crown Vic Owner's Manual",
      runJs(`
        await window.app.workspace.openLinkText(${JSON.stringify(PDF_VAULT_FILE)}, '', 'tab');
        await new Promise(r => setTimeout(r, 250));
      `),
      { holdMs: 900, caption: "Add the Crown Victoria owner's manual." },
    ),
    beat("Open the command palette", openCatalog, { holdMs: 500, keyHint: "⌘P" }),
    beat("Filter to the Add command", type_("Add current file"), { holdMs: 1100 }),
    beat("Run it — the manual ingests", key("enter"), { holdMs: 700 }),
    beat(
      "Task Center fills with chunk-embedding progress",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        let sawActive = false;
        for (let i = 0; i < 300; i++) {
          const busy = tq.activeAll.length + tq.queued.length;
          if (busy > 0) sawActive = true;
          if (sawActive && busy === 0) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 1000, speedup: 4, caption: "lilbee chunks and embeds it locally — fast-forwarding the ingest." },
    ),
    beat(
      "Close the PDF and activate the chat panel",
      runJs(`
        for (const leaf of window.app.workspace.getLeavesOfType('pdf')) leaf.detach();
        for (const leaf of window.app.workspace.getLeavesOfType('markdown')) leaf.detach();
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 400));
      `),
      { holdMs: 600 },
    ),
    beat("Ask a multi-part question", fillChat(QUESTION), { holdMs: 700 }),
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
    beat("Send", clickSend(), {
      holdMs: 600,
      caption: "One question, two unrelated facts — a bulb part number and the firing order.",
    }),
    beat("Stream the cited answer", waitChatIdle(180_000), { holdMs: 2200, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 700, caption: "Each fact comes from a different section of the manual, and is cited." },
    ),
    beat("Open the cited page of the manual", clickSourceFile("Crown Victoria"), { holdMs: 4500 }),
    beat("Close source preview", key("escape"), { holdMs: 600 }),
  ],
});
