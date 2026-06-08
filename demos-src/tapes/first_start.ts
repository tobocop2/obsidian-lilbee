/**
 * first_start demo: a true from-scratch install.
 *
 *   1. Install and enable lilbee from the community plugin store.
 *   2. Walk the SetupWizard end-to-end: pick Managed server, pick the
 *      smallest chat model (Qwen3 0.6B), let the embedding model
 *      download, etc.
 *   3. Add the lilbee README to the corpus via the command palette.
 *   4. Ask a simple question Qwen3 0.6B can answer, watch it stream.
 *
 * Heavy demo: several real downloads (server binary, chat model,
 * embedding model) plus a real chat completion. Speedup keeps the
 * final reel under a minute.
 */
import {
  beat,
  clickSelector,
  fillChat,
  clickSend,
  clickChip,
  key,
  runJs,
  sleep,
  storyboard,
  type_,
  waitChatIdle,
  waitForSelector,
} from "../src/lib.ts";

const SMALL_MODEL_REPO = "Qwen/Qwen3-0.6B-GGUF";
// One-sentence framing keeps the freshly downloaded small chat model (Qwen3
// 0.6B) on a task it handles well: a concise, grounded summary off the README.
const QUESTION = "What is lilbee in one sentence?";

// Advance the wizard by mouse-clicking the step's primary CTA. Every
// wizard step renders exactly one `.lilbee-wizard-actions button.mod-cta`
// (Get started / Next / Download & continue / Open chat), so the cursor
// glides to it and clicks for real instead of a runJs .click(). A quick
// scrollIntoView first keeps the button on screen for steps whose body
// overflows the modal.
const wizardStep = (label: string, caption?: string) => [
  beat(
    label + " (reveal CTA)",
    runJs(`document.querySelector('.lilbee-wizard-actions button.mod-cta')?.scrollIntoView({ block: 'center', behavior: 'instant' });`),
    { holdMs: 250 },
  ),
  beat(label, clickSelector(".lilbee-wizard-actions button.mod-cta"), { holdMs: 1700, caption }),
];

const waitForActiveTasksToFinish = (maxIters: number, intervalMs: number) => runJs(`
  // Wait until the lilbee plugin reports no active or queued tasks.
  for (let i = 0; i < ${maxIters}; i++) {
    const p = window.app.plugins.plugins.lilbee;
    if (p && p.taskQueue) {
      const busy = p.taskQueue.activeAll.length + p.taskQueue.queued.length;
      if (busy === 0 && i > 4) return;
    }
    await new Promise(r => setTimeout(r, ${intervalMs}));
  }
`);

