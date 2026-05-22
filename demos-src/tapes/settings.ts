/**
 * settings demo: open the lilbee settings tab by clicking the green
 * status-bar icon, then wheel-scroll the pane top to bottom so the
 * viewer sees every section. Minimum dead time between beats.
 */
import { beat, clickSelector, key, runJs, sleep, storyboard, wheelScroll } from "../src/lib.ts";

const STATUS_BAR_ICON = ".status-bar-item.plugin-lilbee:not(.lilbee-sync-hint)";
const SETTINGS_PANE = ".vertical-tab-content";

export default storyboard("settings", {
  window: [1400, 900],
  layout: "blank",
  preloadChatModel: false,
  beats: [
    beat("Opening hold (short)", sleep(300)),
    beat("Click the green lilbee status-bar icon", clickSelector(STATUS_BAR_ICON), { holdMs: 700 }),
    beat(
      "Expand every section so scrolling reveals controls",
      runJs(`document.querySelectorAll('.vertical-tab-content details').forEach(d => d.setAttribute('open',''));`),
      { holdMs: 250 },
    ),
    beat("Scroll #1", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #2", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #3", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #4", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #5", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #6", wheelScroll(SETTINGS_PANE, -22), { holdMs: 500 }),
    beat("Close", key("escape"), { holdMs: 400 }),
  ],
});
