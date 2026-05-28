/**
 * rerank demo: before/after reranking on the SAME question, so it's obvious what
 * reranking does.
 *
 * The vault's Garage/ notes contain one passage that actually answers
 * "how do I turn off the daytime running lights" (it's worded around the parking
 * brake, not the query's keywords) plus ten keyword-heavy distractors. Plain
 * vector search ranks the real answer ~#12 — below the context window — so with
 * reranking OFF the model misses it. Turning reranking ON (bge-reranker-v2-m3)
 * promotes the genuinely-relevant passage into context and the answer becomes
 * correct.
 *
 * Chat runs on Llama 3.2 1B, which co-fits with the reranker worker in RAM
 * (phi-4 / phi-4-mini OOM when the reranker is also resident).
 *
 * Empirically verified: embedding rank of the answer = 12/14; rerank OFF excludes
 * it from the cited context, rerank ON includes it.
 */
import { beat, clickSelector, clickSend, fillChat, key, runJs, storyboard } from "../src/lib.ts";

const QUESTION = "How do I turn off the daytime running lights on my Crown Victoria?";
const CHAT_MODEL = "hugging-quants/Llama-3.2-1B-Instruct-Q8_0-GGUF/llama-3.2-1b-instruct-q8_0.gguf";
const RERANK_MODEL = "gpustack/bge-reranker-v2-m3-GGUF/bge-reranker-v2-m3-Q4_K_M.gguf";

const GARAGE = [
  "Garage/Crown Vic - front lamp tricks.md",
  "Garage/Crown Vic - DRL safety.md",
  "Garage/Crown Vic - DRL canada.md",
  "Garage/Crown Vic - DRL wiring.md",
  "Garage/Crown Vic - DRL fog.md",
  "Garage/Crown Vic - DRL vs headlamps.md",
  "Garage/Crown Vic - DRL brightness.md",
  "Garage/Crown Vic - DRL history.md",
  "Garage/Crown Vic - DRL battery.md",
  "Garage/Crown Vic - DRL police.md",
  "Garage/Crown Vic - DRL inspection.md",
];

// PUT a model into a role via the server API the plugin already talks to.
const setRole = (role: "chat" | "reranker", model: string) =>
  runJs(`
    const p = window.app.plugins.plugins.lilbee;
    const base = p.api?.baseUrl ?? p.settings.serverUrl;
    const h = { "Content-Type": "application/json", Authorization: "Bearer " + (p.api?.token ?? p.settings.manualToken ?? "") };
    await fetch(base + "/api/models/${role}", { method: "PUT", headers: h, body: JSON.stringify({ model: ${JSON.stringify(model)} }) }).catch(() => {});
    if (typeof p.fetchActiveModel === "function") await p.fetchActiveModel();
  `);

// Send the question, then wait for the answer to finish streaming (Send button
// flips Stop → Send when done).
const ask = (label: string, caption: string) => [
  beat("Type the question", fillChat(QUESTION), { holdMs: 700 }),
  beat(label, clickSend(), { holdMs: 800, caption }),
  beat(
    "Wait for the answer",
    runJs(`
      const send = document.querySelector('.lilbee-chat-send');
      for (let i = 0; i < 240; i++) {
        const t = (send?.textContent || '').toLowerCase();
        if (t.includes('send') && i > 4) return;
        await new Promise(r => setTimeout(r, 500));
      }
    `),
    { holdMs: 3000, speedup: 3, maxMs: 150_000 },
  ),
];

export default storyboard("rerank", {
  window: [1400, 900],
  layout: "file-explorer-and-chat",
  clearChat: true,
  freshIngest: GARAGE,
  beats: [
    beat("Use Llama 3.2 1B (co-fits with the reranker)", setRole("chat", CHAT_MODEL), { holdMs: 500 }),
    beat("Start with reranking OFF", setRole("reranker", ""), {
      holdMs: 800,
      caption: "Reranking off — plain vector search.",
    }),
    ...ask(
      "Ask with reranking OFF",
      "Without reranking, search returns keyword matches and the real procedure stays buried — the answer misses it.",
    ),
    // Turn reranking ON via the rail pill (visible), then make sure it's set.
    beat("Open the Rerank picker", clickSelector(".lilbee-rerank-model-select"), {
      holdMs: 800,
      caption: "Turn reranking on from the Rerank pill.",
    }),
    beat("Highlight the reranker", key("down"), { holdMs: 500 }),
    beat("Choose it", key("enter"), { holdMs: 900 }),
    beat("Ensure the reranker is active", setRole("reranker", RERANK_MODEL), { holdMs: 700 }),
    ...ask(
      "Ask again with reranking ON",
      "With reranking on, the cross-encoder promotes the passage that truly answers — now the parking-brake procedure is cited.",
    ),
  ],
});
