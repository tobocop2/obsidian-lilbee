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
  | "blank"
  | "file-explorer-and-chat"
  | "explorer-chat-tasks";

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
};

export async function applyLayout(page: Page, layout: LayoutName): Promise<void> {
  const body = LAYOUT_BODY[layout];
  // Wrap in an async IIFE so the prelude + body can use await freely.
  const js = `(async () => {\n${SHARED_PRELUDE}\n${body}\n  app.workspace.requestSaveLayout?.();\n})()`;
  await page.evaluate(js);
  await page.waitForTimeout(450);
}
