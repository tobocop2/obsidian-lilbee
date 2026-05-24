/**
 * download_model demo: pull a model from the catalog, start to finish.
 *
 * Open the catalog, search for a small chat model that isn't installed
 * (SmolLM2 360M — a ~0.3GB model that downloads in well under a minute),
 * confirm the download, then close the catalog and watch the Task Center
 * stream the download from start to completion. The catalog pull
 * downloads without changing the active model, so the status bar stays
 * on Qwen3 8B throughout — no disruption.
 *
 * freshModel uninstalls the model in pre-flight so the pull is a real
 * download on every take (models_dir is shared across vaults).
 */
import { beat, clickSelector, key, runJs, sleep, storyboard, type_, waitForSelector } from "../src/lib.ts";

const MODEL_QUERY = "SmolLM2 360M";
// bartowski's SmolLM2 360M is the canonical, well-formed GGUF. Other repos
// for this model (e.g. prithivMLmods) ship a file whose name has a stray
// space that the server rejects after the download finishes, so target this
// repo explicitly rather than trusting the top search result.
const MODEL_REPO = "bartowski/SmolLM2-360M-Instruct-GGUF";
// Each card carries data-repo = hf_repo, so wait on and click the exact
// card we want. The pull button lives inside that card.
const MODEL_CARD = `.lilbee-model-card[data-repo="${MODEL_REPO}"]`;
const MODEL_PULL = `${MODEL_CARD} .lilbee-catalog-pull`;

export default storyboard("download_model", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  // Clear the Task Center so the download is the one clear new activity.
  clearTaskCenter: true,
  preloadChatModel: false,
  freshModel: MODEL_REPO,
  caption: "Recorded on a 2021 M1 Pro, 32 GB RAM.",
  beats: [
    beat("Opening hold", sleep(300)),
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 500, keyHint: "⌘P" },
    ),
    beat("Filter to the catalog command", type_("Browse model catalog"), { holdMs: 1000 }),
    beat("Open the catalog", key("enter"), { holdMs: 1000 }),

    // Search for the model by name so the viewer sees how you find one.
    beat("Click the catalog search", clickSelector("input.lilbee-catalog-search"), { holdMs: 400 }),
    beat("Search for the model", type_(MODEL_QUERY), { holdMs: 1400 }),
    // The search hits Hugging Face and takes a moment; wait for the exact
    // bartowski card to render before clicking, so the click lands on the
    // repo we uninstalled in pre-flight and not whatever rendered first.
    beat("Wait for the search results", waitForSelector(MODEL_CARD), { holdMs: 800 }),

    // Pull -> confirm. Clicking the pull button inside the bartowski card
    // opens the confirm modal showing the download size and RAM needed.
    beat("Click Download on the model card", clickSelector(MODEL_PULL), { holdMs: 1200 }),
    beat(
      "Confirm the download",
      clickSelector(".lilbee-confirm-pull-actions button.mod-cta"),
      { holdMs: 1000 },
    ),
    // Close the catalog so the Task Center download progress is in view.
    beat("Close the catalog", key("escape"), { holdMs: 800 }),

    // Watch the download stream in the Task Center, then settle.
    beat(
      "Download streams in the Task Center",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        let sawActive = false;
        for (let i = 0; i < 600; i++) {
          const busy = tq.activeAll.length + tq.queued.length;
          if (busy > 0) sawActive = true;
          if (sawActive && busy === 0) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      // SmolLM2 360M is ~0.3GB and pulls in well under a minute; the 6x
      // speedup keeps the progress bar lively without dead air.
      { holdMs: 1200, speedup: 6, maxMs: 300_000 },
    ),
    beat("Final hold on the completed download", sleep(2200)),
  ],
});
