/**
 * tour demo: exhaustive walk through every lilbee surface in a used
 * vault. Documents already indexed, chat history present, Task Center
 * has entries from prior runs. Every command activation goes through
 * the command palette so the action is visible — no invisible runJs
 * executeCommandById calls.
 *
 * One real Q&A at the end so the viewer sees the citation loop.
 */
import {
  beat,
  clickChip,
  clickSend,
  clickSelector,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  type_,
  waitChatIdle,
  wheelScroll,
} from "../src/lib.ts";

const CATALOG_TAB = ".lilbee-catalog-main-tab-bar";
const SETTINGS_PANE = ".vertical-tab-content";
const QUESTION = "What is lilbee in one sentence again?";

// Open the command palette and run a command by typing its label. Every
// command activation in this tour goes through this flow so the viewer
// sees the palette open, the text typed, and the command selected.
const runViaPalette = (label: string, typeText: string, holdAfter = 1100) => [
  beat(
    `Open the command palette (for: ${label})`,
    runJs(`window.app.commands.executeCommandById("command-palette:open");`),
    { holdMs: 500 },
  ),
  beat(`Type "${typeText}"`, type_(typeText), { holdMs: 1000 }),
  beat(`Run ${label}`, key("enter"), { holdMs: holdAfter }),
];

export default storyboard("tour", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  preloadChatModel: true,
  // Used vault: keep history visible in chat AND task center.
  clearTaskCenter: false,
  clearChat: false,
  beats: [
    beat("Opening hold: file explorer + chat + tasks with prior history", sleep(900)),

    // File explorer with real documents visible.
    beat(
      "Reveal the file explorer so the indexed documents are visible",
      runJs(`
        window.app.workspace.leftSplit?.expand?.();
        const fe = window.app.workspace.getLeavesOfType('file-explorer')[0];
        if (fe) window.app.workspace.revealLeaf(fe);
        await new Promise(r => setTimeout(r, 200));
      `),
      { holdMs: 1300 },
    ),

    // Model catalog via palette.
    ...runViaPalette("Browse model catalog", "Browse model catalog", 1100),
    beat("Walk Chat tab", clickSelector(`${CATALOG_TAB} button:text-is("Chat")`), { holdMs: 700 }),
    beat("Walk Embed tab", clickSelector(`${CATALOG_TAB} button:text-is("Embed")`), { holdMs: 700 }),
    beat("Walk Vision tab", clickSelector(`${CATALOG_TAB} button:text-is("Vision")`), { holdMs: 700 }),
    beat("Walk Rerank tab", clickSelector(`${CATALOG_TAB} button:text-is("Rerank")`), { holdMs: 800 }),
    beat("Close the catalog", key("escape"), { holdMs: 500 }),

    // Wiki view via palette. Command's user-facing name is "Browse wiki".
    ...runViaPalette("Browse wiki", "Browse wiki", 1500),
    beat("Close wiki view back to chat", key("escape"), { holdMs: 500 }),

    // Crawl modal via palette.
    ...runViaPalette("Crawl web page", "Crawl web page", 1300),
    beat("Close the crawl modal", key("escape"), { holdMs: 500 }),

    // Task Center view via palette so the viewer sees the entries panel.
    ...runViaPalette("Show task center", "Show task center", 1500),
    beat("Close Task Center", key("escape"), { holdMs: 500 }),

    // Settings via the green status-bar icon (mouse click — visible).
    beat(
      "Mouse to the green lilbee status-bar icon and click",
      clickSelector('.status-bar-item.plugin-lilbee:not(.lilbee-sync-hint)'),
      { holdMs: 900 },
    ),
    beat(
      "Expand every section so a scroll reveals controls",
      runJs(`document.querySelectorAll('.vertical-tab-content details').forEach(d => d.setAttribute('open',''));`),
      { holdMs: 300 },
    ),
    beat("Scroll settings #1", wheelScroll(SETTINGS_PANE, -28), { holdMs: 600 }),
    beat("Scroll settings #2", wheelScroll(SETTINGS_PANE, -28), { holdMs: 600 }),
    beat("Close settings", key("escape"), { holdMs: 500 }),

    // Real Q&A against the existing corpus.
    beat(
      "Activate the chat panel for the question",
      runJs(`
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 200));
      `),
      { holdMs: 500 },
    ),
    beat("Ask the closing question", fillChat(QUESTION), { holdMs: 500 }),
    beat("Send", clickSend(), { holdMs: 500 }),
    beat("Stream the cited answer", waitChatIdle(120_000), { holdMs: 1200, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    beat("Click the citation chip", clickChip(0), { holdMs: 1800 }),
    beat("Close source preview", key("escape"), { holdMs: 500 }),
  ],
});
