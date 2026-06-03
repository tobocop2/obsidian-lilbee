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
 * Chat runs on the Qwen3 4B served by LM Studio: large enough to use the context
 * faithfully (the 0.6B models answer inconsistently), small enough to stream
 * quickly. Query expansion is turned off for the run so retrieval is
 * deterministic and the rerank effect is the only thing that changes between the
 * two asks.
 *
 * Verified on the 8-note index this records against (top_k=3, max_context=3,
 * query_expansion=0): vector ranks the grounding note #4; rerank OFF cites the
 * three distractors and recommends a separate battery (wrong); rerank ON cites
 * the grounding note and answers "replace the big-three cables with 1/0 gauge".
 *
 * Requires the server pre-seeded with ONLY the 8 Crown Vic Build notes (the
 * other reels use the manual). The setup beats below pin top_k/context/expansion.
 */
import { beat, clickSelector, clickSend, fillChat, key, runJs, storyboard, waitChatIdle } from "../src/lib.ts";

const QUESTION =
  "At idle with the light bar and laptop running, the radio resets and the headlights dim. What is the fix on this build?";
const CHAT_MODEL = "lm_studio/qwen/qwen3-4b-2507";
const RERANK_MODEL = "gpustack/bge-reranker-v2-m3-GGUF/bge-reranker-v2-m3-Q4_K_M.gguf";

// PUT a model into a role via the server API the plugin already talks to.
const setRole = (role: "chat" | "reranker", model: string) =>
  runJs(`
    const p = window.app.plugins.plugins.lilbee;
    const base = p.api?.baseUrl ?? p.settings.serverUrl;
    const h = { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
    await fetch(base + "/api/models/${role}", { method: "PUT", headers: h, body: JSON.stringify({ model: ${JSON.stringify(model)} }) }).catch(() => {});
    if (typeof p.fetchActiveModel === "function") await p.fetchActiveModel();
  `);

// Pin retrieval so the rerank toggle is the only variable. top_k=3 is the value
// where the grounding note (vector rank #4) is excluded without reranking but
// promoted into the top-3 with it — the contrast is knife-edge, so the plugin's
// own topK setting (defaults to 2) must be pinned too, or the on-camera chat
// retrieves too few candidates for the reranker to surface the fix. Query
// expansion is off so the chat model can't rewrite the query and shift retrieval.
const pinRetrieval = runJs(`
  const p = window.app.plugins.plugins.lilbee;
  const base = p.api?.baseUrl ?? p.settings.serverUrl;
  const h = { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
  await fetch(base + "/api/config", { method: "PATCH", headers: h, body: JSON.stringify({ top_k: 3, max_context_sources: 3, query_expansion_count: 0, chat_mode: "search" }) }).catch(() => {});
  p.settings.topK = 3;
  if (typeof p.saveSettings === "function") await p.saveSettings();
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
  // The tape sets chat itself (first beat), so don't let pre-flight pin the
  // default chat model. The 8-note corpus is pre-seeded in the index; this tape
  // only reads it, so there's no freshIngest.
  skipModelPin: true,
  beats: [
    beat("Pin retrieval (fixed context, no query expansion)", pinRetrieval, { holdMs: 400 }),
    beat("Use Qwen3 4B for the chat answer", setRole("chat", CHAT_MODEL), { holdMs: 500 }),
    beat("Start with reranking OFF", setRole("reranker", ""), {
      holdMs: 800,
      caption: "Reranking off — search ranks notes by keyword overlap.",
    }),
    ...ask(
      "Ask with reranking OFF",
      "The note that holds the fix is worded around the cause, not the symptom, so it stays out of the top results — and the model confidently recommends the wrong fix.",
    ),
    // Clear the conversation so the second ask is an independent before/after.
    beat("Clear the chat", clickSelector(".lilbee-chat-clear"), { holdMs: 700 }),
    // Turn reranking ON via the rail pill (visible), then make sure it's set.
    beat("Open the Rerank picker", clickSelector(".lilbee-rerank-model-select"), {
      holdMs: 800,
      caption: "Turn reranking on — a cross-encoder re-scores the candidates by true relevance.",
    }),
    beat("Highlight the reranker", key("down"), { holdMs: 500 }),
    beat("Choose it", key("enter"), { holdMs: 900 }),
    beat("Ensure the reranker is active", setRole("reranker", RERANK_MODEL), { holdMs: 700 }),
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
    ...ask(
      "Ask again with reranking ON",
      "Now the grounding note is promoted into context — and the answer gives the correct fix: upgrade the 'big three' cables to 1/0 gauge.",
    ),
  ],
});
