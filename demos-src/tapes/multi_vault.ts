/**
 * multi_vault demo: switching the shared lilbee install between
 * two registered Obsidian vaults.
 *
 * Pre-flight assumes the shared-root layout from PR #92 is set up:
 *  - <shared-root>/registry.json lists at least two vaults
 *  - the demo vault is in managed mode and currently holds the lock
 *
 * Beat sequence: open the command palette, run "Switch lilbee to another
 * vault", read the picker listing the other registered vaults, filter to
 * one by name (Research) so the choice is deliberate, switch to it, then
 * confirm the release in Show Status — the status bar drops the active
 * model and the server stops. The viewer understands the next step is
 * reopening Obsidian on that vault; that relaunch doesn't survive a single
 * ffmpeg recording, so the demo ends at the released state.
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

const SWITCH_VAULT_FILTER = "Switch lilbee to another vault";
// A clean, independent registered vault to switch to (not the firststart
// vault, which the first_start demo owns).
const TARGET_VAULT = "Research";

export default storyboard("multi_vault", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  // Pin Qwen3 8B so the opening "active vault" state reads as running
  // (green status, model shown) before the switch releases it. Keep the
  // seeded Task Center history so the source vault looks actively used.
  preloadChatModel: false,
  clearTaskCenter: false,
  clearChat: true,
  beats: [
    beat("Opening hold on the active vault (demo)", sleep(300)),

    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 800, keyHint: "⌘P" },
    ),
    beat("Filter to the switch-vault command", type_(SWITCH_VAULT_FILTER), { holdMs: 1500 }),
    // Hold on the picker so the viewer reads the registered vaults before a
    // choice is made — this is the "you have several vaults" moment.
    beat("Run it — the vault picker opens", key("enter"), { holdMs: 2400 }),
    beat("Click the picker's filter field", clickSelector(".lilbee-vault-picker-filter-input"), { holdMs: 500 }),
    beat(`Narrow to the ${TARGET_VAULT} vault`, type_(TARGET_VAULT), { holdMs: 1600 }),
    beat(
      `Switch lilbee to the ${TARGET_VAULT} vault`,
      clickSelector(`.lilbee-vault-picker-card .lilbee-vault-picker-switch-btn`),
      { holdMs: 1800 },
    ),
    // Give the plugin a beat to repaint the status bar (release → "Stopped"
    // muted dot) before the viewer's eye moves on. The release fires
    // synchronously but the DOM update lands on the next frame.
    beat(
      "Force a status-bar repaint",
      runJs(`
        // Touch the task queue so updateStatusBarFromQueue runs and
        // setStatusReady's released-state branch repaints the bar.
        const tq = window.app.plugins.plugins.lilbee?.taskQueue;
        if (tq) tq.emitChange?.();
        await new Promise(r => setTimeout(r, 200));
      `),
      { holdMs: 1500 },
    ),

    // Open Show Status as concrete proof: server stopped, model row
    // empty in the panel.
    beat(
      "Open Show Status to confirm the release",
      runJs(`window.app.commands.executeCommandById("lilbee:lilbee:status");`),
      { holdMs: 2500 },
    ),
    beat(
      "Close the status modal",
      key("escape"),
      { holdMs: 800 },
    ),
  ],
});
