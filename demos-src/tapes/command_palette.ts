/**
 * command_palette demo: reach lilbee through the command palette, then
 * show the payoff of a crawl.
 *
 *   1. Open lilbee settings (Cmd-P + Open settings + click lilbee tab)
 *   2. Crawl a web page (Cmd-P + Crawl web page + paste URL + run it)
 *   3. Ask the just-crawled page a question — a cited answer, then the
 *      citation opens the crawled article at the relevant section.
 *
 * Every command activation goes through the visible palette flow.
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
} from "../src/lib.ts";

const SAMPLE_URL = "https://en.wikipedia.org/wiki/Knowledge_graph";
const QUESTION = "What is a knowledge graph?";

const palette = (label: string, query: string, holdAfter = 1100) => [
  beat(
    `Open the command palette (${label})`,
    runJs(`window.app.commands.executeCommandById("command-palette:open");`),
    { holdMs: 500, keyHint: "⌘P" },
  ),
  beat(`Type "${query}"`, type_(query), { holdMs: 1100 }),
  beat(`Run ${label}`, key("enter"), { holdMs: holdAfter }),
];

export default storyboard("command_palette", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  preloadChatModel: true,
  clearTaskCenter: false,
  clearChat: true,
  // The crawled Knowledge_graph page is stored as index.md under
  // lilbee/_web/.../Knowledge_graph/ — drop it so the crawl is fresh.
  freshIngest: ["index.md"],
  beats: [
    beat("Opening hold on the chat panel", sleep(300)),

    // 1. Open settings via palette, then click the lilbee tab.
    ...palette("Open settings", "Open settings", 1300),
    beat(
      "Click the lilbee tab in the settings nav",
      clickSelector('.vertical-tab-nav-item:text-is("lilbee")'),
      { holdMs: 1500 },
    ),
    beat("Close settings", key("escape"), { holdMs: 600 }),

    // 2. Crawl a web page via palette: paste a URL, run it, watch the
    // crawl + sync land in the Task Center.
    ...palette("Crawl web page", "Crawl web page", 1000),
    beat(
      "Paste a URL into the crawl modal",
      runJs(`
        const input = document.querySelector('input.lilbee-crawl-url');
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(SAMPLE_URL)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `),
      { holdMs: 1100 },
    ),
    beat("Click Crawl", clickSelector('.modal-container button.mod-cta:has-text("Crawl")'), { holdMs: 1000 }),
    beat(
      "Watch the crawl + sync run in the Task Center",
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
      { holdMs: 1200, speedup: 4, maxMs: 600_000 },
    ),
    // Wikipedia references crawl as [[N]](url), which Obsidian mis-renders
    // as a broken wikilink plus a literal URL. Strip them so the cited page
    // reads cleanly when the citation opens it.
    beat(
      "Tidy the crawled markdown (strip reference-link clutter)",
      runJs(`
        const adapter = window.app.vault.adapter;
        const files = window.app.vault.getFiles().filter(f => f.path.startsWith('lilbee/_web/') && f.path.endsWith('index.md'));
        for (const f of files) {
          const md = await adapter.read(f.path);
          await adapter.write(f.path, md.replace(/\\[\\[[^\\]]*\\]\\]\\([^)]*\\)/g, ''));
        }
      `),
      { holdMs: 150 },
    ),

    // 3. Ask the just-crawled page a question, then open the citation.
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
    beat("Ask about the knowledge graph", fillChat(QUESTION), { holdMs: 600 }),
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
    beat("Cited answer from the just-crawled page", runJs(`
      const send = document.querySelector('.lilbee-chat-send');
      for (let i = 0; i < 240; i++) {
        const t = (send?.textContent || '').toLowerCase();
        if (t.includes('send') && i > 4) return;
        await new Promise(r => setTimeout(r, 500));
      }
    `), { holdMs: 1400, speedup: 4, maxMs: 180_000 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    // Park the cursor in the source pane's empty right margin so it never
    // dwells on one of the article's links while it scrolls.
    beat("Click the citation to open the source", clickChip(0), { holdMs: 1000, cursorParkTo: [1245, 520] }),
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
    // Glide down through the crawled article (not a jump that lingers at
    // the top) and land on the Definitions section — the part that
    // answers "what is a knowledge graph?". Reading mode lazy-renders, so
    // applyScroll(line) in paused steps reliably renders + scrolls.
    beat(
      "Scroll down through the crawled article to the Definitions section",
      runJs(`
        const view = window.app.workspace.activeLeaf?.view;
        if (view?.file && view.currentMode?.applyScroll) {
          const lines = (await window.app.vault.read(view.file)).split('\\n');
          let target = lines.findIndex((l) => /^#{1,6}\\s+definitions/i.test(l));
          if (target < 0) target = lines.findIndex((l) => /^#{1,6}\\s+history/i.test(l));
          if (target < 0) target = lines.findIndex((l, i) => i > 60 && /^##\\s/.test(l));
          if (target >= 0) {
            const steps = 4;
            for (let i = 1; i < steps; i++) {
              view.currentMode.applyScroll(Math.round((target * i) / steps));
              await new Promise(r => setTimeout(r, 1300));
            }
            view.currentMode.applyScroll(target);
          }
        }
      `),
      { holdMs: 3000 },
    ),
    beat("Close the source", key("escape"), { holdMs: 500 }),
  ],
});
