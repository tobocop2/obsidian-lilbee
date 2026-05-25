/**
 * tour demo: a longer walk through every lilbee surface in a used vault —
 * file explorer, the model catalog (browsing + the pull flow), adding a
 * file, and a cited chat answer, then settings. No wiki.
 *
 * The catalog step starts a real chat-model download, watches it begin in
 * the Task Center, then cancels it — showing how a pull starts AND stops.
 * Cancelling a chat-model pull before it finishes leaves the active models
 * untouched (a completed pull auto-activates; an embedding-model pull in
 * particular would swap the embedder out from under the corpus). The full
 * download to completion is shown in the download_model demo.
 *
 * The README is removed in pre-flight so the "add current file" step is a
 * clean ingest; the "what is lilbee" question then cites it.
 */
import {
  beat,
  clickChip,
  clickSelector,
  clickSend,
  fillChat,
  key,
  runJs,
  sleep,
  storyboard,
  type_,
  waitChatIdle,
  wheelScroll,
} from "../src/lib.ts";

const CATALOG_TABS = ".lilbee-catalog-main-tab-bar";
const CATALOG_SEARCH = "input.lilbee-catalog-search";
const SETTINGS_PANE = ".vertical-tab-content";
const QUESTION = "What is lilbee in one sentence?";

const runViaPalette = (label: string, query: string, holdAfter = 1100) => [
  beat(`Open the command palette (${label})`, runJs(`window.app.commands.executeCommandById("command-palette:open");`), {
    holdMs: 500,
    keyHint: "⌘P",
  }),
  beat(`Type "${query}"`, type_(query), { holdMs: 1000 }),
  beat(`Run ${label}`, key("enter"), { holdMs: holdAfter }),
];

