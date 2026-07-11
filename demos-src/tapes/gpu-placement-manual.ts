/**
 * gpu-placement-manual: taking manual control of GPU placement on a three-A100
 * box. Open the placement matrix, hand-place the 235B across the cards (one card
 * won't fit; all three does), Apply so the fleet re-splits, then add a lilbee
 * source folder and chat — grounded and cited — with the bars live throughout.
 */
import {
  beat,
  clickSelector,
  clickSend,
  fillChat,
  rightClickSelector,
  runJs,
  storyboard,
  waitChatIdle,
  waitForSelector,
  WAIT_PREVIEW_TEXT_JS,
} from "../src/lib.ts";

const QUESTION =
  "How does lilbee place embedding workers across multiple GPUs, and what decides how many replicas run? Answer briefly.";
const chatToggle = (gpu: string) => `[aria-label="Run chat on ${gpu}"]`;

export default storyboard("gpu-placement-manual", {
  window: [1400, 900],
  layout: "explorer-placement",
  skipModelPin: true,
  clearIndex: true,
  resetPlacement: true,
  preloadChatModel: false,
  clearChat: true,
  beats: [
    beat("Open on the placement matrix", waitForSelector(".lilbee-gpu-row"), {
      holdMs: 2400,
      caption: "Three NVIDIA A100s. Take manual control of where the 235B runs.",
    }),

    // Auto mode locks the matrix; switch to manual editing to place by hand.
    beat("Switch to manual editing", clickSelector(".lilbee-placement-btn"), {
      holdMs: 1400,
      caption: "Edit manually — you pick which cards each role runs on.",
    }),
    // Safety net: if the OS click didn't register, force manual mode so the
    // role toggles below are live before we start hand-placing.
    beat(
      "Ensure the matrix is editable",
      runJs(`
        if (document.querySelector('.lilbee-placement-toggle.is-readonly')) {
          const btn = Array.from(document.querySelectorAll('.lilbee-placement-btn')).find((b) => b.textContent === 'Edit manually');
          if (btn) btn.click();
          await new Promise((r) => setTimeout(r, 400));
        }
      `),
      { holdMs: 300 },
    ),

    // --- Give the 235B all three cards, and mirror the embedder ---
    // Auto tensor-splits chat across two 80GB cards; put it on the third too.
    beat("Add the first card to chat", clickSelector(chatToggle("CUDA0")), {
      holdMs: 2200,
      caption: "Auto splits chat across two cards. Give the 235B all three.",
    }),
    beat("Allow the embedder on the second card", clickSelector('[aria-label="Run embedding on CUDA1"]'), {
      holdMs: 800,
    }),
    beat("Allow the embedder on the third card", clickSelector('[aria-label="Run embedding on CUDA2"]'), {
      holdMs: 1800,
      caption: "The embedder too: allow it on every card.",
    }),
    beat("Add a second embedding worker", clickSelector('[aria-label="Add an embedding worker"]'), {
      holdMs: 700,
    }),
    beat("Add a third embedding worker", clickSelector('[aria-label="Add an embedding worker"]'), {
      holdMs: 1800,
      caption: "Three embedding workers — one per card.",
    }),
    // Guarantee the drafted layout (chat + embed on all three, x3 workers).
    beat(
      "Confirm the drafted layout",
      runJs(`
        for (const role of ['chat', 'embedding']) {
          for (const g of ['CUDA0', 'CUDA1', 'CUDA2']) {
            const t = document.querySelector('[aria-label="Run ' + role + ' on ' + g + '"]');
            if (t && !t.classList.contains('is-on')) t.click();
          }
        }
        for (let i = 0; i < 5; i++) {
          const row = document.querySelector('.lilbee-placement-role-row[data-role="embed"]');
          const count = row ? row.querySelector('.lilbee-placement-step-count') : null;
          if (count && count.textContent === '\\u00d73') break;
          const plus = document.querySelector('[aria-label="Add an embedding worker"]');
          if (plus) plus.click();
          await new Promise((r) => setTimeout(r, 150));
        }
        await new Promise((r) => setTimeout(r, 300));
      `),
      { holdMs: 300 },
    ),
    beat("Apply the placement", clickSelector(".lilbee-placement-btn-primary"), {
      holdMs: 2000,
      caption: "Apply — the fleet re-splits across the cards you picked.",
    }),
    // Safety net: if the OS click missed Apply, apply via the DOM.
    beat(
      "Ensure the placement applied",
      runJs(`
        const apply = document.querySelector('.lilbee-placement-btn-primary');
        const overlay = document.querySelector('.lilbee-placement-overlay');
        if (apply && !overlay && !apply.classList.contains('is-disabled')) {
          apply.click();
          await new Promise((r) => setTimeout(r, 500));
        }
      `),
      { holdMs: 300 },
    ),
    beat(
      "Wait for the fleet to settle",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const base = p.settings.serverUrl, tok = p.settings.manualToken;
        for (let i = 0; i < 200; i++) {
          try {
            const h = await (await fetch(base + '/api/health', { headers: { Authorization: 'Bearer ' + tok } })).json();
            if (h.chat_ready === true) {
              // also confirm the embedder is serving before ingest runs
              const s = await fetch(base + '/api/search?q=ready', { headers: { Authorization: 'Bearer ' + tok } });
              if (s.ok) { p.chatWarming = false; break; }
            }
          } catch (e) {}
          await new Promise(r => setTimeout(r, 1500));
        }
      `),
      { holdMs: 2000, maxMs: 300000, speedup: 4, caption: "Changing placement reloads the fleet — chat and ingest wait until it's ready." },
    ),

    // --- Add the vault's lilbee source through the right-click menu ---
    beat(
      "Reveal the source folder in the explorer",
      runJs(`
        const app = window.app;
        app.workspace.leftSplit?.expand?.();
        const folder = app.vault.getAbstractFileByPath('lilbee-src');
        const leaf = app.workspace.getLeavesOfType('file-explorer')[0];
        if (leaf) app.workspace.revealLeaf(leaf);
        const view = leaf?.view;
        if (view?.revealInFolder) view.revealInFolder(folder);
        await new Promise(r => setTimeout(r, 250));
        const item = view?.fileItems?.['lilbee-src'];
        if (item?.el) item.el.scrollIntoView({ block: 'center' });
      `),
      { holdMs: 900 },
    ),
    beat("Right-click the source folder", rightClickSelector('.nav-folder-title[data-path="lilbee-src"]'), {
      holdMs: 1400,
      caption: "Right-click your code in the vault.",
    }),
    beat(
      "Tag the Add-to-lilbee menu item",
      runJs(`
        let item = null;
        for (let i = 0; i < 30; i++) {
          item = Array.from(document.querySelectorAll('.menu-item')).find((m) => (m.textContent || '').includes('Add to lilbee'));
          if (item) break;
          // If the OS right-click didn't land the menu, open it programmatically.
          if (i === 4) {
            const folder = document.querySelector('.nav-folder-title[data-path="lilbee-src"]');
            if (folder) {
              const b = folder.getBoundingClientRect();
              folder.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }));
            }
          }
          await new Promise(r => setTimeout(r, 100));
        }
        if (item) { item.classList.add('lilbee-demo-add'); item.style.cursor = 'pointer'; item.querySelectorAll('*').forEach((c) => (c.style.cursor = 'pointer')); }
      `),
      { holdMs: 300 },
    ),
    beat("Click Add to lilbee", clickSelector(".menu-item.lilbee-demo-add"), {
      holdMs: 1000,
      caption: "Add to lilbee.",
    }),
    beat(
      "Split in the Task Center beside the matrix",
      runJs(`
        const app = window.app;
        app.workspace.leftSplit?.collapse?.();
        const placement = app.workspace.getLeavesOfType('lilbee-placement')[0];
        const tasks = app.workspace.createLeafBySplit(placement, 'vertical');
        await tasks.setViewState({ type: 'lilbee-tasks', active: true });
        app.workspace.setActiveLeaf(placement, { focus: true });
        await new Promise(r => setTimeout(r, 300));
        const splits = document.querySelectorAll('.workspace-split.mod-vertical');
        for (const split of Array.from(splits)) {
          const tabs = split.querySelectorAll(':scope > .workspace-tabs');
          if (tabs.length === 2) { tabs[0].style.flex = '1'; tabs[1].style.flex = '1'; break; }
        }
      `),
      { holdMs: 1600, caption: "The Task Center chews through it, the matrix live on the left." },
    ),
    beat(
      "Watch it embed across the cards",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const base = p.settings.serverUrl, tok = p.settings.manualToken;
        let last = -1, stable = 0;
        for (let i = 0; i < 90; i++) {
          try {
            const r = await fetch(base + '/api/documents', { headers: { Authorization: 'Bearer ' + tok } });
            const n = (await r.json()).total || 0;
            if (n > 0 && n === last) stable++; else stable = 0;
            last = n;
            if (stable >= 4) break;
          } catch (e) {}
          await new Promise(r => setTimeout(r, 1000));
        }
      `),
      { holdMs: 2500, maxMs: 120000, speedup: 6, caption: "Every file embeds across all three GPUs — watch the bars." },
    ),

    // --- Swap the Task Center for chat and put it to work ---
    beat(
      "Open chat beside the matrix",
      runJs(`
        const app = window.app;
        app.workspace.detachLeavesOfType('lilbee-tasks');
        const placement = app.workspace.getLeavesOfType('lilbee-placement')[0];
        const chat = app.workspace.createLeafBySplit(placement, 'vertical');
        await chat.setViewState({ type: 'lilbee-chat', active: true });
        app.workspace.setActiveLeaf(chat);
        await new Promise(r => setTimeout(r, 400));
        const splits = document.querySelectorAll('.workspace-split.mod-vertical');
        for (const split of Array.from(splits)) {
          const tabs = split.querySelectorAll(':scope > .workspace-tabs');
          if (tabs.length === 2) { tabs[0].style.flex = '1'; tabs[1].style.flex = '1'; break; }
        }
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta) ta.focus();
      `),
      { holdMs: 900, caption: "Now put it to work, eyes on the GPUs." },
    ),
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
          const TARGETS = ['_place_replicas', 'resolve_replica_count', 'plan_placement'];
          let target = null;
          const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            if (n.textContent && TARGETS.some((t) => n.textContent.includes(t))) { target = n.parentElement; break; }
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
          const id = setInterval(() => { i++; host.scrollTop = start + (end - start) * (i / steps); if (i >= steps) clearInterval(id); }, 55);
        }
      `),
      { holdMs: 4600, caption: "Scroll through the real source it cited." },
    ),
  ],
});
