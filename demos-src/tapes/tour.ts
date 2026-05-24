/**
 * tour demo: a longer walk through every lilbee surface in a used vault —
 * file explorer, the model catalog (browsing + the pull flow), adding a
 * file, and a cited chat answer, then settings. No wiki.
 *
 * The catalog step opens the "Download model?" confirmation to show how a
 * pull starts, then dismisses it rather than actually downloading: a real
 * pull auto-activates the chosen model, and pulling an embedding model in
 * particular swaps the active embedder out from under the nomic-embedded
 * corpus (dimension mismatch → retrieval breaks). The full download is
 * shown end-to-end in the first_start demo instead.
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
    beat("Opening hold: file explorer + chat + tasks", sleep(900)),

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
    beat("Walk the Chat tab", clickSelector(`${CATALOG_TABS} button:text-is("Chat")`), { holdMs: 800 }),
    beat("Walk the Embed tab", clickSelector(`${CATALOG_TABS} button:text-is("Embed")`), { holdMs: 800 }),
    beat("Walk the Vision tab", clickSelector(`${CATALOG_TABS} button:text-is("Vision")`), { holdMs: 800 }),
    beat("Back to the Chat tab", clickSelector(`${CATALOG_TABS} button:text-is("Chat")`), { holdMs: 700 }),
    beat("Click the catalog search", clickSelector(CATALOG_SEARCH), { holdMs: 400 }),
    beat("Search for a model", type_("Phi-4"), { holdMs: 1200 }),
    beat("Start a pull", clickSelector(".lilbee-catalog-pull"), { holdMs: 1000 }),
    // The "Download model?" confirm shows size + RAM fit. Hold on it to
    // show how a pull begins, then dismiss without downloading.
    beat("Hold on the download confirmation", sleep(1800)),
    beat("Dismiss the confirmation", key("escape"), { holdMs: 700 }),
    beat("Close the catalog", key("escape"), { holdMs: 600 }),

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
        p.settings.topK = 1;
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
    beat("Scroll settings #1", wheelScroll(SETTINGS_PANE, -24), { holdMs: 500 }),
    beat("Scroll settings #2", wheelScroll(SETTINGS_PANE, -24), { holdMs: 500 }),
    beat("Scroll settings #3", wheelScroll(SETTINGS_PANE, -24), { holdMs: 500 }),
    beat("Close settings", key("escape"), { holdMs: 500 }),
  ],
});