export default storyboard("tour", {
  window: [1400, 900],
  layout: "explorer-chat-tasks",
  preloadChatModel: true,
  clearTaskCenter: false,
  clearChat: true,
  // Remove the Notes file the add step ingests so it's a clean add. The
  // README stays in the corpus so the "what is lilbee" question cites it.
  freshIngest: ["Crown Vic upgrade log.md"],
  beats: [
    beat("Opening hold: file explorer + chat + tasks", sleep(300)),

    // --- 1. File explorer with the indexed documents ---
    beat(
      "Reveal the file explorer so the indexed documents are visible",
      runJs(`
        window.app.workspace.leftSplit?.expand?.();
        const fe = window.app.workspace.getLeavesOfType('file-explorer')[0];
        if (fe) window.app.workspace.revealLeaf(fe);
        await new Promise(r => setTimeout(r, 200));
      `),
      { holdMs: 1400 },
    ),

    // --- 2. Model catalog: browse, then show the pull flow ---
    ...runViaPalette("Browse model catalog", "Browse model catalog", 1100),
    // Browsing the catalog is a fast-forward (the catalog demo covers it in
    // full), so speed this contiguous run up rather than dwell on it.
    beat("Flick through the Chat models", wheelScroll(".lilbee-catalog-results", -48, true), { holdMs: 600, speedup: 2 }),
    beat("Walk the Embed tab", clickSelector(`${CATALOG_TABS} button:text-is("Embed")`), { holdMs: 700, speedup: 2 }),
    beat("Walk the Vision tab", clickSelector(`${CATALOG_TABS} button:text-is("Vision")`), { holdMs: 700, speedup: 2 }),
    beat("Back to the Chat tab", clickSelector(`${CATALOG_TABS} button:text-is("Chat")`), { holdMs: 700, speedup: 2 }),
    beat("Click the catalog search", clickSelector(CATALOG_SEARCH), { holdMs: 400 }),
    beat("Search for a chat model", type_("Phi-4"), { holdMs: 1200 }),
    beat("Click Download on the model card", clickSelector(".lilbee-catalog-pull"), { holdMs: 1200 }),
    // The "Download model?" confirm shows size + RAM fit; confirm it to
    // actually start the pull.
    beat("Confirm the download", clickSelector(".lilbee-confirm-pull-actions button.mod-cta"), { holdMs: 1000 }),
    beat("Close the catalog so the Task Center is in view", key("escape"), { holdMs: 800 }),
    // Watch the pull stream into the Task Center, then cancel it.
    beat(
      "Watch the download start in the Task Center",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        for (let i = 0; i < 40; i++) {
          if (tq.activeAll.some(t => t.type === 'pull')) break;
          await new Promise(r => setTimeout(r, 250));
        }
        await new Promise(r => setTimeout(r, 3000));
      `),
      { holdMs: 800 },
    ),
    beat("Cancel the download", clickSelector(".lilbee-task-row .lilbee-task-cancel"), { holdMs: 1800 }),

    // --- 3. Add a file to the corpus ---
    beat(
      "Open a Notes file in a new tab",
      runJs(`
        await window.app.workspace.openLinkText("Notes/Crown Vic upgrade log.md", '', 'tab');
        await new Promise(r => setTimeout(r, 250));
      `),
      { holdMs: 900 },
    ),
    ...runViaPalette("Add current file", "Add current file", 800),
    beat(
      "Task Center fills as the file ingests",
      runJs(`
        const tq = window.app.plugins.plugins.lilbee.taskQueue;
        let sawActive = false;
        for (let i = 0; i < 120; i++) {
          const busy = tq.activeAll.length + tq.queued.length;
          if (busy > 0) sawActive = true;
          if (sawActive && busy === 0) return;
          await new Promise(r => setTimeout(r, 300));
        }
      `),
      { holdMs: 1000, speedup: 4 },
    ),

    // --- 4. A cited chat answer ---
    beat(
      "Rebuild a clean chat + task center layout",
      runJs(`
        for (const leaf of window.app.workspace.getLeavesOfType('markdown')) leaf.detach();
        for (const leaf of window.app.workspace.getLeavesOfType('pdf')) leaf.detach();
        window.app.workspace.leftSplit?.collapse?.();
        const p = window.app.plugins.plugins.lilbee;
        window.__tourOrigTopK = p.settings.topK;
        p.settings.topK = 2;
        await p.saveSettings();
        const leaves = window.app.workspace.getLeavesOfType('lilbee-chat');
        if (leaves[0]) window.app.workspace.revealLeaf(leaves[0]);
        await new Promise(r => setTimeout(r, 400));
        const ta = document.querySelector('textarea.lilbee-chat-textarea');
        if (ta) ta.focus();
      `),
      { holdMs: 700 },
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
    beat("Send", clickSend(), { holdMs: 500 }),
    beat("Stream the cited answer", waitChatIdle(120_000), { holdMs: 1200, speedup: 4 }),
    beat(
      "Expand sources",
      runJs(`document.querySelectorAll('.lilbee-chat-sources details').forEach(d => d.open = true);`),
      { holdMs: 400 },
    ),
    beat("Click the citation chip", clickChip(0), { holdMs: 900, cursorParkTo: [1245, 520] }),
    beat(
      "Render the cited README and scroll past the logo into the body",
      runJs(`
        const leaf = window.app.workspace.activeLeaf;
        if (leaf && leaf.view?.getViewType?.() === 'markdown') {
          const s = leaf.getViewState();
          s.state = { ...s.state, mode: 'preview' };
          await leaf.setViewState(s);
          await new Promise(r => setTimeout(r, 400));
          // The top logo SVG renders broken in Obsidian; scroll down into the
          // body so the citation lands on real content, not the broken logo.
          const root = leaf.containerEl ?? document.querySelector('.workspace-leaf.mod-active');
          const sc = root?.querySelector('.markdown-preview-view') ?? root?.querySelector('.markdown-reading-view');
          if (sc) sc.scrollTo({ top: (sc.clientHeight || 700) * 1.1, behavior: 'smooth' });
        }
      `),
      { holdMs: 2200 },
    ),
    beat(
      "Restore the original top_k and close the source",
      runJs(`
        const p = window.app.plugins.plugins.lilbee;
        if (window.__tourOrigTopK !== undefined) { p.settings.topK = window.__tourOrigTopK; await p.saveSettings(); }
        for (const leaf of window.app.workspace.getLeavesOfType('markdown')) leaf.detach();
      `),
      { holdMs: 400 },
    ),

    // --- 5. Settings (open via palette; the status icon is a sync prompt) ---
    ...runViaPalette("Open settings", "Open settings", 1000),
    beat("Click the lilbee tab", clickSelector('.vertical-tab-nav-item:text-is("lilbee")'), { holdMs: 900 }),
    beat(
      "Expand every collapsible section",
      runJs(`document.querySelectorAll('.vertical-tab-content details').forEach(d => d.setAttribute('open',''));`),
      { holdMs: 300 },
    ),
    // The settings demo walks this surface in full; here just sweep it
    // quickly to show it exists.
    beat("Scroll settings #1", wheelScroll(SETTINGS_PANE, -24), { holdMs: 500, speedup: 2 }),
    beat("Scroll settings #2", wheelScroll(SETTINGS_PANE, -24), { holdMs: 500, speedup: 2 }),
    beat("Scroll settings #3", wheelScroll(SETTINGS_PANE, -24), { holdMs: 500, speedup: 2 }),
    beat("Close settings", key("escape"), { holdMs: 500 }),
  ],
});
