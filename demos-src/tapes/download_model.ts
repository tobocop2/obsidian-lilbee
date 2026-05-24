/**
 * download_model demo: pull a model from the catalog, start to finish.
 *
 * Open the catalog, search for a small chat model that isn't installed
 * (Llama 3.2 1B), confirm the download, then close the catalog and watch
 * the Task Center stream the download to completion. A real pull
 * auto-activates the model, so the status bar flips to it at the end —
 * the model goes from "in the catalog" to "downloaded and active".
 *
 * freshModel uninstalls the model in pre-flight so the pull is a real
 * download on every take (models_dir is shared across vaults). A chat
 * model is safe to auto-activate; only embedding-model pulls would swap
 * the embedder out from under the corpus.
 */
import { beat, clickSelector, key, runJs, sleep, storyboard, type_ } from "../src/lib.ts";

const MODEL_QUERY = "Llama 3.2 1B";
const MODEL_REPO = "hugging-quants/Llama-3.2-1B-Instruct-Q8_0-GGUF";

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

    // Pull -> confirm. The confirm modal shows the download size and the
    // RAM the model needs before anything is fetched.
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
      { holdMs: 1200, speedup: 6 },
    ),
    // The pull auto-activates the model; refresh the status bar so it
    // reflects the newly downloaded, now-active model.
    beat(
      "Refresh the active model in the status bar",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        if (typeof p.fetchActiveModel === "function") await p.fetchActiveModel();
      `),
      { holdMs: 600 },
    ),
    beat("Final hold on the completed download", sleep(2000)),
  ],
});
