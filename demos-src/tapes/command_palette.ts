/**
 * command_palette demo: drive three lilbee surfaces from Cmd-P so the
 * viewer sees how Obsidian users actually reach the plugin.
 *
 *   1. lilbee settings (open + dismiss)
 *   2. lilbee crawl  (open the modal + paste a URL + dismiss)
 *   3. add current file (open a vault file, then add it via palette)
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

export default storyboard("command_palette", {
  window: [1400, 900],
  layout: "chat-and-tasks",
  preloadChatModel: false,
  clearTaskCenter: true,
  clearChat: true,
  freshIngest: ["lilbee-README.md"],
  beats: [
    beat("Opening hold on the freshly cleared chat", sleep(800)),

    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700 },
    ),
    beat("Filter to lilbee settings", type_("lilbee open settings"), { holdMs: 1200 }),
    beat("Open settings", key("enter"), { holdMs: 1600 }),
    beat("Dismiss settings", key("escape"), { holdMs: 700 }),

    beat(
      "Open the command palette again",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700 },
    ),
    beat("Filter to lilbee crawl", type_("lilbee crawl"), { holdMs: 1200 }),
    beat("Open the crawl modal", key("enter"), { holdMs: 1000 }),
    beat(
      "Type a URL so the crawl modal isn't empty",
      runJs(`
        const input = document.querySelector('input.lilbee-crawl-url');
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(SAMPLE_URL)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `),
      { holdMs: 1300 },
    ),
    beat("Dismiss the crawl modal", key("escape"), { holdMs: 700 }),

    beat(
      "Open the lilbee README so the next palette has a target",
      runJs(`
        await window.app.workspace.openLinkText(${JSON.stringify(OPEN_VAULT_FILE)}, '', 'tab');
        await new Promise(r => setTimeout(r, 300));
      `),
      { holdMs: 900 },
    ),
    beat(
      "Open the command palette one more time",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700 },
    ),
    beat("Filter to Add current file", type_("lilbee add current file"), { holdMs: 1300 }),
    beat("Add the README to lilbee", key("enter"), { holdMs: 800 }),
    beat(
      "Watch the ingest land in the Task Center",
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

    beat("Final hold on chat + populated task center", sleep(900)),
  ],
});
