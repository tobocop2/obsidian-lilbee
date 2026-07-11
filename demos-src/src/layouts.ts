/**
 * Canonical workspace layouts.
 *
 * Each demo declares a layout in its storyboard header (defaults to
 * ``chat-and-tasks``). The runner applies it before any beats run, so
 * every demo starts from the same known-clean state.
 *
 * The layout JS is shipped as a string and run via ``page.evaluate``
 * inside Obsidian's page context. We can't pass a TS function because
 * tsx's runtime helpers (e.g. ``__name``) aren't in scope inside the
 * target page.
 */
import type { Page } from "playwright";

export type LayoutName =
  | "chat-and-tasks"
  | "chat-solo"
  | "blank"
  | "file-explorer-and-chat"
  | "explorer-chat-tasks"
  | "explorer-note-tasks"
  | "placement-and-tasks"
  | "placement-and-chat"
  | "explorer-placement-chat"
  | "explorer-placement"
  | "placement-full";

const SHARED_PRELUDE = `
  const app = window.app;
  app.vault.setConfig?.('theme', 'obsidian');

  // Detach every lilbee leaf.
  for (const t of ['lilbee-chat', 'lilbee-tasks', 'lilbee-wiki']) {
    app.workspace.detachLeavesOfType(t);
  }

  // Drain every leaf in the root (main) pane.
  const collect = (s, out) => {
    if (!s) return;
    if (!s.children) { out.push(s); return; }
    for (const c of s.children) collect(c, out);
  };
  const mainLeaves = [];
  collect(app.workspace.rootSplit, mainLeaves);
  for (const l of mainLeaves) l.detach?.();
  await new Promise(r => setTimeout(r, 200));

  const setLeftCollapsed = (collapsed) => {
    const s = app.workspace.leftSplit;
    if (!s) return;
    if (collapsed && !s.collapsed) s.collapse?.();
    if (!collapsed && s.collapsed) s.expand?.();
  };
  const setRightCollapsed = (collapsed) => {
    const s = app.workspace.rightSplit;
    if (!s) return;
    if (collapsed && !s.collapsed) s.collapse?.();
    if (!collapsed && s.collapsed) s.expand?.();
  };
  const sizeSplitChildren = (ratios) => {
    const splits = document.querySelectorAll('.workspace-split.mod-vertical');
    for (const split of Array.from(splits)) {
      const tabs = split.querySelectorAll(':scope > .workspace-tabs');
      if (tabs.length === ratios.length) {
        ratios.forEach((r, i) => { tabs[i].style.flex = String(r); });
        break;
      }
    }
  };
`;

