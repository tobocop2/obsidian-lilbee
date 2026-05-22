/**
 * crawl demo: crawl the Caprice Wikipedia page + ask 9C1 question.
 */
import {
  beat,
  clickChip,
  clickSelector,
  clickSend,
  command,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  waitChatIdle,
  wheelScroll,
} from "../src/lib.ts";

const URL = "https://en.wikipedia.org/wiki/Chevrolet_Caprice";
const QUESTION = "When was the 9C1 police package introduced?";

// The cited source either lands in the workspace as a vault file
// (markdown / preview view) or as a source-preview modal. The
// selector list covers both so wheelScroll lands somewhere real.
const SOURCE_PREVIEW = ".workspace-leaf.mod-active .markdown-preview-view, .workspace-leaf.mod-active .cm-scroller, .lilbee-source-preview, .modal-container .markdown-rendered, .modal-content";

export default storyboard("crawl", {
  window: [1400, 900],
  layout: "chat-and-tasks",
  // The Caprice corpus entry is the markdown stored under
  // lilbee/_web/en.wikipedia.org/.../index.md
  freshIngest: ["index.md"],
  clearTaskCenter: true,
  clearChat: true,
  caption: "Recorded on a 2021 M1 Pro, 32 GB RAM.",
  beats: [
    beat("Opening hold", sleep(500)),
    beat("Open crawl modal", command("lilbee:lilbee:crawl"), { holdMs: 900 }),
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
    beat("Click the citation to open the source preview", clickChip(0), { holdMs: 1400 }),
    // Three real wheel bursts so the body flies by, then a smooth
    // scroll that snaps the 9C1 section to centre-screen. wheelScroll
    // uses the OS wheel via pyautogui so the modal's actual scroll
    // container handles it (whatever Obsidian picked).
    beat("Rapid scroll #1", wheelScroll(SOURCE_PREVIEW, -55), { holdMs: 250 }),
    beat("Rapid scroll #2", wheelScroll(SOURCE_PREVIEW, -55), { holdMs: 250 }),
    beat("Rapid scroll #3", wheelScroll(SOURCE_PREVIEW, -55), { holdMs: 250 }),
    beat(
      "Land on the 9C1 section",
      runJs(`
        // Search across modal AND workspace contexts so we land
        // whether the chip opened a vault tab or the preview modal.
        const roots = [
          document.querySelector('.lilbee-source-preview, .modal-content'),
          document.querySelector('.workspace-leaf.mod-active'),
          document,
        ].filter(Boolean);
        for (const root of roots) {
          const headings = Array.from(root.querySelectorAll('h2, h3, h4'));
          const targetHeading = headings.find(el => /\\b9C1\\b/i.test(el.textContent ?? ""));
          const target = targetHeading ?? Array.from(root.querySelectorAll('p, li')).find(el => /\\b9C1\\b/.test(el.textContent ?? ""));
          if (target && target.scrollIntoView) {
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
            return;
          }
        }
      `),
      { holdMs: 3000 },
    ),
    beat("Close source preview", key("escape"), { holdMs: 500 }),
  ],
});
