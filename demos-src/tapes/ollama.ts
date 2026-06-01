/**
 * ollama demo: lilbee drives a model Ollama is already serving — no native
 * download. Show the provenance (the catalog's Hosted sub-tab groups the
 * Ollama-served models under their provider pill), pin that model as the chat
 * model, then ask a cited question about the Crown Victoria manual. The answer
 * streams from the Ollama model and still cites the manual at the source.
 *
 * Mirror of lmstudio.ts — same arc, different local server — matching the
 * sibling lilbee repo's tui-ollama-document / tui-lmstudio-document pair.
 *
 * Environment this tape assumes (verify before recording):
 *  - Ollama running on its default URL (http://localhost:11434) with the model
 *    below pulled. `ollama list` should show it.
 *  - The lilbee server's Ollama URL left at the default so its catalog surfaces
 *    the Ollama models as Hosted rows (GET /api/models lists `ollama/...`).
 *  - The Crown Victoria manual is already ingested in the demo corpus (the
 *    add/tour demos use it), so the towing question retrieves and cites it.
 */
import {
  beat,
  clickSelector,
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

// Ollama exposes models under the `ollama/<tag>` ref. qwen3:0.6b is the small,
// fast model pulled on this machine; swap to whatever `ollama list` shows.
const CHAT_MODEL = "ollama/qwen3:0.6b";
const QUESTION = "I'm prepping this car to tow my boat. What does the manual say I need to check?";

// PUT a model into the chat role via the server API the plugin already talks
// to, then refresh the rail so the pill reflects it. Same helper shape as
// rerank.ts.
const setChatModel = (model: string) =>
  runJs(`
    const p = window.app.plugins.plugins.lilbee;
    const base = p.api?.baseUrl ?? p.settings.serverUrl;
    const h = { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
    await fetch(base + "/api/models/chat", { method: "PUT", headers: h, body: JSON.stringify({ model: ${JSON.stringify(model)} }) }).catch(() => {});
    if (typeof p.fetchActiveModel === "function") await p.fetchActiveModel();
  `);

export default storyboard("ollama", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  // We pick the chat model ourselves (an Ollama-served one), so skip the
  // default native pin and the native preload.
  skipModelPin: true,
  preloadChatModel: false,
  clearTaskCenter: false,
  clearChat: true,
  beats: [
    beat("Opening hold on the clean workspace", sleep(300)),

    beat("Use the model Ollama is serving", setChatModel(CHAT_MODEL), {
      holdMs: 700,
      caption: "lilbee can drive any model Ollama already serves — no native download.",
    }),

    // Provenance: open the catalog and switch to the Hosted sub-tab, where the
    // Ollama-served models are grouped under their provider pill.
    beat("Open the command palette", runJs(`window.app.commands.executeCommandById("command-palette:open");`), {
      holdMs: 600,
      keyHint: "⌘P",
    }),
    beat("Filter to the catalog command", type_("Browse model catalog"), { holdMs: 1000 }),
    beat("Open the catalog", key("enter"), { holdMs: 900 }),
    beat("Chat tab", clickSelector('.lilbee-catalog-main-tab-bar button:text-is("Chat")'), { holdMs: 600 }),
    beat("Switch to Hosted models", clickSelector(".lilbee-catalog-sub-tab-bar button:nth-child(2)"), {
      holdMs: 900,
      caption: "Models served by Ollama show up here, tagged with their provider.",
    }),
    beat(
      "Linger on the Ollama provider pill",
      runJs(`
        const pill = Array.from(document.querySelectorAll('.lilbee-provider-pill'))
          .find((p) => /ollama/i.test(p.textContent || ''));
        (pill?.closest('.lilbee-frontier-row') ?? pill)?.scrollIntoView({ block: 'center' });
      `),
      { holdMs: 2400 },
    ),
    beat("Close the catalog", key("escape"), { holdMs: 600 }),

    // Ask the towing question against the already-ingested manual.
    beat(
      "Activate a clean chat panel",
      runJs(`
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 350));
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta) ta.focus();
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
      caption: "The answer streams from the Ollama model — and still cites the manual.",
    }),
    beat("Stream the cited answer", waitChatIdle(180_000), { holdMs: 1400, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    beat("Open the cited page of the manual", clickSourceFile("Crown Victoria"), { holdMs: 4500 }),
    beat("Close source preview", key("escape"), { holdMs: 600 }),
  ],
});
