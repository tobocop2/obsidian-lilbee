/**
 * vision demo: read a scanned, image-only PDF with a local vision model.
 *
 * The Star Wars X-Wing "Starfighter Pilot Manual" is a scanned booklet with
 * no text layer — plain text extraction gets nothing. With a vision model
 * set (LightOnOCR), lilbee rasterises each page and OCRs it through the
 * model, so the manual becomes searchable. The Task Center streams the OCR
 * page by page; then a chat answer reads a detail that could only come from
 * OCR — the manual's technical-support phone number and publisher — straight
 * off the scanned cover.
 *
 * The chat model stays Qwen3 8B (pinned in pre-flight); the vision model is
 * set in the first beat and only does the OCR. freshIngest drops the manual
 * from the corpus so every take re-OCRs it from scratch.
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
} from "../src/lib.ts";

const PDF_FILE = "Star Wars X-Wing Pilot Manual.pdf";
const VISION_MODEL = "noctrex/LightOnOCR-2-1B-GGUF/LightOnOCR-2-1B-Q4_K_M.gguf";
const QUESTION = "What technical support phone number does this manual give, and who is the publisher?";

const palette = (label: string, query: string, holdAfter = 900) => [
  beat(
    `Open the command palette (${label})`,
    runJs(`window.app.commands.executeCommandById("command-palette:open");`),
    { holdMs: 500, keyHint: "⌘P" },
  ),
  beat(`Type "${query}"`, type_(query), { holdMs: 1000 }),
  beat(`Run ${label}`, key("enter"), { holdMs: holdAfter }),
];

export default storyboard("vision", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  preloadChatModel: true,
  clearTaskCenter: true,
  clearChat: true,
  freshIngest: [PDF_FILE],
  beats: [
    beat("Opening hold on the chat + Task Center", sleep(300)),

    // Point lilbee's vision slot at LightOnOCR so the scanned PDF is OCR'd by
    // the model rather than skipped. Chat stays on the pinned Qwen3 8B.
    beat(
      "Set the vision model to LightOnOCR",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const base = p.api?.baseUrl ?? p.settings.serverUrl;
        const h = { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
        await fetch(base + "/api/models/vision", { method: "PUT", headers: h, body: JSON.stringify({ model: ${JSON.stringify(VISION_MODEL)} }) }).catch(() => {});
        if (typeof p.fetchActiveModel === "function") await p.fetchActiveModel();
      `),
      { holdMs: 700 },
    ),

    // Open the scanned manual beside the chat so the viewer sees it's a
    // real scan (images, no selectable text), never over the Task Center.
    beat(
      "Open the scanned manual beside the chat",
      runJs(`
        const app = window.app;
        const chatLeaf = app.workspace.getLeavesOfType('lilbee-chat')[0];
        if (chatLeaf) app.workspace.setActiveLeaf(chatLeaf, { focus: true });
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(PDF_FILE)});
        const leaf = app.workspace.getLeaf('tab');
        if (file) await leaf.openFile(file);
        await new Promise(r => setTimeout(r, 400));
      `),
      { holdMs: 1600 },
    ),

    // Add it: ingest rasterises every page and OCRs it through LightOnOCR.
    ...palette("Add current file", "Add current file", 900),

    // The money shot: the Task Center streams OCR page by page through the
    // local vision model. Sped up so all sixteen pages read without dragging.
    beat(
      "Task Center streams the vision OCR, page by page",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        let sawActive = false;
        for (let i = 0; i < 1200; i++) {
          const busy = tq.activeAll.length + tq.queued.length;
          if (busy > 0) sawActive = true;
          if (sawActive && busy === 0) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 1800, speedup: 8, maxMs: 300_000 },
    ),

    // Ask a question only answerable from the OCR'd pages.
    beat(
      "Activate a clean chat panel",
      runJs(`
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 300));
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta) ta.focus();
      `),
      { holdMs: 500 },
    ),
    beat("Ask for the support number and publisher", fillChat(QUESTION), { holdMs: 700 }),
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
    beat(
      "Cited answer read off the OCR'd manual",
      runJs(`
        const send = document.querySelector('.lilbee-chat-send');
        for (let i = 0; i < 240; i++) {
          const t = (send?.textContent || '').toLowerCase();
          if (t.includes('send') && i > 4) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 1600, speedup: 4, maxMs: 180_000 },
    ),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 600 },
    ),
    beat("Open the cited page of the manual", clickChip(0), { holdMs: 2400, cursorParkTo: [1245, 520] }),
  ],
});
