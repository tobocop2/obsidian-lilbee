/**
 * command_palette demo: three palette flows back to back so the viewer
 * sees how Obsidian users reach lilbee surfaces.
 *
 *   1. Open lilbee settings (Cmd-P + Open settings + click lilbee tab)
 *   2. Crawl a web page (Cmd-P + Crawl web page + paste URL + dismiss)
 *   3. Add the current file (Cmd-P + Add current file)
 *
 * No invisible runJs executeCommandById. Every command activation goes
 * through the visible palette flow.
 */
import {
  beat,
  clickSelector,
  key,
  runJs,
  sleep,
  storyboard,
  type_,
} from "../src/lib.ts";

const SAMPLE_URL = "https://en.wikipedia.org/wiki/Knowledge_graph";
const OPEN_VAULT_FILE = "Code/lilbee-README.md";

const palette = (label: string, query: string, holdAfter = 1100) => [
  beat(
    `Open the command palette (${label})`,
    runJs(`window.app.commands.executeCommandById("command-palette:open");`),
    { holdMs: 500 },
  ),
  beat(`Type "${query}"`, type_(query), { holdMs: 1100 }),
  beat(`Run ${label}`, key("enter"), { holdMs: holdAfter }),
];

export default storyboard("command_palette", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  preloadChatModel: false,
  clearTaskCenter: false,
  clearChat: true,
  // The "Add current file" step adds the README. It's already in the
  // corpus, so without removing it first the add hits the "already
  // indexed — re-add?" confirm modal and the Task Center never fills.
  // Drop it from the index in pre-flight; the add re-ingests it cleanly.
  freshIngest: ["lilbee-README.md"],
  beats: [
    beat("Opening hold on the chat panel", sleep(700)),

    // 1. Open settings via palette, then click the lilbee tab.
    ...palette("Open settings", "Open settings", 1300),
    beat(
      "Click the lilbee tab in the settings nav",
      clickSelector('.vertical-tab-nav-item:text-is("lilbee")'),
      { holdMs: 1500 },
    ),
    beat("Close settings", key("escape"), { holdMs: 600 }),

    // 2. Crawl a web page via palette: paste a URL, then actually run it
    // and watch the crawl + sync land in the Task Center.
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

    // 3. Open a file from the vault, then Add current file via palette.
    beat(
      "Open the lilbee README in a new tab",
      runJs(`
        await window.app.workspace.openLinkText(${JSON.stringify(OPEN_VAULT_FILE)}, '', 'tab');
        await new Promise(r => setTimeout(r, 250));
      `),
      { holdMs: 800 },
    ),
    ...palette("Add current file", "Add current file", 800),
    beat(
      "Watch the Task Center fill in real time",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        let sawActive = false;
        for (let i = 0; i < 120; i++) {
          const busy = tq.activeAll.length + tq.queued.length;
          if (busy > 0) sawActive = true;
          if (sawActive && busy === 0) return;
          await new Promise(r => setTimeout(r, 300));
        }
      `),
      { holdMs: 1200, speedup: 3 },
    ),

    beat("Final hold on chat + populated Task Center", sleep(800)),
  ],
});
