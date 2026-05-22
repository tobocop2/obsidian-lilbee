/**
 * command_palette demo: walk the lilbee command surface by opening a
 * few commands via Cmd-P in sequence so the viewer sees how each one
 * lands.
 *
 * Pre-flight runs a real chat + sync so the Task Center has visible
 * completed entries while the palette demo plays. Without that the
 * Task Center is empty and the palette opens land in a void.
 */
import {
  beat,
  clickSend,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  type_,
  waitChatIdle,
} from "../src/lib.ts";

const QUESTION = "What does the manual say about jump-starting the battery?";

export default storyboard("command_palette", {
  window: [1400, 900],
  layout: "chat-and-tasks",
  preloadChatModel: true,
  // Do NOT clear the task center — the historical entries from prior
  // demos (ingests, crawls) stay visible so the palette has context.
  clearTaskCenter: false,
  clearChat: true,
  beats: [
    beat("Opening hold on the freshly cleared chat", sleep(700)),

    // Fire a real sync so the Task Center gets a fresh active entry
    // while the demo plays. Sync runs against the existing corpus and
    // either no-ops quickly or kicks off retry-skipped — both register
    // a visible task row.
    beat(
      "Kick off a vault sync so the Task Center shows live activity",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const tok = p?.settings?.manualToken;
        const url = p?.settings?.serverUrl;
        if (url) {
          fetch(url + "/api/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: tok ? "Bearer " + tok : "" },
            body: JSON.stringify({}),
          }).catch(() => {});
        }
      `),
      { holdMs: 800 },
    ),

    // Run a real chat so the Task Center has activity to show during
    // the palette walk.
    beat("Ask the manual a question", fillChat(QUESTION), { holdMs: 400 }),
    beat("Send", clickSend(), { holdMs: 400 }),
    beat("Stream the cited answer", waitChatIdle(120_000), { holdMs: 800, speedup: 4 }),

    // First palette: model catalog.
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700 },
    ),
    beat("Filter to lilbee browse model", type_("lilbee browse model"), { holdMs: 1200 }),
    beat("Open the catalog", key("enter"), { holdMs: 1500 }),
    beat("Close the catalog", key("escape"), { holdMs: 700 }),

    // Second palette: crawl.
    beat(
      "Open the command palette again",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700 },
    ),
    beat("Filter to lilbee crawl", type_("lilbee crawl"), { holdMs: 1200 }),
    beat("Open the crawl modal", key("enter"), { holdMs: 1200 }),
    beat("Close the crawl modal", key("escape"), { holdMs: 700 }),

    // Third palette: task center, so the viewer can see what's in it.
    beat(
      "Open the command palette one more time",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700 },
    ),
    beat("Filter to task center", type_("lilbee task center"), { holdMs: 1200 }),
    beat("Open the task center", key("enter"), { holdMs: 1500 }),

    beat("Final hold on chat + task center", sleep(900)),
  ],
});
