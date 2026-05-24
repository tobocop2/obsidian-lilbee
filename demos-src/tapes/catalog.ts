/**
 * catalog demo: a fast flick down each model list — Chat / Embed /
 * Vision / Rerank — to show how many models there are, then a direct
 * search for a specific one.
 *
 * The modal opens on the Discover tab (a short curated "OUR PICKS"
 * grid), so we click into Chat / Embed / Vision / Rerank — the full
 * paginated lists — and flick each one. Each tab gets a single fast
 * wheel-scroll beat: the cursor moves to the results list once and rips
 * down through the cards (infinite scroll fetches the next page as it
 * nears the bottom), so the motion is one deliberate flick per tab
 * rather than the cursor bouncing between the tab bar and the list.
 */
import { beat, clickSelector, key, runJs, sleep, storyboard, type_, wheelScroll } from "../src/lib.ts";

// One long fast flick per tab. macOS scroll ticks are tiny, so a big
// count rips through many cards; "fast" mode uses large bursts and short
// pauses so it reads as a quick flick, not a deliberate read.
const FLICK = -60;
const CATALOG_RESULTS = ".lilbee-catalog-results";
const tab = (name: string) => `.lilbee-catalog-main-tab-bar button:text-is("${name}")`;

export default storyboard("catalog", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  clearTaskCenter: false,
  preloadChatModel: false,
  beats: [
    beat("Opening hold", sleep(500)),
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 500 },
    ),
    beat("Filter to the catalog command", type_("Browse model catalog"), { holdMs: 1000 }),
    beat("Open the catalog", key("enter"), { holdMs: 900 }),

    // The modal opens on Discover (curated picks); click into Chat for the
    // full paginated list, then flick down through it.
    beat("Chat tab", clickSelector(tab("Chat")), { holdMs: 600 }),
    beat("Flick through the Chat models", wheelScroll(CATALOG_RESULTS, FLICK, true), { holdMs: 700 }),

    beat("Embed tab", clickSelector(tab("Embed")), { holdMs: 700 }),
    beat("Flick through the Embed models", wheelScroll(CATALOG_RESULTS, FLICK, true), { holdMs: 700 }),

    beat("Vision tab", clickSelector(tab("Vision")), { holdMs: 700 }),
    beat("Flick through the Vision models", wheelScroll(CATALOG_RESULTS, FLICK, true), { holdMs: 700 }),

    beat("Rerank tab", clickSelector(tab("Rerank")), { holdMs: 700 }),
    beat("Flick through the Rerank models", wheelScroll(CATALOG_RESULTS, FLICK, true), { holdMs: 700 }),

    // Direct search: back to Chat, then type a specific model name.
    beat("Back to the Chat tab", clickSelector(tab("Chat")), { holdMs: 600 }),
    beat("Click the search box", clickSelector("input.lilbee-catalog-search"), { holdMs: 400 }),
    beat("Search for a specific model", type_("Phi-4"), { holdMs: 1800 }),

    beat("Close the catalog", key("escape"), { holdMs: 500 }),
  ],
});
