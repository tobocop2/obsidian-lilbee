/**
 * tour demo: a guided walk through every lilbee surface a user reaches
 * during normal use. Runs against an already-used vault so the file
 * tree shows real documents and the task center has historical entries.
 *
 * Surfaces covered:
 *  - file explorer with the documents already in the vault
 *  - chat panel + task center
 *  - model catalog (every category tab)
 *  - wiki view in the right sidebar
 *  - settings (lilbee tab)
 *  - command palette filtered to the lilbee command surface
 */
import {
  beat,
  clickSelector,
  command,
  key,
  openSettings,
  runJs,
  sleep,
  storyboard,
  type_,
  wheelScroll,
} from "../src/lib.ts";

const CATALOG_TAB = ".lilbee-catalog-main-tab-bar";
const SETTINGS_PANE = ".vertical-tab-content";

export default storyboard("tour", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  preloadChatModel: false,
  // Tour against an already-used vault. Keep task center entries so
  // the viewer sees real history. Don't clear chat.
  clearTaskCenter: false,
  clearChat: false,
  beats: [
    beat("Opening hold: file explorer + chat + tasks", sleep(900)),

    beat(
      "Glance at the file explorer (the vault's existing documents)",
      runJs(`
        const fe = window.app.workspace.getLeavesOfType('file-explorer')[0];
        if (fe) {
          window.app.workspace.leftSplit?.expand?.();
          window.app.workspace.revealLeaf(fe);
        }
        await new Promise(r => setTimeout(r, 200));
      `),
      { holdMs: 1300 },
    ),

    beat("Open the model catalog", command("lilbee:lilbee:catalog"), { holdMs: 1000 }),
    beat("Chat models tab", clickSelector(`${CATALOG_TAB} button:text-is("Chat")`), { holdMs: 800 }),
    beat("Embedding models tab", clickSelector(`${CATALOG_TAB} button:text-is("Embed")`), { holdMs: 800 }),
    beat("Vision models tab", clickSelector(`${CATALOG_TAB} button:text-is("Vision")`), { holdMs: 800 }),
    beat("Reranker models tab", clickSelector(`${CATALOG_TAB} button:text-is("Rerank")`), { holdMs: 900 }),
    beat("Close the catalog", key("escape"), { holdMs: 500 }),

    beat(
      "Open the wiki view in the right sidebar",
      runJs(`
        const cmd = window.app.commands.commands["lilbee:lilbee:wiki"];
        if (cmd) window.app.commands.executeCommandById("lilbee:lilbee:wiki");
        await new Promise(r => setTimeout(r, 400));
      `),
      { holdMs: 1500 },
    ),
    beat("Close wiki view back to chat", key("escape"), { holdMs: 500 }),

    beat("Open the crawl modal", command("lilbee:lilbee:crawl"), { holdMs: 1500 }),
    beat("Close the crawl modal", key("escape"), { holdMs: 500 }),

    beat("Open lilbee settings", openSettings(), { holdMs: 800 }),
    beat(
      "Expand sections so a scroll reveals real controls",
      runJs(`document.querySelectorAll('.vertical-tab-content details').forEach(d => d.setAttribute('open',''));`),
      { holdMs: 300 },
    ),
    beat("Scroll settings #1", wheelScroll(SETTINGS_PANE, -28), { holdMs: 700 }),
    beat("Scroll settings #2", wheelScroll(SETTINGS_PANE, -28), { holdMs: 700 }),
    beat("Close settings", key("escape"), { holdMs: 500 }),

    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700 },
    ),
    beat("Filter to lilbee commands", type_("lilbee"), { holdMs: 2000 }),
    beat("Close the palette", key("escape"), { holdMs: 500 }),

    beat("Final hold on file explorer + chat + tasks", sleep(900)),
  ],
});
