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
import {
  beat,
  clickSelector,
  clickSend,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  type_,
  waitChatIdle,
  waitForSelector,
} from "../src/lib.ts";

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
      // SmolLM2 360M is ~0.3GB; speed the download segment up hard so the
      // demo spends its time on the end-to-end payoff (downloading + chatting)
      // rather than on a progress bar.
      { holdMs: 800, speedup: 20, maxMs: 300_000 },
    ),

    // End-to-end: now actually use the model we just downloaded. Activate it
    // as the chat model, switch the panel to Chat mode (pure-LLM, no
    // retrieval), and ask it something a small instruct model handles well.
    beat(
      "Activate the new model",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const base = p.api?.baseUrl ?? p.settings.serverUrl;
        const h = { Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
        const inst = await fetch(base + "/api/models/installed?task=chat", { headers: h }).then(r => r.json()).catch(() => ({ models: [] }));
        const smol = (inst.models || []).map(m => m.name).find(n => /SmolLM2-360M/i.test(n));
        if (smol) {
          await fetch(base + "/api/models/chat", { method: "PUT", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ model: smol }) }).catch(() => {});
          if (typeof p.fetchActiveModel === "function") await p.fetchActiveModel();
        }
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        for (const leaf of leaves) {
          window.app.workspace.revealLeaf(leaf);
          if (leaf.view?.fetchAndFillSelectors) await leaf.view.fetchAndFillSelectors();
        }
        await new Promise(r => setTimeout(r, 300));
      `),
      { holdMs: 1000 },
    ),
    // Switch to Chat mode (pure-LLM, no retrieval) with a real click on the
    // toggle so the viewer sees it — otherwise the question retrieves the car
    // manual instead of answering directly.
    beat(
      "Click Chat mode in the toggle",
      clickSelector('.lilbee-chat-mode-btn:text-is("Chat")'),
      { holdMs: 1000 },
    ),
    beat("Ask the new model what it can do", fillChat("What can you do?"), { holdMs: 600 }),
    beat(
      "Ensure the question is in the box",
      runJs(`
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta && !ta.value.trim()) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, "What can you do?");
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `),
      { holdMs: 300 },
    ),
    beat("Send", clickSend(), { holdMs: 600 }),
    beat("Stream SmolLM2's answer", waitChatIdle(120_000), { holdMs: 1600, speedup: 3 }),
    beat("Final hold on the answer", sleep(2400)),
  ],
});
