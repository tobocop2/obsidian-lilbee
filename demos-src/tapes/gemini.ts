/**
 * gemini demo: a fresh vault. lilbee also drives hosted frontier models when you
 * bring your own key. Open the catalog's Hosted tab, search for a free-tier
 * Gemini model and pick it as the chat model, then add the Crown Victoria manual
 * (embedded locally with the native embedder) and ask a cited question. The
 * answer comes from Gemini and still cites the manual.
 *
 * Embedding stays native here — this reel is about the hosted CHAT model (the
 * ollama/lmstudio reels show a local server powering both roles). Selecting a
 * Hosted model closes the catalog.
 *
 * Environment this tape assumes (verify before recording):
 *  - A Gemini API key IS configured (the catalog's Hosted tab lists Gemini),
 *    gemini-2.5-flash reachable free-tier. DB reset EMPTY before recording.
 */
import { beat, clickSelector, clickSourceFile, clickSend, fillChat, key, runJs, sleep, storyboard, type_, waitChatIdle } from "../src/lib.ts";

const PDF_VAULT_FILE = "Crown Victoria Owner's Manual.pdf";
const GEMINI_CHAT = "gemini-2.5-flash";
const QUESTION = "I'm prepping this car to tow my boat. What does the manual say I need to check?";

const openCatalog = runJs(`window.app.commands.executeCommandById("command-palette:open");`);

export default storyboard("gemini", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  clearTaskCenter: true,
  pinChatModel: "Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf",
  preloadChatModel: false,
  clearChat: true,
  beats: [
    beat("Opening hold — fresh vault, native model in the rail", sleep(400), {
      caption: "A fresh vault — nothing indexed yet.",
    }),
    // Pick a hosted Gemini chat model from the catalog's Hosted tab.
    beat("Open the command palette", openCatalog, { holdMs: 600, keyHint: "⌘P" }),
    beat("Filter to the catalog command", type_("Browse model catalog"), { holdMs: 900 }),
    beat("Open the catalog", key("enter"), { holdMs: 800 }),
    beat("Chat tab", clickSelector('.lilbee-catalog-main-tab-bar button:has-text("Chat")'), { holdMs: 500 }),
    beat("Hosted models", clickSelector('.lilbee-catalog-sub-tab-bar button:has-text("Hosted")'), {
      holdMs: 600,
      caption: "With your own key, hosted frontier models show up under Hosted too.",
    }),
    beat("Search the catalog", clickSelector(".lilbee-catalog-search"), { holdMs: 400 }),
    beat(
      "Type the model name",
      runJs(`
        const s = document.querySelector(".lilbee-catalog-search");
        if (s) { s.value = ${JSON.stringify(GEMINI_CHAT)}; s.dispatchEvent(new Event("input", { bubbles: true })); }
      `),
      { holdMs: 1500 },
    ),
    beat("Use the Gemini model", clickSelector(`.lilbee-frontier-row:has-text("${GEMINI_CHAT}")`), {
      holdMs: 1300,
      caption: "Pick a free-tier Gemini model — now Gemini drives the chat.",
    }),
    // Add the manual (embedded locally with the native embedder).
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
      caption: "The answer comes from Gemini — and still cites your manual.",
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
