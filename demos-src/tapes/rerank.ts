/**
 * rerank demo: before/after reranking on the SAME question, so it's obvious what
 * reranking does.
 *
 * Corpus = the eight "Crown Vic Build" electrical notes. The question describes
 * a symptom (at idle, with the light bar and laptop running, the radio resets
 * and the headlights dim). The note that actually holds the fix — "Grounding and
 * the big three" — is written around the cause (voltage sag, charge cabling,
 * 1/0 gauge), not the question's component keywords, so plain vector search
 * ranks it #4, outside the top-3 context window. The keyword-matching notes
 * (Laptop dock and radio, Light bar install) sit on top.
 *
 * Reranking OFF: the model only sees the keyword matches and confidently
 * recommends the WRONG fix (add a separate battery / bypass the fuse block).
 * Reranking ON (bge-reranker-v2-m3): the cross-encoder re-scores by true
 * relevance and promotes the grounding note into the top-3, so the answer gives
 * the correct fix — upgrade the "big three" cables to 1/0 gauge.
 *
 * Both roles are native here — Qwen3 8B for chat and bge-reranker-v2-m3 for
 * reranking — so the rail shows one consistent, lilbee-managed setup. Query
 * expansion is off so retrieval is deterministic and the rerank toggle is the
 * only thing that changes between the two asks.
 *
 * Verified on the 8-note index this records against (top_k=3, max_context=3,
 * query_expansion=0): vector ranks the grounding note #4; rerank OFF cites the
 * three distractors and recommends a separate battery (wrong); rerank ON cites
 * the grounding note and answers "replace the big-three cables with 1/0 gauge".
 *
 * Requires the server pre-seeded with ONLY the 8 Crown Vic Build notes (the
 * other reels use the manual). The setup beats below pin top_k/context/expansion.
 */
import { beat, clickSend, fillChat, runJs, storyboard, waitChatIdle } from "../src/lib.ts";

const QUESTION =
  "At idle with the light bar and laptop running, the radio resets and the headlights dim. What is the fix on this build?";
const RERANK_MODEL = "gpustack/bge-reranker-v2-m3-GGUF/bge-reranker-v2-m3-Q4_K_M.gguf";

// PUT the reranker role via the server API the plugin already talks to.
const setReranker = (model: string) =>
  runJs(`
    const p = window.app.plugins.plugins.lilbee;
    const base = p.api?.baseUrl ?? p.settings.serverUrl;
    const h = { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
    await fetch(base + "/api/models/reranker", { method: "PUT", headers: h, body: JSON.stringify({ model: ${JSON.stringify(model)} }) }).catch(() => {});
  `);

// Pin retrieval so the rerank toggle is the only variable. top_k=3 is the value
// where the grounding note (vector rank #4) is excluded without reranking but
// promoted into the top-3 with it — the contrast is knife-edge, so the plugin's
// own topK setting (defaults to 2) must be pinned too, or the on-camera chat
// retrieves too few candidates for the reranker to surface the fix. Query
// expansion is off so the chat model can't rewrite the query and shift retrieval.
// Also force the Rerank pill to "(disabled)" so the OFF ask visibly has no
// reranker — fetchActiveModel only refreshes the Chat pill, so without this the
// rail keeps showing a previously-selected reranker.
const pinRetrievalAndDisableRerank = runJs(`
  const p = window.app.plugins.plugins.lilbee;
  const base = p.api?.baseUrl ?? p.settings.serverUrl;
  const h = { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
  await fetch(base + "/api/config", { method: "PATCH", headers: h, body: JSON.stringify({ top_k: 3, max_context_sources: 3, query_expansion_count: 0, chat_mode: "search" }) }).catch(() => {});
  p.settings.topK = 3;
  if (typeof p.saveSettings === "function") await p.saveSettings();
  const sel = document.querySelector(".lilbee-rerank-model-select");
  if (sel) { sel.selectedIndex = 0; sel.dispatchEvent(new Event("change", { bubbles: true })); }
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
  // answers stream warm), and the reranker is native bge. The 8-note corpus is
  // pre-seeded in the index; this tape only reads it, so there's no freshIngest.
  pinChatModel: "Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf",
  preloadChatModel: true,
  beats: [
    beat("Pin retrieval and start with reranking OFF", pinRetrievalAndDisableRerank, {
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
    // Turn reranking on by flipping the rail pill directly. A native <select>
    // opens an OS popup the window capture can't see, so click-then-arrow-keys
    // reads as the cursor sitting on the pill doing nothing; setting the value +
    // change updates the visible pill instantly and fires the plugin's handler.
    beat(
      "Turn reranking on",
      runJs(`
        const sel = document.querySelector(".lilbee-rerank-model-select");
        if (sel) {
          const o = [...sel.options].find(o => /bge/i.test(o.text));
          if (o) { sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); }
        }
      `),
      {
        holdMs: 900,
        caption: "Turn reranking on — a cross-encoder re-scores the candidates by true relevance.",
      },
    ),
    beat("Ensure the reranker is active", setReranker(RERANK_MODEL), { holdMs: 700 }),
    // The first rerank call loads the cross-encoder; that cold call skips the
    // rerank pass, so warm it with a hidden throwaway query before the visible
    // ask. Without this the on-camera answer runs against an un-reranked context.
    beat(
      "Warm the reranker",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const base = p.api?.baseUrl ?? p.settings.serverUrl;
        const h = { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
        await fetch(base + "/api/chat", { method: "POST", headers: h, body: JSON.stringify({ question: ${JSON.stringify(QUESTION)}, history: [], top_k: 3 }) }).catch(() => {});
      `),
      { holdMs: 300, maxMs: 120_000 },
    ),
    // The rerank toggle re-renders the rail and can leave the chat pill on a
    // stale value. Pin both pills' DISPLAY directly (no change event, so no
    // re-render): chat = Qwen3 8B, rerank = bge — matching the active models.
    beat(
      "Pin the rail pills' display",
      runJs(`
        const chat = document.querySelector(".lilbee-chat-model-select");
        if (chat) { const o = [...chat.options].find(o => /qwen/i.test(o.text) && /\b8b\b/i.test(o.text) && !/coder|30b|4b/i.test(o.text)); if (o) chat.value = o.value; }
        const rer = document.querySelector(".lilbee-rerank-model-select");
        if (rer) { const o = [...rer.options].find(o => /bge/i.test(o.text)); if (o) rer.value = o.value; }
      `),
      { holdMs: 400 },
    ),
    ...ask(
      "Ask again with reranking ON",
      "Now the grounding note is promoted into context — and the answer gives the correct fix: upgrade the 'big three' cables to 1/0 gauge.",
    ),
  ],
});
