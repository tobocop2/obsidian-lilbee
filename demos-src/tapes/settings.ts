/**
 * settings demo: open the lilbee settings tab by clicking the green
 * status-bar icon (the canonical entry the plugin exposes), then
 * wheel-scroll the pane top to bottom so the viewer sees every
 * section.
 */
import { beat, clickSelector, key, runJs, sleep, storyboard, wheelScroll } from "../src/lib.ts";

const STATUS_BAR_ICON = ".status-bar-item.plugin-lilbee:not(.lilbee-sync-hint)";
const SETTINGS_PANE = ".vertical-tab-content";

export default storyboard("settings", {
  window: [1400, 900],
  layout: "blank",
  preloadChatModel: false,
  beats: [
    beat("Opening hold on the empty workspace", sleep(700)),
    beat("Mouse to the green lilbee status-bar icon and click", clickSelector(STATUS_BAR_ICON), { holdMs: 1000 }),
    beat(
      "Expand every section so scrolling reveals controls",
      runJs(`document.querySelectorAll('.vertical-tab-content details').forEach(d => d.setAttribute('open',''));`),
      { holdMs: 400 },
    ),
    beat("Scroll #1", wheelScroll(SETTINGS_PANE, -20), { holdMs: 700 }),
    beat("Scroll #2", wheelScroll(SETTINGS_PANE, -20), { holdMs: 700 }),
    beat("Scroll #3", wheelScroll(SETTINGS_PANE, -20), { holdMs: 700 }),
    beat("Scroll #4", wheelScroll(SETTINGS_PANE, -20), { holdMs: 700 }),
    beat("Scroll #5", wheelScroll(SETTINGS_PANE, -20), { holdMs: 700 }),
    beat("Scroll #6", wheelScroll(SETTINGS_PANE, -20), { holdMs: 800 }),
    beat("Close", key("escape"), { holdMs: 500 }),
  ],
});