const LAYOUT_BODY: Record<LayoutName, string> = {
  "chat-and-tasks": `
    setLeftCollapsed(true);
    setRightCollapsed(true);
    const chat = app.workspace.getLeaf(true);
    await chat.setViewState({ type: 'lilbee-chat', active: true });
    const tasks = app.workspace.createLeafBySplit(chat, 'vertical', false);
    await tasks.setViewState({ type: 'lilbee-tasks', active: false });
    app.workspace.setActiveLeaf(chat);
    await new Promise(r => setTimeout(r, 250));
    sizeSplitChildren([7, 3]);
  `,
  blank: `
    setLeftCollapsed(true);
    setRightCollapsed(true);
  `,
  "chat-solo": `
    setLeftCollapsed(true);
    setRightCollapsed(true);
    const chat = app.workspace.getLeaf(true);
    await chat.setViewState({ type: 'lilbee-chat', active: true });
    app.workspace.setActiveLeaf(chat);
  `,
  "file-explorer-and-chat": `
    setLeftCollapsed(false);
    setRightCollapsed(true);
    const chat = app.workspace.getLeaf(true);
    await chat.setViewState({ type: 'lilbee-chat', active: true });
    app.workspace.setActiveLeaf(chat);
  `,
  "explorer-chat-tasks": `
    // File explorer left (visible), chat + tasks split in main pane.
    setLeftCollapsed(false);
    setRightCollapsed(true);
    const explorer = app.workspace.getLeavesOfType('file-explorer')[0];
    if (explorer) app.workspace.revealLeaf(explorer);
    const chat = app.workspace.getLeaf(true);
    await chat.setViewState({ type: 'lilbee-chat', active: true });
    const tasks = app.workspace.createLeafBySplit(chat, 'vertical', false);
    await tasks.setViewState({ type: 'lilbee-tasks', active: false });
    app.workspace.setActiveLeaf(chat);
    await new Promise(r => setTimeout(r, 250));
    sizeSplitChildren([7, 3]);
  `,
  "explorer-note-tasks": `
    // File explorer left, a vault note in the main pane, Task Center to its
    // right. No chat pane — used by multi_vault, where the chat would show a
    // "not serving this vault" state before the switch.
    setLeftCollapsed(false);
    setRightCollapsed(true);
    const explorer = app.workspace.getLeavesOfType('file-explorer')[0];
    if (explorer) app.workspace.revealLeaf(explorer);
    const md = app.vault.getMarkdownFiles().sort((a, b) => a.path.localeCompare(b.path));
    const pick = md.find(f => /readme/i.test(f.path)) || md[0];
    const note = app.workspace.getLeaf(true);
    if (pick) await note.openFile(pick, { active: true });
    const tasks = app.workspace.createLeafBySplit(note, 'vertical', false);
    await tasks.setViewState({ type: 'lilbee-tasks', active: false });
    app.workspace.setActiveLeaf(note);
    await new Promise(r => setTimeout(r, 250));
    sizeSplitChildren([7, 3]);
  `,
  "placement-and-tasks": `
    // GPU placement in the main pane, Task Center to its right. Used by the
    // multi-GPU ingest reels: the placement bars and the task progress are
    // both on screen as the codebase indexes.
    setLeftCollapsed(true);
    setRightCollapsed(true);
    const placement = app.workspace.getLeaf(true);
    await placement.setViewState({ type: 'lilbee-placement', active: true });
    const tasks = app.workspace.createLeafBySplit(placement, 'vertical', false);
    await tasks.setViewState({ type: 'lilbee-tasks', active: false });
    app.workspace.setActiveLeaf(placement);
    await new Promise(r => setTimeout(r, 250));
    sizeSplitChildren([6, 4]);
    // Wait for the GPU rows to render so the opening frame isn't blank.
    for (let i = 0; i < 60; i++) {
      if (document.querySelector('.lilbee-gpu-row')) break;
      await new Promise(r => setTimeout(r, 100));
    }
  `,
  "placement-and-chat": `
    // GPU placement in the main pane, chat to its right. For the chat reel:
    // the answer streams while the placement bars light up across every card.
    setLeftCollapsed(true);
    setRightCollapsed(true);
    const placement = app.workspace.getLeaf(true);
    await placement.setViewState({ type: 'lilbee-placement', active: false });
    const chat = app.workspace.createLeafBySplit(placement, 'vertical', false);
    await chat.setViewState({ type: 'lilbee-chat', active: true });
    app.workspace.setActiveLeaf(chat);
    await new Promise(r => setTimeout(r, 250));
    sizeSplitChildren([5, 5]);
    for (let i = 0; i < 60; i++) {
      if (document.querySelector('.lilbee-gpu-row')) break;
      await new Promise(r => setTimeout(r, 100));
    }
  `,
  "explorer-placement-chat": `
    // File explorer left (for the right-click "Add to lilbee"), GPU placement in
    // the main pane, chat split to its right — the bars stay live while a vault
    // folder is added and while the answer streams.
    setLeftCollapsed(false);
    setRightCollapsed(true);
    const explorer = app.workspace.getLeavesOfType('file-explorer')[0];
    if (explorer) app.workspace.revealLeaf(explorer);
    const placement = app.workspace.getLeaf(true);
    await placement.setViewState({ type: 'lilbee-placement', active: false });
    const chat = app.workspace.createLeafBySplit(placement, 'vertical', false);
    await chat.setViewState({ type: 'lilbee-chat', active: true });
    app.workspace.setActiveLeaf(placement);
    await new Promise(r => setTimeout(r, 250));
    sizeSplitChildren([5, 5]);
    for (let i = 0; i < 60; i++) {
      if (document.querySelector('.lilbee-gpu-row')) break;
      await new Promise(r => setTimeout(r, 100));
    }
  `,
  "explorer-placement": `
    // File explorer left (for the right-click "Add to lilbee"), GPU placement
    // full in the main pane. The tape splits in the Task Center once files are
    // adding, then swaps that for chat once they're embedded.
    setLeftCollapsed(false);
    setRightCollapsed(true);
    const explorer = app.workspace.getLeavesOfType('file-explorer')[0];
    if (explorer) app.workspace.revealLeaf(explorer);
    const placement = app.workspace.getLeaf(true);
    await placement.setViewState({ type: 'lilbee-placement', active: true });
    app.workspace.setActiveLeaf(placement);
    for (let i = 0; i < 60; i++) {
      if (document.querySelector('.lilbee-gpu-row')) break;
      await new Promise(r => setTimeout(r, 100));
    }
  `,
  "placement-full": `
    // GPU placement view alone, full width. For the "model too big for one
    // card" reel: all cards and the role matrix on screen at once.
    setLeftCollapsed(true);
    setRightCollapsed(true);
    const placement = app.workspace.getLeaf(true);
    await placement.setViewState({ type: 'lilbee-placement', active: true });
    app.workspace.setActiveLeaf(placement);
    for (let i = 0; i < 60; i++) {
      if (document.querySelector('.lilbee-gpu-row')) break;
      await new Promise(r => setTimeout(r, 100));
    }
  `,
};

export async function applyLayout(page: Page, layout: LayoutName): Promise<void> {
  const body = LAYOUT_BODY[layout];
  // Wrap in an async IIFE so the prelude + body can use await freely.
  const js = `(async () => {\n${SHARED_PRELUDE}\n${body}\n  app.workspace.requestSaveLayout?.();\n})()`;
  await page.evaluate(js);
  await page.waitForTimeout(450);
}
