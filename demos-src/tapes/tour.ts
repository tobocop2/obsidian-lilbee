/**
 * command_palette demo: the palette is the async control surface for lilbee.
 *
 * Fire three long-running jobs back to back, each through the visible palette
 * flow, without waiting for any of them to finish:
 *
 *   1. Add the open file         (Add current file)
 *   2. Crawl a web page          (Crawl web page + URL)
 *   3. Download a model          (Browse model catalog + pull featured Qwen3 0.6B)
 *
 * Add fires first so its task is enqueued before the crawl's sync covers the
 * same vault file and turns the add into a server-side no-op.
 *
 * The Task Center then shows all three running at once — a crawl, an ingest,
 * and a download in parallel — which is the point: the GUI never blocks. Once
 * the crawl and ingest settle, ask the just-crawled page a question for a
 * cited answer while the download keeps running behind the chat.
 *
 * Recorded with the browser cache wiped, so the crawl's first-run Chromium
 * setup is one of the visible Task Center jobs.
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
  waitForSelector,
} from "../src/lib.ts";

const CRAWL_URL = "https://en.wikipedia.org/wiki/Knowledge_graph";
const ADD_FILE = "Notes/Crown Vic upgrade log.md";
const QUESTION = "What is a knowledge graph?";

// Featured pick on the catalog's opening screen — no search needed.
const MODEL_REPO = "Qwen/Qwen3-0.6B-GGUF";
const MODEL_CARD = `.lilbee-model-card[data-repo="${MODEL_REPO}"]`;

const palette = (label: string, query: string, holdAfter = 1000) => [
  beat(
    `Open the command palette (${label})`,
    runJs(`window.app.commands.executeCommandById("command-palette:open");`),
    { holdMs: 500, keyHint: "⌘P" },
  ),
  beat(`Type "${query}"`, type_(query), { holdMs: 1000 }),
  beat(`Run ${label}`, key("enter"), { holdMs: holdAfter }),
];

export default storyboard("tour", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  preloadChatModel: true,
  clearTaskCenter: true,
  clearChat: true,
  // Drop the crawled page and the add target so both are real jobs, and
  // remove the model so the pull is a real download.
  freshIngest: ["index.md", "Crown Vic upgrade log.md"],
  freshModel: MODEL_REPO,
  beats: [
    beat("Opening hold on the chat + Task Center", sleep(300)),

    // Open the file we'll add, beside the chat (never over the Task Center).
    beat(
      "Open a note to add, beside the chat",
      runJs(`
        const app = window.app;
        const chatLeaf = app.workspace.getLeavesOfType('lilbee-chat')[0];
        if (chatLeaf) app.workspace.setActiveLeaf(chatLeaf, { focus: true });
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(ADD_FILE)});
        const leaf = app.workspace.getLeaf('tab');
        if (file) await leaf.openFile(file);
        await new Promise(r => setTimeout(r, 250));
      `),
      { holdMs: 700 },
    ),

    // --- Job 1: add the open file ---
    ...palette("Add current file", "Add current file", 900),

    // --- Job 2: crawl a web page, without waiting for the add ---
    ...palette("Crawl web page", "Crawl web page", 900),
    beat(
      "Paste the URL into the crawl modal",
      runJs(`
        const input = document.querySelector('input.lilbee-crawl-url');
        if (input) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(CRAWL_URL)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `),
      { holdMs: 900 },
    ),
    beat("Click Crawl", clickSelector('.modal-container button.mod-cta:has-text("Crawl")'), { holdMs: 1000 }),

    // --- Job 3: download a model, again without waiting ---
    ...palette("Browse model catalog", "Browse model catalog", 1000),
    beat("Wait for the featured picks", waitForSelector(MODEL_CARD), { holdMs: 800 }),
    beat("Click Download on the featured card", clickSelector(`${MODEL_CARD} .lilbee-catalog-pull`), { holdMs: 1000 }),
    beat("Confirm the download", clickSelector(".lilbee-confirm-pull-actions button.mod-cta"), { holdMs: 900 }),
    beat("Close the catalog so the Task Center is in view", key("escape"), { holdMs: 1000 }),

    // The money shot: an ingest, a crawl, and a download all running at once.
    // Wait only for what the chat needs — the crawled page searchable and the
    // non-pull jobs idle for a few polls. No first-seen-activity guard: on a
    // fast network the jobs can finish before this beat starts, and the beat
    // must then move straight on. Hard cap keeps a pathological wait off the
    // reel. The download keeps running while we chat, which is the point.
    beat(
      "Three jobs run in parallel in the Task Center",
      runJs(`
        const plugin = window.app.plugins.plugins.lilbee;
        const tq = plugin.taskQueue;
        const busyNonPull = () =>
          [...tq.activeAll, ...tq.queued].filter(t => t.type !== 'pull').length;
        const crawledIngested = async () => {
          try {
            const res = await plugin.api.listDocuments('Knowledge_graph');
            return (res.documents ?? []).length > 0;
          } catch { return false; }
        };
        let quiet = 0;
        for (let i = 0; i < 240; i++) {
          quiet = busyNonPull() > 0 ? 0 : quiet + 1;
          if (quiet >= 4 && await crawledIngested()) break;
          await new Promise(r => setTimeout(r, 500));
        }
        // On a fast network the pull wins the race and its auto-activate
        // switches the chat model; restore the daily-driver pick so the chat
        // scene matches the opening rail. Happens inside the 10x window.
        const pullBusy = [...tq.activeAll, ...tq.queued].some(t => t.type === 'pull');
        const daily = 'Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf';
        if (!pullBusy && plugin.activeModel !== daily) {
          await plugin.api.setChatModel(daily);
          await plugin.fetchActiveModel();
          plugin.refreshOpenChatRails();
          await new Promise(r => setTimeout(r, 400));
        }
      `),
      { holdMs: 1600, speedup: 10, maxMs: 600_000 },
    ),

    // Now use the page the crawl just fetched: a cited answer.
    beat(
      "Activate a clean chat panel",
      runJs(`
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 300));
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta) ta.focus();
      `),
      { holdMs: 500 },
    ),
    beat("Ask about the knowledge graph", fillChat(QUESTION), { holdMs: 600 }),
    beat(
      "Ensure the question is in the box",
      runJs(`
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta && !ta.value.trim()) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, ${JSON.stringify(QUESTION)});
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `),
      { holdMs: 300 },
    ),
    beat("Send", clickSend(), { holdMs: 600 }),
    beat(
      "Cited answer from the just-crawled page",
      runJs(`
        const send = document.querySelector('.lilbee-chat-send');
        for (let i = 0; i < 240; i++) {
          const t = (send?.textContent || '').toLowerCase();
          if (t.includes('send') && i > 4) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 1400, speedup: 4, maxMs: 180_000 },
    ),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 1800 },
    ),
  ],
});
