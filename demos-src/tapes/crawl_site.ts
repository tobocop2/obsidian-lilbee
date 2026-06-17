/**
 * crawl_site demo: crawl a WHOLE site recursively (Full-size_car, depth 1),
 * watch the Task Center fill with hundreds of pages, then ask one multi-part
 * question that only makes sense because the whole site is indexed, answered by
 * Qwen3 8B with a reranker. Then click through to the citations.
 *
 * Environment this tape assumes (verify before recording):
 *  - Qwen3 8B installed natively (DEFAULT_MODEL) and warm.
 *  - bge-reranker-v2-m3 installed; pre-warmed via prewarmReranker.
 *  - The vault's lilbee/_web is cleared; the crawl populates it on camera.
 */
import {
  beat,
  clickSelector,
  clickSend,
  clickSourceFile,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  waitChatIdle,
} from "../src/lib.ts";

const URL = "https://en.wikipedia.org/wiki/Full-size_car";
const QUESTION =
  "What defines a full-size car, and what are a few notable examples from different manufacturers?";
const RERANKER = "gpustack/bge-reranker-v2-m3-GGUF/bge-reranker-v2-m3-Q4_K_M.gguf";
// Label of the bge entry in the rail's rerank menu (the model's catalog display name).
const RERANK_MENU_LABEL = "bge reranker v2 m3";
// Keep the crawl-output folders expanded in the file explorer while the crawl
// runs, so each newly written page streams into the left sidebar live.
const REVEAL_CRAWL_FOLDERS = `
  {
    const fe = window.app.workspace.getLeavesOfType('file-explorer')[0]?.view;
    const paths = ['lilbee', 'lilbee/_web', 'lilbee/_web/en.wikipedia.org', 'lilbee/_web/en.wikipedia.org/wiki'];
    for (const p of paths) {
      const item = fe?.fileItems?.[p];
      if (item && typeof item.setCollapsed === 'function') item.setCollapsed(false);
    }
  }
`;

