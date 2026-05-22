/**
 * settings demo: open the lilbee settings tab and wheel-scroll through
 * the whole pane so the viewer sees every section.
 *
 * Previously used an anchor-scroll-to-text helper; that worked but the
 * cursor stayed parked on the tab nav while the right pane moved on
 * its own. Real users have their pointer in the scroll area when they
 * scroll, so we wheel-scroll the `.vertical-tab-content` container
 * directly.
 */
import { beat, key, openSettings, runJs, sleep, storyboard, wheelScroll } from "../src/lib.ts";

const SETTINGS_PANE = ".vertical-tab-content";

export default storyboard("settings", {
  window: [1400, 900],
  layout: "blank",
  preloadChatModel: false,
  beats: [
    beat("Opening hold", sleep(500)),
    beat("Open settings, jump to lilbee tab", openSettings(), { holdMs: 900 }),
    beat(
      "Expand every section so scrolling reveals controls",
      runJs(`document.querySelectorAll('.vertical-tab-content details').forEach(d => d.setAttribute('open',''));`),
      { holdMs: 400 },
    ),
    // Six wheel-scrolls walking the full lilbee tab top to bottom.
    beat("Scroll #1", wheelScroll(SETTINGS_PANE, -20), { holdMs: 700 }),
    beat("Scroll #2", wheelScroll(SETTINGS_PANE, -20), { holdMs: 700 }),
    beat("Scroll #3", wheelScroll(SETTINGS_PANE, -20), { holdMs: 700 }),
    beat("Scroll #4", wheelScroll(SETTINGS_PANE, -20), { holdMs: 700 }),
    beat("Scroll #5", wheelScroll(SETTINGS_PANE, -20), { holdMs: 700 }),
    beat("Scroll #6", wheelScroll(SETTINGS_PANE, -20), { holdMs: 800 }),
    beat("Close", key("escape"), { holdMs: 500 }),
  ],
});
