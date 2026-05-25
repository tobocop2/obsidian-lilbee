/**
 * settings demo: open the lilbee settings tab, then wheel-scroll the pane
 * top to bottom so the viewer sees every section (Models, Search &
 * Retrieval, Crawling, …). Minimum dead time between beats.
 *
 * Settings open via the command palette ("Open settings" + click the
 * lilbee tab) rather than the status-bar icon: the demo vault has
 * documents pending sync, so the single status icon is in its
 * actionable sync-prompt state and clicking it would start a sync.
 */
import { beat, key, runJs, sleep, storyboard, type_, wheelScroll } from "../src/lib.ts";

const SETTINGS_PANE = ".vertical-tab-content";

export default storyboard("settings", {
  window: [1400, 900],
  layout: "blank",
  preloadChatModel: false,
  beats: [
    beat("Opening hold (short)", sleep(400)),

    // Open Obsidian settings via the palette (⌘P badge shows the shortcut),
    // then select the lilbee tab. The tab is selected programmatically — no
    // cursor detour to the nav corner — so the only visible motion is the
    // natural scroll through the lilbee settings that follows.
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 500, keyHint: "⌘P" },
    ),
    beat('Type "Open settings"', type_("Open settings"), { holdMs: 1000 }),
    beat("Open settings", key("enter"), { holdMs: 1000 }),
    beat(
      "Open the lilbee settings tab",
      runJs(`
        const tab = Array.from(document.querySelectorAll('.vertical-tab-nav-item'))
          .find(el => /^lilbee$/i.test((el.textContent || '').trim()));
        if (tab) tab.click();
      `),
      { holdMs: 900 },
    ),

    beat(
      "Expand every collapsible section so scrolling reveals all controls",
      runJs(`document.querySelectorAll('.vertical-tab-content details').forEach(d => d.setAttribute('open',''));`),
      { holdMs: 300 },
    ),
    beat("Scroll #1", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #2", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #3", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #4", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #5", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #6", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #7", wheelScroll(SETTINGS_PANE, -22), { holdMs: 450 }),
    beat("Scroll #8", wheelScroll(SETTINGS_PANE, -22), { holdMs: 500 }),
    beat("Close", key("escape"), { holdMs: 400 }),
  ],
});
