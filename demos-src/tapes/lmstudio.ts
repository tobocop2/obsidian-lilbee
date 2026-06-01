/**
 * lmstudio demo: lilbee drives a model LM Studio is already serving — no native
 * download. Show the provenance (the catalog's Hosted sub-tab groups the
 * LM Studio-served models under their provider pill), pin that model as the
 * chat model, then ask a cited question about the Crown Victoria manual. The
 * answer streams from the LM Studio model and still cites the manual at the
 * source.
 *
 * Mirror of ollama.ts — same arc, different local server — matching the
 * sibling lilbee repo's tui-lmstudio-document / tui-ollama-document pair.
 *
 * Environment this tape assumes (verify before recording):
 *  - LM Studio's local server is running (`lms server start`) on its default
 *    URL (http://localhost:1234/v1) with the model below loaded. `lms ls`
 *    shows the installed models.
 *  - The lilbee server's LM Studio URL left at the default so its catalog
 *    surfaces the LM Studio models as Hosted rows (GET /api/models lists
 *    `lm_studio/...`). Confirm the exact ref the server reports and match
 *    CHAT_MODEL to it.
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

// LM Studio exposes models under the `lm_studio/<id>` ref. qwen/qwen3-4b-2507
// is loaded on this machine (`lms ls`); confirm the exact id the lilbee server
// reports and match it here.
const CHAT_MODEL = "lm_studio/qwen/qwen3-4b-2507";
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

export default storyboard("lmstudio", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  // We pick the chat model ourselves (an LM Studio-served one), so skip the
  // default native pin and the native preload.
  skipModelPin: true,
  preloadChatModel: false,
  clearTaskCenter: false,
  clearChat: true,
  beats: [
    beat("Opening hold on the clean workspace", sleep(300)),

    beat("Use the model LM Studio is serving", setChatModel(CHAT_MODEL), {
      holdMs: 700,
      caption: "lilbee can drive any model LM Studio already serves — no native download.",
    }),

    // Provenance: open the catalog and switch to the Hosted sub-tab, where the
    // LM Studio-served models are grouped under their provider pill.
    beat("Open the command palette", runJs(`window.app.commands.executeCommandById("command-palette:open");`), {
      holdMs: 600,
      keyHint: "⌘P",
    }),
    beat("Filter to the catalog command", type_("Browse model catalog"), { holdMs: 1000 }),
    beat("Open the catalog", key("enter"), { holdMs: 900 }),
    beat("Chat tab", clickSelector('.lilbee-catalog-main-tab-bar button:text-is("Chat")'), { holdMs: 600 }),
    beat("Switch to Hosted models", clickSelector(".lilbee-catalog-sub-tab-bar button:nth-child(2)"), {
      holdMs: 900,
      caption: "Models served by LM Studio show up here, tagged with their provider.",
    }),
    beat(
      "Linger on the LM Studio provider pill",
      runJs(`
        const pill = Array.from(document.querySelectorAll('.lilbee-provider-pill'))
          .find((p) => /lm.?studio/i.test(p.textContent || ''));
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
      caption: "The answer streams from the LM Studio model — and still cites the manual.",
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
