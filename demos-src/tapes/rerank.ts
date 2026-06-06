/**
 * rerank demo: before/after reranking on the SAME question, so it's obvious what
 * reranking does.
 *
 * Corpus = the eight "Crown Vic Build" electrical notes. The question describes
 * a symptom (at idle, with the light bar and laptop running, the radio resets
 * and the headlights dim). The note that actually holds the fix — "Grounding and
 * the big three" — is written around the cause (voltage sag, charge cabling,
 * 1/0 gauge), not the question's component keywords, so it stays out of the
 * top-3 context window. The keyword-matching notes sit on top.
 *
 * Reranking OFF: the model only sees the keyword matches and confidently
 * recommends the WRONG fix (fuse / power-delivery tweaks). Reranking ON
 * (bge-reranker-v2-m3): the cross-encoder re-scores by true relevance and
 * promotes the grounding note into the top-3, so the answer gives the correct
 * fix — upgrade the "big three" cables to 1/0 gauge.
 *
 * Both roles are native here — Qwen3 8B for chat and bge-reranker-v2-m3 for
 * reranking — so the rail shows one consistent, lilbee-managed setup. Query
 * expansion is off so retrieval is deterministic and the rerank toggle is the
 * only thing that changes between the two asks. The reranker is pre-warmed in
 * pre-flight (prewarmReranker) so the on-camera "turn it on" ask reranks
 * immediately instead of freezing on a cold cross-encoder load.
 *
 * Verified on the managed server against the 8-note index this records (top_k=3,
 * max_context=3, query_expansion=0), 3/3 deterministic each way: rerank OFF the
 * context is [Laptop dock, Aux fuse, Light bar] and the answer blames the fuse /
 * power delivery (wrong); rerank ON the cross-encoder promotes the grounding note
 * into [Laptop dock, Grounding, Light bar] and the answer gives the correct fix —
 * the "big three" cable upgrade to 1/0 gauge.
 *
 * Requires the server pre-seeded with ONLY the 8 Crown Vic Build notes (the
 * other reels use the manual). The setup beat below pins top_k/context/expansion.
 */
import { beat, clickSelector, clickSourceFile, clickSend, fillChat, key, runJs, storyboard, waitChatIdle } from "../src/lib.ts";

const QUESTION =
  "Everything's installed correctly but the radio still resets and lights dim at idle. What's left to fix?";
const RERANK_MODEL = "gpustack/bge-reranker-v2-m3-GGUF/bge-reranker-v2-m3-Q4_K_M.gguf";
// Label of the bge entry in the rail's rerank menu (the model's catalog display name).
const RERANK_MENU_LABEL = "bge reranker v2 m3";

// Pin retrieval so the rerank toggle is the only variable. top_k=3 sizes the
// candidate pool so the chat path's context selection (greedy term-coverage over
// max_context=3) leaves the cause-worded grounding note out without reranking,
// while the cross-encoder reorders the pool so it gets selected in — the contrast
// is knife-edge, so the plugin's own topK setting (defaults to 2) must be pinned
// too. Query expansion is off so the chat model can't rewrite the query. Ensure
// the reranker starts OFF (pre-flight pre-warmed it, then disabled it) and refresh
// the rail so the Rerank chip reads "(disabled)" for the OFF ask.
const pinRetrievalRerankOff = runJs(`
  const p = window.app.plugins.plugins.lilbee;
  const base = p.api?.baseUrl ?? p.settings.serverUrl;
  const h = { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
  await fetch(base + "/api/config", { method: "PATCH", headers: h, body: JSON.stringify({ top_k: 8, max_context_sources: 3, query_expansion_count: 0, chat_mode: "search" }) }).catch(() => {});
  await fetch(base + "/api/models/reranker", { method: "PUT", headers: h, body: JSON.stringify({ model: "" }) }).catch(() => {});
  p.settings.topK = 8;
  if (typeof p.saveSettings === "function") await p.saveSettings();
  const view = window.app.workspace.getLeavesOfType("lilbee-chat")[0]?.view;
  if (view && typeof view.fetchAndFillSelectors === "function") view.fetchAndFillSelectors();
  await new Promise(r => setTimeout(r, 400));
`);

// Send the question, then wait for the answer to finish streaming. speedup 4
// fast-forwards the stream while the final answer holds long enough to read.
const ask = (label: string, caption: string) => [
  beat("Type the question", fillChat(QUESTION), { holdMs: 700 }),
  beat(label, clickSend(), { holdMs: 800, caption }),
  beat("Stream the answer", waitChatIdle(180_000), { holdMs: 2200, speedup: 4 }),
];

export default storyboard("rerank", {
  window: [1400, 900],
  layout: "file-explorer-and-chat",
  clearChat: true,
  // All-native: preflight pins and preloads Qwen3 8B for chat (so the on-camera
  // answers stream warm), and pre-warms the native bge reranker so the on-camera
  // toggle reranks immediately. The 8-note corpus is pre-seeded in the index;
  // this tape only reads it, so there's no freshIngest.
  pinChatModel: "Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf",
  preloadChatModel: true,
  prewarmReranker: RERANK_MODEL,
  // The chat fills the pane full-height here, so the default bottom-centre
  // caption lands on the answer. Drop it onto the (empty) input strip below the
  // answer so the narration never covers the cited text.
  captionMarginPx: 40,
  beats: [
    beat("Pin retrieval and start with reranking OFF", pinRetrievalRerankOff, {
      holdMs: 1000,
      caption: "Reranking off — search ranks notes by keyword overlap.",
    }),
    ...ask(
      "Ask with reranking OFF",
      "The note that holds the fix is worded around the cause, not the symptom, so it stays out of the top results — and the model confidently recommends the wrong fix.",
    ),
    // Leave the OFF answer on screen — turning reranking on and re-asking shows
    // the before/after in one conversation. Reset only the conversation HISTORY
    // (not the visible bubbles) so the second answer reflects the rerank effect,
    // not the model anchoring on its own prior (wrong) reply.
    beat(
      "Keep the before answer; re-ask fresh",
      runJs(`
        const leaf = window.app.workspace.getLeavesOfType('lilbee-chat')[0];
        if (leaf && leaf.view) leaf.view.history = [];
      `),
      { holdMs: 200 },
    ),
    // Open the rail's rerank picker on camera — an in-window Obsidian menu, so it
    // records (unlike a native <select> popup). The cursor moves to the chip and
    // the menu drops open beneath it.
    beat("Open the rerank picker", clickSelector(".lilbee-rerank-model-select"), {
      holdMs: 700,
      caption: "Turn reranking on — open the rail's rerank picker.",
    }),
    // Pick bge from the menu. The plugin activates it server-side and updates the
    // chip; pre-flight already warmed the cross-encoder, so the next ask reranks.
    beat("Choose bge-reranker-v2-m3", clickSelector(`.menu-item:has-text("${RERANK_MENU_LABEL}")`), {
      holdMs: 700,
      caption: "Pick the cross-encoder — it re-scores the candidates by true relevance.",
    }),
    ...ask(
      "Ask again with reranking ON",
      "Now the grounding note is promoted into context — and the answer gives the correct fix: upgrade the 'big three' cables to 1/0 gauge.",
    ),
    // Expand the cited sources and open the grounding note the reranker pulled
    // in — proof the answer is grounded in the note reranking surfaced.
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 700, caption: "The cited source is the note reranking pulled into context — open it." },
    ),
    beat("Open the cited grounding note", clickSourceFile("Grounding"), { holdMs: 4500 }),
    beat("Close source preview", key("escape"), { holdMs: 600 }),
  ],
});
