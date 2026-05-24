/**
 * crawl demo: crawl the Caprice Wikipedia page + ask 9C1 question.
 */
import {
  beat,
  clickChip,
  clickSelector,
  clickSend,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  type_,
  waitChatIdle,
} from "../src/lib.ts";

const URL = "https://en.wikipedia.org/wiki/Chevrolet_Caprice";
const QUESTION = "When was the 9C1 police package introduced?";

export default storyboard("crawl", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  // The Caprice corpus entry is the markdown stored under
  // lilbee/_web/en.wikipedia.org/.../index.md
  freshIngest: ["index.md"],
  // Clear the Task Center first so the crawl + sync that follow read as
  // a fresh, deliberate action rather than blending into prior history.
  clearTaskCenter: true,
  clearChat: true,
  caption: "Recorded on a 2021 M1 Pro, 32 GB RAM.",
  beats: [
    beat("Opening hold", sleep(500)),
    // The 9C1 introduction sentence ("introduced ... for 1986") sits in a
    // long paragraph alongside Michigan State Police test results, while
    // the article's dense reference list and the 1987/1989 paragraphs
    // repeat "9C1" far more often. At a low top_k those out-rank the
    // actual answer and the model hedges. Widen retrieval so the
    // introduction paragraph is in context.
    beat(
      "Widen retrieval so the answer paragraph is in context",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        window.__crawlOrigTopK = p.settings.topK;
        p.settings.topK = 10;
        await p.saveSettings();
      `),
      { holdMs: 200 },
    ),
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 500 },
    ),
    beat("Filter to lilbee crawl", type_("Crawl web page"), { holdMs: 1100 }),
    beat("Open crawl modal", key("enter"), { holdMs: 900 }),
    beat(
      "Paste the Caprice URL",
      runJs(`
        const input = document.querySelector('input.lilbee-crawl-url');
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(URL)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `),
      { holdMs: 600 },
    ),
    beat("Click Crawl", clickSelector('.modal-container button.mod-cta:has-text("Crawl")'), { holdMs: 1000 }),
    beat(
      "Wait for crawl + sync to complete",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        let sawActive = false;
        for (let i = 0; i < 600; i++) {
          const busy = tq.activeAll.length + tq.queued.length;
          if (busy > 0) sawActive = true;
          if (sawActive && busy === 0) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 700, speedup: 3 },
    ),
    beat("Ask about the 9C1 police package", fillChat(QUESTION), { holdMs: 600 }),
    beat("Send", clickSend(), { holdMs: 600 }),
    beat("Cited answer from the just-crawled page", waitChatIdle(120_000), { holdMs: 1400, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    // Park the cursor in the source pane's empty right margin (by the
    // scrollbar) so it never dwells on one of the crawled article's many
    // links while it scrolls — that hover fires Obsidian's link preview.
    beat("Click the citation to open the source", clickChip(0), { holdMs: 1000, cursorParkTo: [1245, 520] }),
    // Render the crawled page instead of leaving it as raw markdown.
    beat(
      "Render the crawled article in reading mode",
      runJs(`
        const leaf = window.app.workspace.activeLeaf;
        if (leaf && leaf.view?.getViewType?.() === 'markdown') {
          const s = leaf.getViewState();
          s.state = { ...s.state, mode: 'preview' };
          await leaf.setViewState(s);
        }
        await new Promise(r => setTimeout(r, 500));
      `),
      { holdMs: 700 },
    ),
    // Jump straight to the cited 9C1 police-package section. Reading mode
    // lazy-renders, so an off-screen "9C1" element isn't in the DOM for a
    // querySelector scroll; use Obsidian's applyScroll(line) with the line
    // number of "9C1" from the file content, which renders + scrolls there.
    beat(
      "Fast-scroll to the cited 9C1 section",
      runJs(`
        const leaf = window.app.workspace.activeLeaf;
        const view = leaf?.view;
        if (view?.file && view.currentMode?.applyScroll) {
          const lines = (await window.app.vault.read(view.file)).split('\\n');
          // Prefer the "9C1" section heading over the first match, which is
          // the table-of-contents link near the top of the page.
          let lineNo = lines.findIndex((l) => /^#{1,6}\\s.*9C1/.test(l));
          if (lineNo < 0) {
            for (let i = lines.length - 1; i >= 0; i--) {
              if (/9C1/.test(lines[i])) { lineNo = i; break; }
            }
          }
          if (lineNo >= 0) view.currentMode.applyScroll(lineNo);
        }
      `),
      { holdMs: 3200 },
    ),
    beat("Close the source", key("escape"), { holdMs: 500 }),
    beat(
      "Restore the original top_k",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        if (window.__crawlOrigTopK !== undefined) { p.settings.topK = window.__crawlOrigTopK; await p.saveSettings(); }
      `),
      { holdMs: 200 },
    ),
  ],
});
