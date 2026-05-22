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
  key,
  runJs,
  sleep,
  storyboard,
  type_,
  waitChatIdle,
} from "../src/lib.ts";

const GITHUB_REPO = "tobocop2/obsidian-lilbee";
const SMALL_MODEL_REPO = "Qwen/Qwen3-0.6B-GGUF";
const QUESTION = "Is lilbee open source?";

const wizardStep = (label: string) => [
  beat(
    label,
    runJs(`
      const btn = document.querySelector('.lilbee-wizard button.mod-cta:last-of-type, .modal-container .lilbee-wizard button.mod-cta');
      if (btn) {
        btn.scrollIntoView({ block: 'center', behavior: 'instant' });
        await new Promise(r => setTimeout(r, 250));
        btn.click();
      }
    `),
    { holdMs: 1700 },
  ),
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
  caption: "Recorded on a 2021 M1 Pro, 32 GB RAM.",
  beats: [
    beat("Opening hold on a fresh empty vault", sleep(800)),

    // --- Stage 1: install BRAT ---
    // Open settings via the gear icon so the viewer sees how a normal
    // user gets there, not by command-palette mystery.
    beat(
      "Open settings via the command palette",
      runJs(`window.app.commands.executeCommandById("app:open-settings");`),
      { holdMs: 1100 },
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
      { holdMs: 600 },
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
    beat(
      "Click Add plugin",
      clickSelector('.modal-container button.mod-cta:text-is("Add plugin")'),
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
      { holdMs: 1000 },
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
    beat(
      "Wait for the wizard to land on the model picker",
      runJs(`
        for (let i = 0; i < 180; i++) {
          if (document.querySelector('.lilbee-wizard .lilbee-wizard-models')) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 1500, speedup: 4 },
    ),
    beat(
      "Select Qwen3 0.6B in the model picker",
      runJs(`
        const cards = Array.from(document.querySelectorAll('.lilbee-wizard .lilbee-model-card, .lilbee-wizard .lilbee-catalog-card'));
        const target = cards.find(c => /qwen3?\\s*0\\.6/i.test(c.textContent || ''));
        if (target) {
          target.scrollIntoView({ block: 'center', behavior: 'instant' });
          await new Promise(r => setTimeout(r, 200));
          target.click();
        }
      `),
      { holdMs: 1200 },
    ),
    ...wizardStep("Model picker -> Continue (Qwen3 0.6B downloads)"),
    // pullSelectedModel streams the download via SSE and only advances
    // to the embedding picker on success. Wait for the picker UI to
    // change (model cards in the embedding step) before continuing.
    beat(
      "Wait for chat model download to land us on embedding picker",
      runJs(`
        // The DOM swaps between steps. Heuristic: the model picker step
        // is gone (no "Pick chat model" heading) AND embedding cards are
        // present, OR the wizard step indicator has advanced past Model.
        for (let i = 0; i < 360; i++) {
          const headings = Array.from(document.querySelectorAll('.lilbee-wizard h1, .lilbee-wizard h2, .lilbee-wizard h3')).map(h => h.textContent || '');
          if (headings.some(t => /embed/i.test(t))) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 1500, speedup: 4 },
    ),
    ...wizardStep("Embedding picker -> Continue (embedding model downloads)"),
    beat(
      "Wait for embedding model download to land us on the next step",
      runJs(`
        for (let i = 0; i < 240; i++) {
          const headings = Array.from(document.querySelectorAll('.lilbee-wizard h1, .lilbee-wizard h2, .lilbee-wizard h3')).map(h => h.textContent || '');
          if (headings.some(t => /sync|wiki|done/i.test(t))) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 1500, speedup: 4 },
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

    // --- Stage 5: add the seeded lilbee.md and ask a small question ---
    beat(
      "Wait for any background sync to settle",
      waitForActiveTasksToFinish(60, 1000),
      { holdMs: 1000, speedup: 8 },
    ),
    // After the wizard, the lilbee plugin needs both its commands
    // registered AND its embedded server to actually respond to
    // /api/health before the palette can find "Add current file" and
    // the chat can produce answers. Poll both.
    beat(
      "Wait for lilbee server + commands to be fully ready",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const url = p?.settings?.serverUrl;
        const tok = p?.settings?.manualToken;
        for (let i = 0; i < 180; i++) {
          const haveCmd = !!window.app.commands.commands["lilbee:lilbee:add-file"];
          let serverOk = false;
          if (url) {
            try {
              const r = await fetch(url + "/api/health", { headers: tok ? { Authorization: "Bearer " + tok } : {} });
              serverOk = r.ok;
            } catch {}
          }
          if (haveCmd && serverOk) return;
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 700, speedup: 8 },
    ),
    beat(
      "Reveal the file explorer so the user can see the seed file",
      runJs(`
        window.app.workspace.leftSplit?.expand?.();
        const fe = window.app.workspace.getLeavesOfType('file-explorer')[0];
        if (fe) window.app.workspace.revealLeaf(fe);
        await new Promise(r => setTimeout(r, 300));
      `),
      { holdMs: 400 },
    ),
    beat(
      "Open lilbee.md so 'Add current file' has a target",
      clickSelector('.nav-file-title-content:text-is("lilbee")'),
      { holdMs: 900 },
    ),
    beat(
      "Open the command palette",
      runJs(`window.app.commands.executeCommandById("command-palette:open");`),
      { holdMs: 600 },
    ),
    beat("Filter to Add current file", type_("Add current file"), { holdMs: 1800 }),
    beat("Run the add command", key("enter"), { holdMs: 700 }),
    // Belt-and-suspenders: if no ingest task started (the palette
    // command wasn't registered yet), close the palette and add the
    // file programmatically so the corpus actually has lilbee.md.
    beat(
      "Ensure the add fired",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        if (!p) return;
        const busy = p.taskQueue.activeAll.length + p.taskQueue.queued.length;
        if (busy === 0) {
          document.querySelectorAll('.modal-container').forEach(m => m.remove());
          const file = window.app.vault.getFiles().find(f => f.path === 'lilbee.md');
          if (file) await p.addToLilbee(file);
        }
      `),
      { holdMs: 600 },
    ),
    beat(
      "Wait for ingest done",
      waitForActiveTasksToFinish(120, 500),
      { holdMs: 1000, speedup: 8 },
    ),
    beat(
      "Open chat with task center beside it at a readable 7:3 split",
      runJs(`
        // Detach existing lilbee leaves so we can re-build a fresh
        // chat+tasks split. Without this, the chat opens in whatever
        // small leaf the wizard left behind and the answer area gets
        // visually compressed against the task center.
        for (const t of ['lilbee-chat', 'lilbee-tasks']) {
          window.app.workspace.detachLeavesOfType(t);
        }
        // Collapse sidebars so the demo has room.
        window.app.workspace.leftSplit?.collapse?.();
        window.app.workspace.rightSplit?.collapse?.();
        await new Promise(r => setTimeout(r, 200));
        const chat = window.app.workspace.getLeaf(true);
        await chat.setViewState({ type: 'lilbee-chat', active: true });
        const tasks = window.app.workspace.createLeafBySplit(chat, 'vertical', false);
        await tasks.setViewState({ type: 'lilbee-tasks', active: false });
        window.app.workspace.setActiveLeaf(chat);
        await new Promise(r => setTimeout(r, 250));
        // 7:3 split — same ratio chat-and-tasks layout uses.
        const splits = document.querySelectorAll('.workspace-split.mod-vertical');
        for (const s of Array.from(splits)) {
          const tabs = s.querySelectorAll(':scope > .workspace-tabs');
          if (tabs.length === 2) {
            tabs[0].style.flex = '7';
            tabs[1].style.flex = '3';
            break;
          }
        }
        // Wait for the chat textarea AND its parent leaf to be visible.
        for (let i = 0; i < 60; i++) {
          const ta = document.querySelector('textarea.lilbee-chat-textarea');
          if (ta && ta.offsetParent !== null) {
            ta.focus();
            ta.click();
            return;
          }
          await new Promise(r => setTimeout(r, 250));
        }
      `),
      { holdMs: 1200, speedup: 3 },
    ),
    // Belt-and-suspenders click on the textarea so OS focus is on it
    // before pyautogui types the question.
    beat(
      "Click the chat textarea to focus it",
      clickSelector("textarea.lilbee-chat-textarea"),
      { holdMs: 400 },
    ),
    beat(
      "Final wait for server readiness before sending the question",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        const url = p?.api?.baseUrl ?? p?.settings?.serverUrl;
        const tok = p?.api?.token ?? p?.settings?.manualToken;
        for (let i = 0; i < 60; i++) {
          try {
            const r = await fetch(url + "/api/health", { headers: tok ? { Authorization: "Bearer " + tok } : {} });
            const j = r.ok ? await r.json() : null;
            if (j && (j.status === "ok" || j.status === "ready")) return;
          } catch {}
          await new Promise(r => setTimeout(r, 500));
        }
      `),
      { holdMs: 500, speedup: 8 },
    ),
    beat("Ask a small-model-friendly question", fillChat(QUESTION), { holdMs: 600 }),
    beat("Send", clickSend(), { holdMs: 600 }),
    beat("Qwen3 0.6B streams the cited answer", waitChatIdle(180_000), { holdMs: 1600, speedup: 3 }),

    beat("Final hold on the answered chat", sleep(1500)),
  ],
});
