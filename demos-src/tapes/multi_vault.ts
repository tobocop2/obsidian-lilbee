/**
 * multi_vault demo: switching the shared lilbee install between
 * two registered Obsidian vaults.
 *
 * Pre-flight assumes the shared-root layout from PR #92 is set up:
 *  - <shared-root>/registry.json lists at least two vaults
 *  - the demo vault is in managed mode and currently holds the lock
 *
 * Beat sequence: open the command palette, run "Switch lilbee to
 * another vault", show the picker listing the other registered vault
 * (firststart), pick it, watch the status bar drop the active model
 * and the notice land ("lilbee released for ..."). The viewer
 * understands the next step is switching Obsidian's open vault — that
 * step doesn't survive a single ffmpeg recording (Obsidian relaunches),
 * so the demo ends at the released state.
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
    beat("Opening hold on the active vault (demo)", sleep(900)),

    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 800 },
    ),
    beat("Filter to the switch-vault command", type_(SWITCH_VAULT_FILTER), { holdMs: 1500 }),
    beat("Run it — vault picker opens", key("enter"), { holdMs: 1800 }),

    beat(
      "Click Switch on the other registered vault",
      clickSelector(`.lilbee-vault-picker-card .lilbee-vault-picker-switch-btn`),
      { holdMs: 1500 },
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
