/**
 * first_start demo: a true from-scratch install.
 *
 *   1. Install BRAT from the community plugin store.
 *   2. Add tobocop2/obsidian-lilbee through BRAT.
 *   3. Enable the lilbee plugin.
 *   4. Walk the SetupWizard end-to-end: pick Managed server, pick the
 *      smallest chat model (Qwen3 0.6B), let the embedding model
 *      download, etc.
 *   5. Add the lilbee README to the corpus via the command palette.
 *   6. Ask a simple question Qwen3 0.6B can answer, watch it stream.
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
} from "../src/lib.ts";

const GITHUB_REPO = "tobocop2/obsidian-lilbee";
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
const wizardStep = (label: string) => [
  beat(
    label + " (reveal CTA)",
    runJs(`document.querySelector('.lilbee-wizard-actions button.mod-cta')?.scrollIntoView({ block: 'center', behavior: 'instant' });`),
    { holdMs: 250 },
  ),
  beat(label, clickSelector(".lilbee-wizard-actions button.mod-cta"), { holdMs: 1700 }),
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
  beats: [
    beat("Opening hold on a fresh empty vault", sleep(400)),

    // --- Stage 1: install BRAT ---
    // Open settings via the gear icon so the viewer sees how a normal
    // user gets there, not by command-palette mystery.
    beat(
      "Open settings",
      runJs(`window.app.commands.executeCommandById("app:open-settings");`),
      { holdMs: 1100, keyHint: "⌘," },
    ),
    beat(
      "Click Community plugins in the settings tab list",
      clickSelector('.vertical-tab-nav-item:text-is("Community plugins")'),
      { holdMs: 1100 },
    ),
    beat(
      "Acknowledge the safe-mode modal — Turn on community plugins",
      runJs(`
        const btn = Array.from(document.querySelectorAll('button.mod-cta'))
          .find(b => /turn on community plugins/i.test(b.textContent || ''));
        if (btn) btn.click();
      `),
      { holdMs: 1400 },
    ),
    beat("Click Browse to open the community plugin store", clickSelector('button:text-is("Browse")'), { holdMs: 1300 }),
    beat(
      "Click the search field",
      clickSelector('input[placeholder^="Search community plugins"]'),
      { holdMs: 500 },
    ),
    beat("Search for BRAT", type_("BRAT"), { holdMs: 1300 }),
    beat(
      "Open the BRAT plugin card",
      clickSelector('.community-item:has-text("By tfthacker")'),
      { holdMs: 1600 },
    ),
    // Install/Enable buttons only show when BRAT isn't already installed
    // in this vault. If a prior demo run left BRAT installed, the modal
    // shows Disable/Uninstall instead — skip those clicks gracefully.
    beat(
      "Install + Enable BRAT (skipped if already installed)",
      runJs(`
        const btns = Array.from(document.querySelectorAll('.modal-container button'));
        const install = btns.find(b => /^install$/i.test((b.textContent || '').trim()));
        if (install) {
          install.click();
          await new Promise(r => setTimeout(r, 2500));
          const after = Array.from(document.querySelectorAll('.modal-container button'));
          const enable = after.find(b => /^enable$/i.test((b.textContent || '').trim()));
          if (enable) enable.click();
        }
      `),
      { holdMs: 2200 },
    ),
    beat("Close BRAT details", key("escape"), { holdMs: 500 }),
    beat("Close the community plugin browser", key("escape"), { holdMs: 500 }),
    beat("Close settings", key("escape"), { holdMs: 800 }),

    // --- Stage 2: BRAT add lilbee ---
    beat(
      "Open command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 600, keyHint: "⌘P" },
    ),
    beat("Filter to BRAT add", type_("BRAT add beta plugin"), { holdMs: 800 }),
    beat("Run the BRAT add command", key("enter"), { holdMs: 700 }),
    beat(
      "Click the URL field",
      clickSelector('.modal-container input[type="text"], .modal-container input.beta-plugin-input'),
      { holdMs: 300 },
    ),
    beat("Paste the lilbee GitHub repo", type_(GITHUB_REPO), { holdMs: 700 }),
    // Click Add plugin. The URL was just typed via OS keystrokes so
    // it's already in the input; no need for a DOM-level value setter
    // that would briefly fight the typing animation.
    // BRAT labels this "Add Plugin" (capital P); match loosely so a casing
    // or wording change can't strand the click. The programmatic addPlugin in
    // the next beat does the real work regardless.
    beat(
      "Click Add plugin",
      clickSelector('.modal-container button.mod-cta:has-text("Add")'),
      { holdMs: 1200 },
    ),
    beat(
      "BRAT pulls lilbee from GitHub",
      runJs(`
        const brat = window.app.plugins.plugins["obsidian42-brat"];
        document.querySelectorAll('.modal-container').forEach(m => m.remove());
        if (brat) await brat.betaPlugins.addPlugin(${JSON.stringify(GITHUB_REPO)}, false);
        for (let i = 0; i < 60; i++) {
          if (window.app.plugins.manifests["lilbee"]) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 1500 },
    ),
    // BRAT installs the most recent tagged release, which lags main when
    // there are unreleased commits (e.g. the multi-vault shared-root
    // refactor). For the demo to exercise the same code the rest of the
    // reel uses, overlay the freshly-built plugin files from this repo
    // over the BRAT-installed ones. Off-camera: a no-op for the viewer,
    // who sees BRAT add the plugin and the wizard come up moments later.
    beat(
      "Sync latest plugin files over the BRAT-installed version",
      runJs(`
        const fs = require('node:fs');
        const path = require('node:path');
        const vaultPath = window.app.vault.adapter.basePath;
        const dst = path.join(vaultPath, '.obsidian/plugins/lilbee');
        const src = '/Users/tobias/projects/obsidian-lilbee-demos';
        for (const name of ['main.js', 'styles.css', 'manifest.json']) {
          fs.copyFileSync(path.join(src, name), path.join(dst, name));
        }
      `),
      { holdMs: 400 },
    ),
    beat("Dismiss any 'added' notice", key("escape"), { holdMs: 600 }),

    // --- Stage 3: enable lilbee ---
    // Make absolutely sure lilbee is disabled before we click the
    // toggle: if BRAT or a previous demo run left it enabled, the
    // toggle would visibly flip OFF then ON and that's the "enabling
    // and disabling" the viewer reads as broken.
    beat(
      "Make sure lilbee starts disabled so the toggle is a clean ON",
      runJs(`
        if (window.app.plugins.enabledPlugins.has("lilbee")) {
          await window.app.plugins.disablePluginAndSave("lilbee");
        }
      `),
      { holdMs: 200 },
    ),
    beat(
      "Open settings again",
      runJs(`window.app.commands.executeCommandById("app:open-settings");`),
      { holdMs: 1000, keyHint: "⌘," },
    ),
    beat(
      "Click Community plugins",
      clickSelector('.vertical-tab-nav-item:text-is("Community plugins")'),
      { holdMs: 1000 },
    ),
    beat(
      "Toggle lilbee ON",
      runJs(`
        const items = Array.from(document.querySelectorAll('.setting-item'));
        const row = items.find(el => /lilbee/i.test(el.querySelector('.setting-item-name')?.textContent || ''));
        // Only click the toggle when lilbee is currently OFF, so the
        // click reads as a clean turn-on and never as a flip-off then back-on.
        if (!window.app.plugins.enabledPlugins.has("lilbee")) {
          const toggle = row?.querySelector('.checkbox-container');
          toggle?.click();
          if (!window.app.plugins.enabledPlugins.has("lilbee")) {
            await window.app.plugins.enablePluginAndSave("lilbee");
          }
        }
      `),
      { holdMs: 2000 },
    ),
    beat("Close settings — the wizard appears next now that lilbee just loaded", key("escape"), { holdMs: 1500 }),

    // --- Stage 4: lilbee's first-load wizard auto-opens; walk it ---
    beat(
      "Wait for the wizard modal to appear",
      runJs(`
        // Plugin opens SetupWizard automatically when setupCompleted=false.
        // Belt-and-suspenders: if a previous install left setupCompleted=true,
        // flip it and trigger the wizard.
        const p = window.app.plugins.plugins.lilbee;
        if (!p) throw new Error("lilbee plugin still not loaded after wait");
        if (p.settings.setupCompleted) {
          p.settings.setupCompleted = false;
          p.settings.activeChatModel = ${JSON.stringify(SMALL_MODEL_REPO + "/Qwen3-0.6B-Q8_0.gguf")};
          await p.saveSettings();
          window.app.commands.executeCommandById("lilbee:lilbee:setup");
        }
        // Wait for the wizard DOM to materialise.
        for (let i = 0; i < 60; i++) {
          if (document.querySelector('.lilbee-wizard')) return;
          await new Promise(r => setTimeout(r, 250));
        }
      `),
      { holdMs: 1500 },
    ),
    ...wizardStep("Welcome -> Get started"),
    ...wizardStep("Server mode -> Next (Managed downloads server binary)"),
    // The wizard's "Server mode → Next" calls startManagedServer, which
    // downloads the binary and starts the process. The task queue
    // doesn't track this; wait for the wizard to advance to the model
    // picker step instead.
    // The picker's cards load AND re-render asynchronously (catalog API
    // call, then a RAM-fit pass), so a coordinate-based click races the
    // re-render — the card is found one moment and gone the next. Poll for
    // the Qwen3 0.6B card and DOM-click it, re-querying each iteration so a
    // re-render can't strand a stale node, until the card reports selected.
    beat(
      "Wait for the model picker, then select Qwen3 0.6B",
      runJs(`
        for (let i = 0; i < 240; i++) {
          const card = document.querySelector('.lilbee-wizard-models [data-repo*="Qwen3-0.6B"]');
          if (card) {
            card.scrollIntoView({ block: 'center', behavior: 'instant' });
            card.click();
            await new Promise(r => setTimeout(r, 250));
            if (document.querySelector('.lilbee-wizard-models [data-repo*="Qwen3-0.6B"].is-selected')) return;
          }
          await new Promise(r => setTimeout(r, 400));
        }
      `),
      { holdMs: 1200, speedup: 4 },
    ),
    ...wizardStep("Model picker -> Continue (Qwen3 0.6B downloads)"),
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
    // Pick a small embedding model that the demo isn't already running
    // (embeddinggemma 300m), so the next step is a real download the viewer
    // sees stream. Poll + re-query like the chat picker so a re-render can't
    // strand the click; fall back to the wizard default if the card is absent.
    beat(
      "Select the embeddinggemma embedding model",
      runJs(`
        for (let i = 0; i < 180; i++) {
          const card = document.querySelector('.lilbee-wizard-models [data-repo*="embeddinggemma"]');
          if (card) {
            card.scrollIntoView({ block: 'center', behavior: 'instant' });
            card.click();
            await new Promise(r => setTimeout(r, 250));
            if (document.querySelector('.lilbee-wizard-models [data-repo*="embeddinggemma"].is-selected')) return;
          }
          await new Promise(r => setTimeout(r, 400));
        }
      `),
      { holdMs: 1000, speedup: 3 },
    ),
    ...wizardStep("Embedding picker -> Continue (embedding model downloads)"),
    beat(
      "Wait for the embedding model download to finish (real completion)",
      runJs(`
        // embeddinggemma 300m is a real download too; wait for it to register
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
              installed = (inst.models || []).some(m => /embeddinggemma/i.test(m.name));
            } catch {}
          }
          if (advanced && (installed || i > 6)) return;
          await new Promise(r => setTimeout(r, 1000));
        }
      `),
      { holdMs: 1500, speedup: 10, maxMs: 600_000 },
    ),
    ...wizardStep("Sync step -> Continue"),
    ...wizardStep("Wiki step -> Next"),
    beat(
      "Done -> Open chat (if still showing)",
      runJs(`
        const btn = document.querySelector('.lilbee-wizard button.mod-cta:last-of-type');
        if (btn) btn.click();
      `),
      { holdMs: 1500 },
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

    // --- Stage 5: the first usage — ask a question, get a cited answer ---
    // The whole point of the install is the first chat. Wait until the
    // managed server is genuinely READY with the just-downloaded model
    // installed (the READY event lands late) before revealing the chat
    // panel, so the first-run model fetch never flashes "No models
    // installed". Then ask, send, and stream the first cited answer from
    // the freshly downloaded Qwen3 0.6B against the synced corpus.
    beat(
      "Wait for the server to be ready, then open a clean chat panel",
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
        // 3. Open the chat WIDE in the main editor area (the wizard otherwise
        // drops it in the narrow right sidebar, which compresses every bubble)
        // and collapse both side panels for a clean full-width chat.
        window.app.workspace.detachLeavesOfType('lilbee-chat');
        window.app.workspace.leftSplit?.collapse?.();
        window.app.workspace.rightSplit?.collapse?.();
        const mainLeaf = window.app.workspace.getLeaf(false);
        await mainLeaf.setViewState({ type: 'lilbee-chat', active: true });
        window.app.workspace.revealLeaf(mainLeaf);
        await new Promise(r => setTimeout(r, 500));
        const view = mainLeaf.view;
        if (view && typeof view.fetchAndFillSelectors === 'function') await view.fetchAndFillSelectors();
        await new Promise(r => setTimeout(r, 400));
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta) ta.focus();
      `),
      { holdMs: 1400, speedup: 3 },
    ),
    beat("Ask the first question", fillChat(QUESTION), { holdMs: 600 }),
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
    beat("Stream the first cited answer", waitChatIdle(180_000), { holdMs: 1600, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 800 },
    ),
    // Close the loop: jump to the citation, open the README it cites, scroll
    // down into the body, and linger so the cited passage is the last thing
    // on screen. Park the cursor off the links while it scrolls.
    beat("Jump to the citation", clickChip(0), { holdMs: 1200, cursorParkTo: [1245, 520] }),
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