export default storyboard("crawl_site", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  emptyIndex: true,
  clearTaskCenter: true,
  clearChat: true,
  preloadChatModel: true,
  prewarmReranker: RERANKER,
  caption: "Recorded on a 2021 M1 Pro, 32 GB RAM.",
  beats: [
    beat("Opening hold — empty vault, Qwen3 8B", sleep(1200), {
      caption: "Start with an empty vault. Crawl a whole site, then ask one question across all of it.",
    }),
    beat(
      "Open the crawl dialog",
      runJs(`window.app.commands.executeCommandById("lilbee:crawl");`),
      { holdMs: 900, caption: "Open the crawl dialog." },
    ),
    beat(
      "Paste the Full-size car URL",
      runJs(`
        const url = document.querySelector('input.lilbee-crawl-url');
        if (url) {
          const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          s.call(url, ${JSON.stringify(URL)});
          url.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `),
      { holdMs: 700 },
    ),
    // Depth 1 = the seed page plus everything it links to.
    beat(
      "Recursive on, depth 1 — crawl the whole site one link deep",
      runJs(`
        const cb = document.querySelector('input.lilbee-crawl-recursive-input');
        if (cb && !cb.checked) cb.click();
        const depth = document.querySelector('input.lilbee-crawl-depth');
        if (depth) {
          const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          s.call(depth, "1");
          depth.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `),
      { holdMs: 1300, caption: "Recursive on, depth 1: follow the links and crawl the whole site." },
    ),
    beat(
      "Click Crawl",
      runJs(`
        const btn = [...document.querySelectorAll('.modal-container button.mod-cta')].find(b => /crawl/i.test(b.textContent));
        if (btn) btn.click();
      `),
      { holdMs: 1200, caption: "Crawl the whole site." },
    ),
    // The whole-site crawl runs ~7 min. The recorder aborts any single beat
    // over 240s, so poll across several sub-240s beats (each returns early once
    // the Task Center drains). speedup compresses the fill in post.
    beat(
      "Crawling the whole site — the Task Center fills (1/4)",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        for (let i = 0; i < 400; i++) {
          ${REVEAL_CRAWL_FOLDERS}
          if (i > 6 && (tq.activeAll.length + tq.queued.length) === 0) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 200, speedup: 30, caption: "lilbee crawls and indexes the whole site — fast-forwarding." },
    ),
    beat(
      "Crawling the whole site (2/4)",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        for (let i = 0; i < 400; i++) {
          ${REVEAL_CRAWL_FOLDERS}
          if ((tq.activeAll.length + tq.queued.length) === 0) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 200, speedup: 30 },
    ),
    beat(
      "Crawling the whole site (3/4)",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        for (let i = 0; i < 400; i++) {
          ${REVEAL_CRAWL_FOLDERS}
          if ((tq.activeAll.length + tq.queued.length) === 0) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 200, speedup: 30 },
    ),
    beat(
      "Crawling the whole site (4/4) — done",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        for (let i = 0; i < 400; i++) {
          ${REVEAL_CRAWL_FOLDERS}
          if ((tq.activeAll.length + tq.queued.length) === 0) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 1200, speedup: 30, caption: "Hundreds of pages indexed." },
    ),
    beat("Activate the chat panel", runJs(`
      const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
      if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
      await new Promise(r => setTimeout(r, 300));
    `), { holdMs: 400 }),
    // Reranking matters over hundreds of pages: pull the best chunks from across
    // the site before the model answers. Turn it on via the rail's rerank picker
    // (the canonical path) so the chip updates and the answer reranks.
    beat("Open the rerank picker", clickSelector(".lilbee-rerank-model-select"), {
      holdMs: 700,
      caption: "Turn on the reranker so the answer pulls the best chunks from across the site.",
    }),
    beat("Choose bge-reranker-v2-m3", clickSelector(`.menu-item:has-text("${RERANK_MENU_LABEL}")`), {
      holdMs: 800,
    }),
    beat("Ask a multi-part question across the whole site", fillChat(QUESTION), { holdMs: 700, speedup: 2 }),
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
    beat("Send", clickSend(), {
      holdMs: 600,
      caption: "One question that only makes sense because the whole site is indexed.",
    }),
    // The 8B answer over a reranked, whole-site context streams for ~3 min in
    // real time; fast-forward it hard so the demo stays short, then hold on the
    // finished answer long enough to read.
    beat("Stream the cited answer (Qwen3 8B + reranker)", waitChatIdle(300_000), { holdMs: 2600, speedup: 20 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 800, caption: "The answer synthesizes across several crawled pages — each cited." },
    ),
    beat("Click through to a citation", clickSourceFile("Full-size_car"), { holdMs: 1000, cursorParkTo: [1245, 520] }),
    beat(
      "Render the cited page in reading mode",
      runJs(`
        const leaf = window.app.workspace.activeLeaf;
        if (leaf && leaf.view?.getViewType?.() === 'markdown') {
          const s = leaf.getViewState();
          s.state = { ...s.state, mode: 'preview' };
          await leaf.setViewState(s);
        }
        await new Promise(r => setTimeout(r, 500));
      `),
      { holdMs: 2600 },
    ),
    beat("Close the source", key("escape"), { holdMs: 500 }),
    beat("Click through to another citation", clickSourceFile("Executive_car"), { holdMs: 1000, cursorParkTo: [1245, 520] }),
    beat(
      "Render the second cited page",
      runJs(`
        const leaf = window.app.workspace.activeLeaf;
        if (leaf && leaf.view?.getViewType?.() === 'markdown') {
          const s = leaf.getViewState();
          s.state = { ...s.state, mode: 'preview' };
          await leaf.setViewState(s);
        }
        await new Promise(r => setTimeout(r, 500));
      `),
      { holdMs: 2600 },
    ),
    beat("Close the source", key("escape"), { holdMs: 500 }),
    beat(
      "Turn the reranker back off",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const base = p.api?.baseUrl ?? p.settings.serverUrl;
        const auth = { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
        await fetch(base + "/api/models/reranker", { method: "PUT", headers: auth, body: JSON.stringify({ model: "" }) });
      `),
      { holdMs: 200 },
    ),
  ],
});
