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
  // Show the populated vault (file explorer) alongside chat + task center so
  // the workspace reads as actively used, not a fresh install.
  layout: "explorer-chat-tasks",
  preloadChatModel: true,
  // Keep the Task Center's seeded history (preflight seeds it when false) so
  // the corner of the workspace shows real prior activity.
  clearTaskCenter: false,
  clearChat: true,
  beats: [
    beat("Opening hold on the used workspace", sleep(300)),

    // The two best-matching chunks for "what is lilbee" are both from the
    // README, so top_k=2 dedupes to a README-only citation. (Oddly, top_k=1
    // and top_k=3 also pull in an unrelated crawled page via MMR
    // re-selection, so 2 is the value that stays clean.) Original is
    // stashed on window and restored at the end.
    beat(
      "Constrain retrieval for a README-only citation",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        window.__lilbeeOrigTopK = p.settings.topK;
        p.settings.topK = 2;
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
    // Park the cursor in the README pane's empty right margin (beside the
    // text column, by the scrollbar) right after opening the README, so it
    // stays over the pane where scrolling is natural but never dwells on a
    // link — that hover triggers Obsidian's "unable to load" preview popup.
    // The text column is x478-1178; the pane right edge is ~1313, so 1245
    // sits in the empty margin.
    beat("Click the citation chip", clickChip(0), { holdMs: 900, cursorParkTo: [1245, 520] }),
    // The chip is a vault-native deep link, so it opens the README as a real
    // Obsidian note. Flip it to reading mode so it renders.
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
      { holdMs: 300 },
    ),
    // Scroll down past the header (the top logo SVG renders broken in
    // Obsidian and isn't worth dwelling on), gliding slowly through the demo
    // GIFs so they animate, and stop at the "Offline copies of websites"
    // section, whose GIF is the one to land on.
    beat(
      "Scroll through the README, stopping at the Offline copies of websites GIF",
      runJs(`
        const view = window.app.workspace.activeLeaf?.view;
        if (view?.file && view.currentMode?.applyScroll) {
          const lines = (await window.app.vault.read(view.file)).split('\\n');
          let target = lines.findIndex((l) => /^#{1,6}\\s+offline copies of websites/i.test(l));
          if (target < 0) target = lines.findIndex((l) => /offline copies of websites/i.test(l));
          if (target >= 0) {
            // Glide down through the body in paused steps so each demo GIF
            // along the way has time to animate, then land on the
            // "Offline copies of websites" header (its crawl GIF sits just
            // below it). Reading mode lazy-renders, so applyScroll(line)
            // (not a DOM scroll) reliably renders and lands on each spot.
            const steps = 5;
            for (let i = 1; i < steps; i++) {
              view.currentMode.applyScroll(Math.round((target * i) / steps));
              await new Promise(r => setTimeout(r, 2200));
            }
            view.currentMode.applyScroll(target);
          }
        }
      `),
      { holdMs: 3000 },
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
