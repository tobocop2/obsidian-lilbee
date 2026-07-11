/**
 * gpu-placement-m1: GPU placement working end to end on an Apple M1 Pro. Opens
 * on the live placement view (unified-memory card) beside the vault's file
 * explorer. Right-click the lilbee plugin's own source folder -> "Add to
 * lilbee"; the Task Center splits in beside the placement view and every file
 * embeds on the Apple GPU. Once embedded, the Task Center swaps for chat
 * (placement on the left) and Qwen3 4B answers "What is lilbee for Obsidian?"
 * grounded + cited, on the same card. One reel, GPU bars live the whole way.
 *
 * Timings measured off camera on this box (M1 Pro 32 GB, Qwen3 4B Q4 + nomic
 * v1.5): 58-file ingest 57.3s; grounded answer 19.4s to first reasoning token,
 * 30.3s to the first answer token, 43.5s total, cited from README + source.
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

const QUESTION = "What is lilbee for Obsidian?";

export default storyboard("gpu-placement-m1", {
  window: [1400, 900],
  layout: "explorer-placement",
  vaultMatch: "lilbee-m1-reel",
  skipModelPin: true,
  clearIndex: true,
  preloadChatModel: true,
  clearChat: true,
  beats: [
    beat("Open on the live placement view beside the vault", waitForSelector(".lilbee-gpu-row"), {
      holdMs: 2600,
      caption: "lilbee's GPU placement, live on an Apple M1 Pro.",
    }),

    // --- Add the plugin's own source through the real right-click menu ---
    beat(
      "Reveal the source folder in the explorer",
      runJs(`
        const app = window.app;
        // Obsidian 1.13 defaults to native macOS context menus, which live
        // outside the page DOM (and the AX tree) — force in-DOM menus so the
        // Add-to-lilbee item is taggable and clickable like in the other reels.
        app.vault.setConfig?.('nativeMenus', false);
        const folder = app.vault.getAbstractFileByPath('plugin-src');
        const view = app.workspace.getLeavesOfType('file-explorer')[0]?.view;
        if (view?.revealInFolder) view.revealInFolder(folder);
        const item = view?.fileItems?.['plugin-src'];
        if (item?.el) item.el.scrollIntoView({ block: 'center' });
      `),
      { holdMs: 800 },
    ),
    beat("Right-click the source folder", rightClickSelector('.nav-folder-title[data-path="plugin-src"]'), {
      holdMs: 1400,
      caption: "Right-click the plugin's own source code.",
    }),
    beat(
      "Tag the Add-to-lilbee menu item",
      runJs(`
        const item = Array.from(document.querySelectorAll('.menu-item'))
          .find((i) => (i.textContent || '').includes('Add to lilbee'));
        if (item) {
          item.classList.add('lilbee-demo-add');
          // Force the pointer/hand glyph so the recorded cursor reads as clickable.
          item.style.cursor = 'pointer';
          item.querySelectorAll('*').forEach((c) => (c.style.cursor = 'pointer'));
        }
      `),
      { holdMs: 200 },
    ),
    beat("Click Add to lilbee", clickSelector(".menu-item.lilbee-demo-add"), {
      holdMs: 1000,
      caption: "Add to lilbee.",
    }),

    // --- Split in the Task Center and watch it embed on the Apple GPU ---
    beat(
      "Split in the Task Center beside the placement view",
      runJs(`
        const app = window.app;
        // Close the file explorer now the folder is added — give the split even room.
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
      { holdMs: 1600, caption: "The Task Center chews through it, placement live on the left." },
    ),
    beat(
      "Watch it embed on the Apple GPU",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        // Managed mode: the live URL and session token hang off the client, not settings.
        const base = p.api.baseUrl, tok = p.api.token;
        let last = -1, stable = 0;
        for (let i = 0; i < 120; i++) {
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
      { holdMs: 2500, maxMs: 150000, caption: "Every file embeds in unified memory — watch the bars." },
    ),

    // --- Swap the Task Center for chat, placement on the left, put it to work ---
    beat(
      "Open chat beside the placement view",
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
      { holdMs: 900, caption: "Now ask about what it just indexed." },
    ),
    beat("Ask what lilbee is", fillChat(QUESTION), { holdMs: 500 }),
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
    beat("Stream the answer on the M1", waitChatIdle(180_000), {
      holdMs: 3600,
      speedup: 3,
      caption: "Qwen3 4B answers, grounded and cited — all local on the M1.",
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
      caption: "Grounded in the code it just indexed. Cited.",
    }),
    beat(
      "Mouse to the citation and open it",
      clickSelector(".lilbee-chat-sources .lilbee-source-chip-loc.lilbee-clickable"),
      { holdMs: 3200, caption: "Every claim, traceable to the source." },
    ),
    beat(
      "Scroll through the cited source",
      runJs(WAIT_PREVIEW_TEXT_JS + `
        const host = document.querySelector('.lilbee-preview-host');
        if (host) {
          const start = host.scrollTop;
          const maxEnd = host.scrollHeight - host.clientHeight;
          const TARGETS = ['What it does', 'cited answers', 'local AI search', 'Everything runs on your computer'];
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
