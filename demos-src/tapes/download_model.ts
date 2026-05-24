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
// The catalog renders prithivMLmods's SmolLM2 360M as the first result;
// match freshModel to it so the pull is a real download on every take.
const MODEL_REPO = "prithivMLmods/SmolLM2-360M-GGUF";
// Wait on the SmolLM2 card name (Playwright handles :text-is) so the
// search results have actually rendered before we click. Once they have,
// the first .lilbee-catalog-pull is the top result — bartowski's SmolLM2
// 360M, which matches MODEL_REPO.
const MODEL_CARD_NAME = '.lilbee-model-card-name:text-is("SmolLM2 360M")';

export default storyboard("download_model", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  // Clear the Task Center so the download is the one clear new activity.
  clearTaskCenter: true,
  preloadChatModel: false,
  freshModel: MODEL_REPO,
  caption: "Recorded on a 2021 M1 Pro, 32 GB RAM.",
  beats: [
    beat("Opening hold", sleep(700)),
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 500 },
    ),
    beat("Filter to the catalog command", type_("Browse model catalog"), { holdMs: 1000 }),
    beat("Open the catalog", key("enter"), { holdMs: 1000 }),

    // Search for the model by name so the viewer sees how you find one.
    beat("Click the catalog search", clickSelector("input.lilbee-catalog-search"), { holdMs: 400 }),
    beat("Search for the model", type_(MODEL_QUERY), { holdMs: 1400 }),
    // The search hits Hugging Face and takes a moment; wait for the
    // SmolLM2 card to actually render before clicking, otherwise the
    // click lands on whatever card was on screen first.
    beat("Wait for the search results", waitForSelector(MODEL_CARD_NAME), { holdMs: 800 }),

    // Pull -> confirm. With the SmolLM2 results rendered, the first pull
    // button is the top result (bartowski's SmolLM2 360M). The confirm
    // modal shows the download size and the RAM the model needs.
    beat("Click Download on the model card", clickSelector(".lilbee-catalog-pull"), { holdMs: 1200 }),
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
      // A real ~1.2GB pull can take several minutes; let it run past the
      // default 240s guard since the progress bar keeps the screen alive.
      { holdMs: 1200, speedup: 6, maxMs: 900_000 },
    ),
    beat("Final hold on the completed download", sleep(2200)),
  ],
});
