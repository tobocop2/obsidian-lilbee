/**
 * multi_vault demo: switching which vault lilbee serves.
 *
 * On b431 the open Obsidian vault is authoritative — there is no in-app
 * vault picker. When lilbee is serving another vault, "Take over the
 * managed lilbee server" switches it to the vault you have open. The
 * confirm modal names both vaults, demonstrating multiple vaults in play.
 *
 * Pre-flight (staged outside the tape): another vault ("Research") holds
 * the lock with a live server, and this (demo) vault is open with no
 * managed server of its own — so the status bar reads
 * `lilbee: serving "Research"` and the take-over command is available.
 *
 * Beat sequence: hold on the "serving Research" state, run Take over,
 * read the switch-confirm modal ("...currently serving Research. Switch
 * it to this vault?"), confirm, wait for this vault's own server to come
 * up + pin its chat model, then Show Status — now reporting this vault's
 * documents and model — to confirm lilbee is live here. The layout shows
 * a note (not chat), since the chat pane reads "not serving this vault"
 * until the switch completes.
 */
import { beat, clickSelector, command, key, runJs, sleep, storyboard } from "../src/lib.ts";

// Global command id (plugin id "lilbee" + command id "lilbee:take-over").
const TAKE_OVER_CMD = "lilbee:lilbee:take-over";
const CHAT_MODEL = "Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf";
// The vault lilbee starts out serving, named in the confirm modal.
const OTHER_VAULT = "Research";

export default storyboard("multi_vault", {
  window: [1400, 900],
  layout: "explorer-note-tasks",
  // No server of our own at the open: the status bar reads
  // `lilbee: serving "Research"`. Keep the seeded Task Center history so
  // the vault looks actively used.
  skipServerCheck: true,
  skipModelPin: true,
  preloadChatModel: false,
  clearTaskCenter: false,
  clearChat: false,
  beats: [
    beat(`Opening hold — lilbee is serving the ${OTHER_VAULT} vault`, sleep(1400), {
      caption: `One lilbee, many vaults. Right now it's serving the "${OTHER_VAULT}" vault, not this one.`,
    }),

    // Fire the take-over command (shown with a ⌘P badge). Hold on the
    // confirm modal so the viewer reads that lilbee is serving another
    // vault before the switch — this is the "multiple vaults" moment.
    beat("Take over the managed lilbee server", command(TAKE_OVER_CMD), {
      holdMs: 2800,
      keyHint: "⌘P",
      caption: 'Command palette → "Take over the managed lilbee server".',
    }),
    beat(
      "Switch lilbee to this vault",
      clickSelector(".lilbee-confirm-modal button.mod-cta"),
      { holdMs: 2400, caption: "lilbee asks before switching. Confirm to move it to this vault." },
    ),
    // lilbee terminates the other server and starts one for this vault. Wait
    // for it to report healthy, then pin its chat model so Show Status (and
    // the chat) report a live, ready vault rather than an empty one.
    beat(
      "lilbee starts serving this vault",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        let url;
        for (let i = 0; i < 160; i++) {
          url = p.api?.baseUrl;
          if (url) { try { const r = await fetch(url + "/api/health"); if (r.ok) break; } catch {} }
          await new Promise((r) => setTimeout(r, 500));
        }
        const auth = { Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
        await fetch(url + "/api/models/chat", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({ model: ${JSON.stringify(CHAT_MODEL)} }),
        });
        await p.fetchActiveModel?.();
      `),
      { holdMs: 1500, maxMs: 150_000, speedup: 6, caption: "lilbee hands off and starts serving this vault instead." },
    ),

    beat(
      "Show Status — this vault is now live",
      runJs(`window.app.commands.executeCommandById("lilbee:lilbee:status");`),
      { holdMs: 3200, caption: "Now serving this vault — its own documents and model." },
    ),
    beat("Close the status modal", key("escape"), { holdMs: 800 }),
  ],
});
