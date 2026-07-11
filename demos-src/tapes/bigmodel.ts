/**
 * bigmodel: chatting with a 235B model split across three A100s, the codebase
 * already indexed. Opens straight on chat beside the live GPU placement matrix
 * (no navigation), asks one grounded question, and streams a cited answer while
 * the bars light up across all three cards. The citation opens the real source.
 * No ingest — the corpus is embedded before the reel starts.
 *
 * chat_mode=search + a code-only index so the citation lands on real code.
 */
import {
  beat,
  clickSelector,
  clickSend,
  fillChat,
  runJs,
  storyboard,
  waitChatIdle,
  waitForSelector,
  WAIT_PREVIEW_TEXT_JS,
} from "../src/lib.ts";

const QUESTION =
  "How does lilbee decide which GPUs each model runs on? Answer in 3 short bullet points.";

export default storyboard("bigmodel", {
  window: [1400, 900],
  layout: "placement-and-chat",
  skipModelPin: true,
  preloadChatModel: false,
  clearChat: true,
  beats: [
    beat("Open on chat beside the live matrix", waitForSelector(".lilbee-chat-textarea"), {
      holdMs: 2000,
      caption: "Qwen3-235B, split across three NVIDIA A100s.",
    }),
    beat("Ask how lilbee splits a model", fillChat(QUESTION), { holdMs: 500 }),
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
    beat("Send", clickSend(), { holdMs: 700 }),
    beat(
      "Ensure the message sent",
      runJs(`
        await new Promise((r) => setTimeout(r, 1200));
        const msgs = document.querySelectorAll('.lilbee-chat-messages > *').length;
        if (msgs === 0) {
          const b = document.querySelector('.lilbee-chat-send');
          if (b) b.click();
          await new Promise((r) => setTimeout(r, 800));
        }
      `),
      { holdMs: 300 },
    ),
    beat("Stream the answer across three GPUs", waitChatIdle(230_000), {
      holdMs: 3600,
      speedup: 3,
      caption: "A 235B model answers live, grounded and cited, across all three GPUs.",
    }),
    // --- Show the thinking: expand, scroll through it, back to the answer ---
    beat("Expand the thinking", clickSelector(".lilbee-reasoning summary"), {
      holdMs: 900,
      caption: "It reasoned before answering — open the thinking.",
    }),
    beat(
      "Scroll through the reasoning",
      runJs(`
        const msgs = document.querySelector('.lilbee-chat-messages');
        const det = document.querySelector('.lilbee-reasoning');
        if (msgs && det) {
          det.setAttribute('open', '');
          const start = det.offsetTop - 70;
          msgs.scrollTop = start;
          const end = Math.min(start + det.scrollHeight - msgs.clientHeight * 0.4, msgs.scrollHeight - msgs.clientHeight);
          let i = 0; const steps = 70; const from = msgs.scrollTop;
          await new Promise((done) => {
            const id = setInterval(() => {
              i++; msgs.scrollTop = from + (end - from) * (i / steps);
              if (i >= steps) { clearInterval(id); done(); }
            }, 55);
          });
        }
      `),
      { holdMs: 1400, speedup: 2, caption: "Every step of the reasoning, on the record." },
    ),
    beat(
      "Collapse the thinking, back to the answer",
      runJs(`
        const det = document.querySelector('.lilbee-reasoning');
        if (det) det.removeAttribute('open');
        const msgs = document.querySelector('.lilbee-chat-messages');
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
        await new Promise((r) => setTimeout(r, 300));
      `),
      { holdMs: 1000 },
    ),
    beat("Open the cited sources", clickSelector(".lilbee-chat-sources summary"), {
      holdMs: 1600,
      caption: "Grounded in your code. Cited.",
    }),
    beat(
      "Mouse to the citation and open it",
      clickSelector(".lilbee-chat-sources .lilbee-source-chip-loc.lilbee-clickable"),
      { holdMs: 2200, caption: "Every claim, traceable to the exact line." },
    ),
    beat(
      "Scroll to the cited function",
      runJs(WAIT_PREVIEW_TEXT_JS + `
        const host = document.querySelector('.lilbee-preview-host');
        if (host) {
          const start = host.scrollTop;
          const maxEnd = host.scrollHeight - host.clientHeight;
          // Land on the real function the answer used, whichever source it cited.
          const TARGETS = ['placement_from_spec', 'estimate_peak', 'unplaceable_roles', 'plan_placement'];
          let target = null;
          const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            if (n.textContent && TARGETS.some((t) => n.textContent.includes(t))) {
              target = n.parentElement;
              break;
            }
          }
          let end;
          if (target) {
            const hostTop = host.getBoundingClientRect().top;
            const tTop = target.getBoundingClientRect().top;
            end = start + (tTop - hostTop) - host.clientHeight * 0.33;
          } else {
            end = start + (maxEnd - start) * 0.6;
          }
          end = Math.max(0, Math.min(end, maxEnd));
          const steps = 70;
          let i = 0;
          const id = setInterval(() => {
            i++;
            host.scrollTop = start + (end - start) * (i / steps);
            if (i >= steps) clearInterval(id);
          }, 55);
        }
      `),
      { holdMs: 4600, caption: "Scroll through the real source it cited." },
    ),
  ],
});
