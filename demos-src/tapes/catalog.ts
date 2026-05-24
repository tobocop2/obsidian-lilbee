/**
 * catalog demo: infinite scroll across Chat / Embed / Vision, then a
 * direct search for a specific model.
 *
 * The catalog list paginates with PAGE_SIZE = 20 per fetch and fires
 * fetchPage when the scroll container is within
 * SCROLL_BOTTOM_THRESHOLD_PX (200) of its own bottom. Each beat moves
 * the OS cursor over the results list and drives real mouse-wheel
 * ticks, so the cursor is on the cards while the list scrolls — same
 * gesture a human would make.
 *
 * We scroll the LOCAL view of each task tab — the demo environment
 * doesn't expose Frontier rows, but Local pagination has has_more=true
 * for all three tasks so the load behavior is visible regardless.
 */
import { beat, clickSelector, key, runJs, sleep, storyboard, type_, wheelScroll } from "../src/lib.ts";

// Wheel ticks per scroll beat. macOS scroll ticks are tiny, so ~36
// ticks gets us most of the way down a card list. The threshold for
// fetching the next page is 200 px from bottom, so reaching anywhere
// near the end of the list triggers a fetch and the cards keep
// appearing below the cursor.
// Smaller bursts feel like a breeze through the list rather than a
// long deliberate scroll.
const TICKS_PER_SCROLL = -22;

const CATALOG_RESULTS = ".lilbee-catalog-results";

export default storyboard("catalog", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  clearTaskCenter: false,
  beats: [
    beat("Opening hold", sleep(500)),
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 500 },
    ),
    beat("Filter to the catalog command", type_("Browse model catalog"), { holdMs: 1100 }),
    beat("Open the catalog", key("enter"), { holdMs: 1000 }),

    // Modal already opens on Chat tab — no redundant click. Just scroll.
    beat("Scroll Chat #1", wheelScroll(CATALOG_RESULTS, TICKS_PER_SCROLL), { holdMs: 600 }),
    beat("Scroll Chat #2", wheelScroll(CATALOG_RESULTS, TICKS_PER_SCROLL), { holdMs: 600 }),
    beat("Scroll Chat #3", wheelScroll(CATALOG_RESULTS, TICKS_PER_SCROLL), { holdMs: 800 }),

    // Embed models — 2 page loads.
    beat("Embed tab", clickSelector('.lilbee-catalog-main-tab-bar button:text-is("Embed")'), { holdMs: 1000 }),
    beat("Scroll Embed #1", wheelScroll(CATALOG_RESULTS, TICKS_PER_SCROLL), { holdMs: 600 }),
    beat("Scroll Embed #2", wheelScroll(CATALOG_RESULTS, TICKS_PER_SCROLL), { holdMs: 800 }),

    // Vision models — 2 page loads.
    beat("Vision tab", clickSelector('.lilbee-catalog-main-tab-bar button:text-is("Vision")'), { holdMs: 1000 }),
    beat("Scroll Vision #1", wheelScroll(CATALOG_RESULTS, TICKS_PER_SCROLL), { holdMs: 600 }),
    beat("Scroll Vision #2", wheelScroll(CATALOG_RESULTS, TICKS_PER_SCROLL), { holdMs: 800 }),

    // Rerank models — same treatment so every category in the catalog
    // is on screen at least once.
    beat("Rerank tab", clickSelector('.lilbee-catalog-main-tab-bar button:text-is("Rerank")'), { holdMs: 1000 }),
    beat("Scroll Rerank #1", wheelScroll(CATALOG_RESULTS, TICKS_PER_SCROLL), { holdMs: 600 }),
    beat("Scroll Rerank #2", wheelScroll(CATALOG_RESULTS, TICKS_PER_SCROLL), { holdMs: 800 }),

    // Direct search: back to Chat, click search, type a specific name.
    beat("Back to Chat", clickSelector('.lilbee-catalog-main-tab-bar button:text-is("Chat")'), { holdMs: 700 }),
    beat("Click search box", clickSelector("input.lilbee-catalog-search"), { holdMs: 400 }),
    beat("Type a specific model name", type_("Phi-4"), { holdMs: 2000 }),

    beat("Close", key("escape"), { holdMs: 500 }),
  ],
});
