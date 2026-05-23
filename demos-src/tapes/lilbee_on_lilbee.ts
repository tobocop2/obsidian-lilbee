/**
 * lilbee-on-lilbee demo: the README headline. Ask "what is lilbee in one
 * sentence?" and let the cited answer come straight from the lilbee
 * README that's already in the corpus.
 *
 * No corpus surgery. An earlier version wiped every document and
 * re-ingested only the README so the citation could only be the README,
 * but that (a) routed through addToLilbee's "already indexed — re-add?"
 * confirm modal, (b) destructively emptied the shared demo-vault corpus
 * the other demos rely on, and (c) raced the vector index's eventual
 * consistency.
 *
 * Instead we constrain retrieval to the single top hit (top_k = 1) for
 * this one question. "What is lilbee" matches the README far above the
 * car-manual corpus, so the lone source is the README — README-only
 * citations without touching the corpus. The original top_k is captured
 * and restored so the demo leaves no trace in settings.
 */
import {
  beat,
  clickChip,
  clickSend,
  fillChat,
  runJs,
  sleep,
  storyboard,
  waitChatIdle,
} from "../src/lib.ts";

const QUESTION = "What is lilbee in one sentence?";

export default storyboard("lilbee_on_lilbee", {
  window: [1400, 900],
  layout: "chat-and-tasks",
  preloadChatModel: true,
  clearTaskCenter: true,
  clearChat: true,
  beats: [
    beat("Opening hold on the chat panel", sleep(700)),

    // Retrieve only the single best-matching chunk so the cited source is
    // the README alone, not the car-manual chunks that top_k=5 also pulls.
    // Original is stashed on window and restored at the end.
    beat(
      "Constrain retrieval to the top hit for a README-only citation",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        window.__lilbeeOrigTopK = p.settings.topK;
        p.settings.topK = 1;
        await p.saveSettings();
      `),
      { holdMs: 200 },
    ),

    beat("Ask the question", fillChat(QUESTION), { holdMs: 500 }),
    beat("Send", clickSend(), { holdMs: 500 }),
    beat("Stream the cited answer", waitChatIdle(120_000), { holdMs: 1200, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    beat("Click the citation chip", clickChip(0), { holdMs: 1200 }),
    // The chip is a vault-native deep link, so it opens the README as a real
    // Obsidian note. Flip it to reading mode so the money-shot frame shows
    // the rendered headline ("A batteries-included local search engine…")
    // instead of raw markdown with <picture> tags.
    beat(
      "Render the README in reading mode",
      runJs(`
        const leaf = window.app.workspace.activeLeaf;
        if (leaf && leaf.view?.getViewType?.() === 'markdown') {
          const s = leaf.getViewState();
          s.state = { ...s.state, mode: 'preview' };
          await leaf.setViewState(s);
        }
      `),
      { holdMs: 2400 },
    ),

    beat(
      "Restore the original top_k",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        if (window.__lilbeeOrigTopK !== undefined) {
          p.settings.topK = window.__lilbeeOrigTopK;
          await p.saveSettings();
        }
      `),
      { holdMs: 200 },
    ),
  ],
});
