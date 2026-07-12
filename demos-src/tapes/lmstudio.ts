/**
 * lmstudio demo: a fresh vault (empty index). Pick a model LM Studio already
 * serves for BOTH roles — embedding and chat — from the catalog's Hosted tab, so
 * it's clear LM Studio powers the whole pipeline. Then add the Crown Victoria
 * manual: lilbee embeds it with LM Studio's embedder (real chunk-embedding
 * progress in the Task Center, fast-forwarded). Ask a cited question — the answer
 * streams from the LM Studio chat model and still cites the manual; the citation
 * opens the source preview to the page it came from.
 *
 * Selecting a Hosted model closes the catalog, so the reel opens it twice (once
 * per role). Mirror of ollama.ts — same arc, different local server.
 *
 * Environment this tape assumes (verify before recording):
 *  - LM Studio's local server running with qwen/qwen3-4b-2507 and
 *    text-embedding-nomic-embed-text-v1.5; warm the chat model.
 *  - The DB is reset EMPTY and rebuilt before recording. NO frontier key is set.
 */
import { beat, clickSelector, clickSourceFile, clickSend, fillChat, key, runJs, sleep, storyboard, type_, waitChatIdle } from "../src/lib.ts";

const PDF_VAULT_FILE = "Crown Victoria Owner's Manual.pdf";
const LM_EMBED = "text-embedding-nomic-embed-text-v1.5"; // LM Studio embedding row
const LM_CHAT = "qwen3-4b-2507"; // LM Studio chat row (dash form, vs ollama's qwen3:4b)
const QUESTION = "I'm prepping this car to tow my boat. What does the manual say I need to check?";

const openCatalog = runJs(`window.app.commands.executeCommandById("command-palette:open");`);

export default storyboard("lmstudio", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  clearTaskCenter: true,
  pinChatModel: "Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf",
  preloadChatModel: false,
  clearChat: true,
  beats: [
    beat("Opening hold — fresh vault, native models in the rail", sleep(400), {
      caption: "A fresh vault — nothing indexed yet.",
    }),
    // Catalog open #1: pick the LM Studio embedder (selecting closes the catalog).
    beat("Open the command palette", openCatalog, { holdMs: 600, keyHint: "⌘P" }),
    beat("Filter to the catalog command", type_("Browse model catalog"), { holdMs: 900 }),
    beat("Open the catalog", key("enter"), { holdMs: 800 }),
    beat("Embedding tab", clickSelector('.lilbee-catalog-main-tab-bar button:has-text("Embed")'), { holdMs: 500 }),
    beat("Hosted models", clickSelector('.lilbee-catalog-sub-tab-bar button:has-text("Hosted")'), {
      holdMs: 600,
      caption: "LM Studio serves an embedding model — pick it for indexing.",
    }),
    beat("Use the LM Studio embedder", clickSelector(`.lilbee-frontier-row:has-text("${LM_EMBED}")`), { holdMs: 1100 }),
    // Catalog open #2: pick the LM Studio chat model.
    beat("Open the command palette", openCatalog, { holdMs: 500, keyHint: "⌘P" }),
    beat("Filter to the catalog command", type_("Browse model catalog"), { holdMs: 800 }),
    beat("Open the catalog", key("enter"), { holdMs: 700 }),
    beat("Chat tab", clickSelector('.lilbee-catalog-main-tab-bar button:has-text("Chat")'), { holdMs: 500 }),
    beat("Hosted models", clickSelector('.lilbee-catalog-sub-tab-bar button:has-text("Hosted")'), { holdMs: 500 }),
    beat("Use the LM Studio chat model", clickSelector(`.lilbee-frontier-row:has-text("${LM_CHAT}")`), {
      holdMs: 1200,
      caption: "And the chat model — now LM Studio drives both embedding and chat.",
    }),
    // Add the manual — it embeds with LM Studio's model now.
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
    beat("Run it — the manual ingests via LM Studio's embedder", key("enter"), { holdMs: 700 }),
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
      { holdMs: 1000, speedup: 4, caption: "lilbee chunks and embeds it with LM Studio — fast-forwarding the ingest." },
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
    beat("Send", clickSend(), {
      holdMs: 600,
      caption: "The answer streams from the LM Studio model — and still cites the manual.",
    }),
    beat("Stream the cited answer", waitChatIdle(180_000), { holdMs: 1600, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    beat("Open the cited page of the manual", clickSourceFile("Crown Victoria"), { holdMs: 4500 }),
    beat("Close source preview", key("escape"), { holdMs: 600 }),
  ],
});