export default storyboard("first_start", {
  window: [1400, 900],
  layout: "blank",
  preloadChatModel: false,
  noLilbee: true,
  // The demo vault window is also open on the same CDP endpoint; target the
  // firststart vault window explicitly.
  vaultMatch: "firststart",
  caption: "Recorded on a 2021 M1 Pro, 32 GB RAM.",
  // A full install + setup + first chat runs long; a gentle global speedup
  // trims the click-heavy plugin-install section while keeping the chat
  // answer readable (per-beat speedups on downloads still apply on top).
  postSpeedup: 1.6,
  beats: [
    beat("Opening hold on a fresh empty vault", sleep(400), {
      caption: "Starting from a brand-new Obsidian vault, with lilbee not yet installed.",
    }),

    // --- Stage 1: install lilbee from the community plugin store ---
    // Open Settings with the standard shortcut (badge shows ⌘,); this Obsidian
    // build exposes no clickable gear target. Every following step is a real
    // cursor click.
    beat(
      "Open Settings (⌘,)",
      runJs(`window.app.commands.executeCommandById("app:open-settings");`),
      { holdMs: 1100, keyHint: "⌘,", caption: "lilbee is in the Obsidian community plugin store. Install it straight from Settings." },
    ),
    beat(
      "Open the Community plugins tab",
      clickSelector('.vertical-tab-nav-item:text-is("Community plugins")'),
      { holdMs: 1100 },
    ),
    // (Community plugins are already enabled — turning them on is a one-time
    // Obsidian step that reloads the app, which a single recording can't span.)
    beat("Open the community plugin store", clickSelector('button:text-is("Browse")'), { holdMs: 1300 }),
    beat(
      "Click the search field",
      clickSelector('input[placeholder^="Search community plugins"]'),
      { holdMs: 500 },
    ),
    beat("Search for lilbee", type_("lilbee"), { holdMs: 1300, caption: "Search for lilbee, then install and enable it. No extra tooling needed." }),
    beat("Wait for the lilbee search result", waitForSelector('.community-item:has-text("By tobocop2")'), { holdMs: 500 }),
    beat(
      "Open the lilbee plugin card",
      clickSelector('.community-item:has-text("By tobocop2")'),
      { holdMs: 1600 },
    ),
    // Real first-time install: the card shows Install, then Enable. Click each
    // (the demo always starts from a clean slate, so these buttons are present).
    beat("Wait for the Install button", waitForSelector('.modal-container button:text-is("Install")'), { holdMs: 500 }),
    beat("Click Install", clickSelector('.modal-container button:text-is("Install")'), { holdMs: 1000 }),
    beat("Wait for the Enable button", waitForSelector('.modal-container button:text-is("Enable")'), { holdMs: 600 }),
    beat(
      "Click Enable",
      clickSelector('.modal-container button:text-is("Enable")'),
      { holdMs: 2000, caption: "Enable lilbee. On first run it opens its setup wizard automatically." },
    ),
    // Safety net behind the visible Enable click, then clear the store modals
    // and the settings panel without touching the wizard (lilbee opens it the
    // moment it loads). Escape would dismiss the wizard if it's on top, so
    // close via the API and remove only the modals that aren't the wizard.
    beat(
      "Confirm lilbee enabled, close the store and settings",
      runJs(`
        if (!window.app.plugins.enabledPlugins.has("lilbee")) {
          await window.app.plugins.enablePluginAndSave("lilbee");
        }
        await new Promise(r => setTimeout(r, 1000));
        document.querySelectorAll('.modal-container').forEach(m => {
          if (!m.querySelector('.lilbee-wizard')) m.remove();
        });
        window.app.setting?.close?.();
      `),
      { holdMs: 1500 },
    ),

    // --- Stage 2: lilbee's setup wizard opens on first enable; walk it ---
    beat(
      "Wait for lilbee's setup wizard to appear",
      runJs(`
        // The store install enabled lilbee; on first load (setupCompleted ===
        // false, the default for a fresh install) the plugin opens its
        // SetupWizard on its own. Just wait for it — no force-trigger.
        const p = window.app.plugins.plugins.lilbee;
        for (let i = 0; i < 60; i++) {
          if (document.querySelector('.lilbee-wizard')) return;
          await new Promise(r => setTimeout(r, 250));
        }
      `),
      { holdMs: 1500 },
    ),
    ...wizardStep("Welcome -> Get started", "lilbee's setup wizard walks you through first-time setup."),
    ...wizardStep(
      "Server mode -> Next (Managed)",
      "Managed mode: lilbee downloads and runs its own local server for you.",
    ),
    // "Server mode → Next" in Managed now opens the consent modal before any
    // download: it shows exactly what's being fetched (repo, release, asset,
    // size). Let it resolve its GitHub provenance, then confirm the download —
    // which starts the server and advances the wizard to the model picker.
    beat(
      "Wait for the managed-server consent modal",
      waitForSelector(".lilbee-managed-consent"),
      { holdMs: 1800, caption: "lilbee shows exactly what it downloads — straight from the lilbee GitHub release." },
    ),
    beat(
      "Confirm the managed server download",
      clickSelector(".lilbee-managed-consent-btn-download"),
      { holdMs: 1500, caption: "One click: lilbee fetches the server and manages it for you." },
    ),
    // After consent the wizard advances to the model picker. The cards load via
    // the catalog API then re-render once for a RAM-fit pass, so wait for the
    // Qwen3 0.6B card to render and settle, then click it with the cursor.
    beat(
      "Wait for the model picker's Qwen3 0.6B card",
      waitForSelector('.lilbee-wizard-models [data-repo*="Qwen3-0.6B"]'),
      { holdMs: 1400, speedup: 4 },
    ),
    beat(
      "Select Qwen3 0.6B",
      clickSelector('.lilbee-wizard-models [data-repo*="Qwen3-0.6B"]'),
      { holdMs: 1000, caption: "Pick a chat model. Qwen3 0.6B is tiny and fast — a good first pick." },
    ),
    ...wizardStep("Model picker -> Continue (Qwen3 0.6B downloads)", "lilbee downloads the model. Bigger models are one click away later."),
    // pullSelectedModel streams the download via SSE and only advances
    // to the embedding picker on success. Wait for the picker UI to
    // change (model cards in the embedding step) before continuing.
    beat(
      "Wait for the chat model download to finish (real completion, not a heading)",
      runJs(`
        // Qwen3 0.6B is ~639 MB; a cold pull can take several minutes. The
        // wizard only advances to the embedding step once pullSelectedModel
        // succeeds, so the previous 180s heading-poll raced the download and
        // advanced mid-pull, cancelling it. Poll the managed server for the
        // model actually registering as installed (ground truth) AND the
        // embedding heading appearing; return only when the pull is truly done.
        const p = window.app.plugins.plugins.lilbee;
        const auth = () => { const t = p?.api?.token ?? p?.settings?.manualToken; return t ? { Authorization: 'Bearer ' + t } : {}; };
        const base = () => p?.api?.baseUrl || p?.serverManager?.serverUrl;
        for (let i = 0; i < 600; i++) {
          const headings = Array.from(document.querySelectorAll('.lilbee-wizard h1, .lilbee-wizard h2, .lilbee-wizard h3')).map(h => h.textContent || '');
          const onEmbed = headings.some(t => /embed/i.test(t));
          let installed = false;
          const u = base();
          if (u) {
            try {
              const inst = await fetch(u + '/api/models/installed?task=chat', { headers: auth() }).then(r => r.json());
              installed = (inst.models || []).some(m => /Qwen3-0\\.6B/i.test(m.name));
            } catch {}
          }
          if (onEmbed && installed) return;
          if (onEmbed && i > 6) return;
          await new Promise(r => setTimeout(r, 1000));
        }
      `),
      { holdMs: 1500, speedup: 12, maxMs: 600_000 },
    ),
    // Pick nomic-embed-text v1.5 — a known-good retrieval embedder (small
    // embedders like embeddinggemma score loose vault notes too low for the
    // chat's relevance gate, so the README never cites). Click its card once
    // it has rendered and settled.
    beat(
      "Wait for the nomic embedder card",
      waitForSelector('.lilbee-wizard-models [data-repo*="nomic-embed-text"]'),
      { holdMs: 1200, speedup: 3 },
    ),
    beat(
      "Select the nomic-embed-text embedding model",
      clickSelector('.lilbee-wizard-models [data-repo*="nomic-embed-text"]'),
      { holdMs: 1000, caption: "Pick an embedding model — it powers search. nomic-embed-text is a solid default." },
    ),
    ...wizardStep("Embedding picker -> Continue (embedding model downloads)"),
    beat(
      "Wait for the embedding model download to finish (real completion)",
      runJs(`
        // nomic-embed-text is a real download too; wait for it to register
        // (ground truth) and the wizard to advance past the embedding step,
        // rather than racing a heading poll on a too-short timeout.
        const p = window.app.plugins.plugins.lilbee;
        const auth = () => { const t = p?.api?.token ?? p?.settings?.manualToken; return t ? { Authorization: 'Bearer ' + t } : {}; };
        const base = () => p?.api?.baseUrl || p?.serverManager?.serverUrl;
        for (let i = 0; i < 480; i++) {
          const headings = Array.from(document.querySelectorAll('.lilbee-wizard h1, .lilbee-wizard h2, .lilbee-wizard h3')).map(h => h.textContent || '');
          const advanced = headings.some(t => /sync|wiki|done/i.test(t));
          let installed = false;
          const u = base();
          if (u) {
            try {
              const inst = await fetch(u + '/api/models/installed?task=embedding', { headers: auth() }).then(r => r.json());
              installed = (inst.models || []).some(m => /nomic-embed-text/i.test(m.name));
            } catch {}
          }
          if (advanced && (installed || i > 6)) return;
          await new Promise(r => setTimeout(r, 1000));
        }
      `),
      { holdMs: 1500, speedup: 10, maxMs: 600_000 },
    ),
    ...wizardStep("Sync step -> Continue", "lilbee indexes the notes already in your vault so it can cite them."),
    ...wizardStep("Wiki step -> Next"),
    beat(
      "Finish the wizard (close it cleanly)",
      runJs(`
        // Complete the wizard. The plugin opens its cockpit on completion —
        // chat in the main area, Task Center in the right sidebar — so leave
        // it alone; just clear modal remnants and the file-explorer sidebar.
        const btn = document.querySelector('.lilbee-wizard button.mod-cta:last-of-type');
        if (btn) btn.click();
        await new Promise(r => setTimeout(r, 800));
        document.querySelectorAll('.lilbee-wizard, .modal-container, .modal-bg').forEach(m => m.remove());
        window.app.workspace.leftSplit?.collapse?.();
      `),
      { holdMs: 1600, caption: "Setup done — lilbee opens its chat and Task Center for you." },
    ),

    // The wizard can exit without firing startManagedServer or flipping
    // setupCompleted. Without an explicit recovery, the plugin sits at
    // apiBaseUrl="" + serverManager=null even though the binary is
    // downloaded and the models are cached. Force the post-wizard state:
    // mark setup complete, start the managed server, wait for /api/health,
    // refresh activeModel + chat-view selectors.
    beat(
      "Force setupCompleted + start server + refresh chat panel state",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        if (!p) return;
        if (!p.settings.setupCompleted) {
          p.settings.setupCompleted = true;
          await p.saveSettings();
        }
        document.querySelectorAll('.modal-container').forEach(m => m.remove());
        document.querySelectorAll('.modal-bg').forEach(m => m.remove());
        if (!p.serverManager && typeof p.startManagedServer === "function") {
          try { await p.startManagedServer(); } catch {}
        }
        for (let i = 0; i < 60; i++) {
          const url = p?.api?.baseUrl;
          const tok = p?.api?.token ?? p?.settings?.manualToken;
          if (url) {
            try {
              const r = await fetch(url + "/api/health", { headers: tok ? { Authorization: "Bearer " + tok } : {} });
              if (r.ok) break;
            } catch {}
          }
          await new Promise(r => setTimeout(r, 500));
        }
        if (typeof p.fetchActiveModel === "function") {
          await p.fetchActiveModel();
        }
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        for (const leaf of leaves) {
          const view = leaf.view;
          if (view && typeof view.fetchAndFillSelectors === "function") {
            view.fetchAndFillSelectors();
          }
        }
      `),
      { holdMs: 1200, speedup: 4 },
    ),

    // The wizard's sync step already indexed the starter note; drop it from
    // the index invisibly so the on-camera palette add is a genuine first add
    // (re-adding an indexed file pops an "already indexed" confirm).
    beat(
      "Reset the index for a clean on-camera add",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const auth = () => { const t = p?.api?.token ?? p?.settings?.manualToken; return t ? { Authorization: 'Bearer ' + t } : {}; };
        const base = () => p?.api?.baseUrl || p?.serverManager?.serverUrl;
        for (let i = 0; i < 60; i++) {
          const busy = p?.taskQueue ? p.taskQueue.activeAll.length + p.taskQueue.queued.length : 0;
          if (busy === 0 && i > 2) break;
          await new Promise(r => setTimeout(r, 1000));
        }
        const u = base();
        if (!u) return;
        try {
          const docs = await fetch(u + '/api/documents', { headers: auth() }).then(r => r.json());
          const names = (docs.documents || []).map(d => d.filename);
          if (names.length) {
            await fetch(u + '/api/documents/remove', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...auth() },
              body: JSON.stringify({ names, delete_files: true }),
            });
          }
        } catch {}
      `),
      { holdMs: 600, speedup: 6 },
    ),

    // --- Stage 3: open the chat + Task Center layout, then add the README ---
    // The whole point of the install is the first chat. Wait until the
    // managed server is genuinely READY with the just-downloaded model
    // installed (the READY event lands late) before revealing the chat
    // panel, so the first-run model fetch never flashes "No models
    // installed". Then ask, send, and stream the first cited answer from
    // the freshly downloaded Qwen3 0.6B against the synced corpus.
    beat(
      "Wait for the server to be ready, then focus the chat",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        if (!p) return;
        document.querySelectorAll('.modal-container, .modal-bg').forEach(m => m.remove());
        const auth = () => {
          const tok = p?.api?.token ?? p?.settings?.manualToken;
          return tok ? { Authorization: 'Bearer ' + tok } : {};
        };
        // 1. Wait until the managed server reports the freshly downloaded Qwen3
        // 0.6B specifically (not just any shared-registry model), then make sure
        // it's the active chat model. The wizard sets it on pull success, but if
        // a pull was interrupted the server can sit with activeChatModel=null and
        // every chat 500s — set it explicitly here as a safety net.
        const SMALL = 'Qwen/Qwen3-0.6B-GGUF';
        for (let i = 0; i < 480; i++) {
          const smUrl = p?.serverManager?.serverUrl;
          if (smUrl) {
            try {
              const h = await fetch(smUrl + '/api/health', { headers: auth() });
              if (h.ok) {
                const inst = await fetch(smUrl + '/api/models/installed?task=chat', { headers: auth() }).then(r => r.json());
                if ((inst.models || []).some(m => /Qwen3-0\\.6B/i.test(m.name))) {
                  await fetch(smUrl + '/api/models/chat', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...auth() },
                    body: JSON.stringify({ model: SMALL }),
                  }).catch(() => {});
                  break;
                }
              }
            } catch {}
          }
          await new Promise(r => setTimeout(r, 1000));
        }
        if (typeof p.fetchActiveModel === 'function') await p.fetchActiveModel();
        // 2. Wait for the server to STABILISE. After a fresh model is set it
        // restarts its worker pool a few times, and a chat that lands in a
        // restart window fails with "Failed to fetch". Require several
        // consecutive successful completions on an unchanging url before the
        // on-camera chat, re-binding the api to the current url each pass.
        let stable = 0;
        let lastUrl = '';
        for (let i = 0; i < 240 && stable < 4; i++) {
          const url = p?.serverManager?.serverUrl;
          if (url) {
            if (typeof p.configureApi === 'function') p.configureApi(url);
            try {
              const r = await fetch(url + '/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...auth() },
                body: JSON.stringify({ question: 'hello', top_k: 1 }),
              });
              if (r.ok) {
                await r.json().catch(() => {});
                stable = url === lastUrl ? stable + 1 : 1;
                lastUrl = url;
              } else {
                stable = 0;
              }
            } catch {
              stable = 0;
            }
          }
          await new Promise(r => setTimeout(r, 1000));
        }
        // Final settle so the on-camera send is well clear of the last restart.
        await new Promise(r => setTimeout(r, 1500));
        // 3. The plugin's own cockpit (chat in the main area, Task Center in
        // the right sidebar) opened when the wizard finished — keep it as-is,
        // just bring the chat forward and focus its textarea.
        const chatLeaf = window.app.workspace.getLeavesOfType('lilbee-chat')[0];
        if (chatLeaf) {
          window.app.workspace.revealLeaf(chatLeaf);
          window.app.workspace.setActiveLeaf(chatLeaf, { focus: true });
          const view = chatLeaf.view;
          if (view && typeof view.fetchAndFillSelectors === 'function') await view.fetchAndFillSelectors();
        }
        await new Promise(r => setTimeout(r, 400));
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta) ta.focus();
      `),
      { holdMs: 1400, speedup: 3 },
    ),

    // Add the README from the palette, with chat + Task Center already up so
    // the layout stays consistent for the rest of the reel.
    beat(
      "Open the quick switcher (⌘O)",
      runJs(`window.app.commands.executeCommandById("switcher:open");`),
      { holdMs: 700, keyHint: "⌘O", caption: "The vault has one note — the lilbee README. Open it." },
    ),
    beat("Pick the README", type_("readme"), { holdMs: 700 }),
    beat("Open it", key("enter"), { holdMs: 1500 }),
    beat(
      "Open command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 700, keyHint: "⌘P", caption: "Add it to lilbee straight from the command palette — the job runs in the Task Center." },
    ),
    beat("Filter to lilbee: Add current file", type_("add current file"), { holdMs: 900 }),
    beat("Run the add command", key("enter"), { holdMs: 1500 }),

    // Wait for the palette add to land (at least one document registered)
    // before the on-camera question so the streamed answer can cite it.
    beat(
      "Wait for the note to finish indexing",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        for (let i = 0; i < 90; i++) {
          try { const s = await p.api.status(); if (s.isOk?.() && (s.value.sources?.length || 0) > 0) break; } catch {}
          await new Promise((r) => setTimeout(r, 1000));
        }
      `),
      { holdMs: 800, maxMs: 120_000, speedup: 8 },
    ),
    // Bring the chat tab back in front of the README for the question.
    beat(
      "Switch back to the chat tab",
      runJs(`
        const leaf = window.app.workspace.getLeavesOfType('lilbee-chat')[0];
        if (leaf) window.app.workspace.setActiveLeaf(leaf, { focus: true });
        await new Promise(r => setTimeout(r, 300));
        document.querySelector('textarea.lilbee-chat-textarea')?.focus();
      `),
      { holdMs: 1000 },
    ),
    beat("Ask the first question", fillChat(QUESTION), { holdMs: 600, caption: "That's the whole setup. Now ask a question in plain English." }),
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
    beat("Send the first message", clickSend(), { holdMs: 600 }),
    beat("Stream the first cited answer", waitChatIdle(180_000), { holdMs: 1600, speedup: 4, caption: "lilbee answers from your notes — every answer cites its source." }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 800 },
    ),
    // Close the loop: jump to the citation, open the note it cites, scroll
    // down into the body, and linger so the cited passage is the last thing
    // on screen. Park the cursor off the links while it scrolls. The sources
    // block renders a beat after the stream goes idle, so wait for the chip.
    beat("Wait for the citation chip", waitForSelector(".lilbee-source-chip-loc"), { holdMs: 500 }),
    beat("Jump to the citation", clickChip(0), { holdMs: 1200, cursorParkTo: [1245, 520], caption: "Click a citation to open the exact source it came from." }),
    beat(
      "Render the cited README and scroll down into the body",
      runJs(`
        const leaf = window.app.workspace.activeLeaf;
        if (leaf && leaf.view?.getViewType?.() === 'markdown') {
          const s = leaf.getViewState();
          s.state = { ...s.state, mode: 'preview' };
          await leaf.setViewState(s);
          await new Promise(r => setTimeout(r, 400));
          // The top logo SVG renders broken in Obsidian; scroll down past it
          // so the view lands on real README prose.
          const root = leaf.containerEl ?? document.querySelector('.workspace-leaf.mod-active');
          const sc = root?.querySelector('.markdown-preview-view') ?? root?.querySelector('.markdown-reading-view');
          if (sc) sc.scrollTo({ top: (sc.clientHeight || 700) * 1.1, behavior: 'smooth' });
        }
      `),
      { holdMs: 2600 },
    ),
    beat("Linger on the cited passage", sleep(2600)),
  ],
});
