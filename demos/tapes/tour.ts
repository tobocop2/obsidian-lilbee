/**
 * tour demo: a guided walk through every lilbee surface a user can
 * reach. Pure tour: no on-camera Q&A against an unindexed corpus.
 *
 * Surfaces covered:
 *  - chat panel + task center
 *  - model catalog (every category tab)
 *  - settings (lilbee tab, model rows + sections)
 *  - command palette showing the lilbee command surface
 *  - the four headline commands (crawl, browse documents, browse wiki,
 *    review wiki drafts) each opened briefly to show what's reachable
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
  layout: "chat-and-tasks",
  preloadChatModel: false,
  clearTaskCenter: true,
  clearChat: true,
  beats: [
    beat("Opening hold: chat + tasks side by side", sleep(900)),

    // Catalog walkthrough — every category so the viewer sees breadth.
    beat("Open the model catalog", command("lilbee:lilbee:catalog"), { holdMs: 1000 }),
    beat("Chat models tab", clickSelector(`${CATALOG_TAB} button:text-is("Chat")`), { holdMs: 800 }),
    beat("Embedding models tab", clickSelector(`${CATALOG_TAB} button:text-is("Embed")`), { holdMs: 800 }),
    beat("Vision models tab", clickSelector(`${CATALOG_TAB} button:text-is("Vision")`), { holdMs: 800 }),
    beat("Reranker models tab", clickSelector(`${CATALOG_TAB} button:text-is("Rerank")`), { holdMs: 900 }),
    beat("Close the catalog", key("escape"), { holdMs: 500 }),

    // Wiki view — show the concept browser surface.
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

    // Crawl modal — show the web-crawl entry point.
    beat("Open the crawl modal", command("lilbee:lilbee:crawl"), { holdMs: 1500 }),
    beat("Close the crawl modal", key("escape"), { holdMs: 500 }),

    // Settings — jump to lilbee tab, scroll through the configuration
    // surface so the viewer sees how much is tunable.
    beat("Open lilbee settings", openSettings(), { holdMs: 800 }),
    beat(
      "Expand sections so a scroll reveals real controls",
      runJs(`document.querySelectorAll('.vertical-tab-content details').forEach(d => d.setAttribute('open',''));`),
      { holdMs: 300 },
    ),
    beat("Scroll settings #1", wheelScroll(SETTINGS_PANE, -28), { holdMs: 700 }),
    beat("Scroll settings #2", wheelScroll(SETTINGS_PANE, -28), { holdMs: 700 }),
    beat("Close settings", key("escape"), { holdMs: 500 }),

    // Command palette — show every lilbee command in one place.
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700 },
    ),
    beat("Filter to lilbee commands", type_("lilbee"), { holdMs: 2000 }),
    beat("Close the palette", key("escape"), { holdMs: 500 }),

    beat("Final hold on chat + tasks", sleep(900)),
  ],
});
