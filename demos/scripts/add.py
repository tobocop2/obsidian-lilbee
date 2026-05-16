"""Add-a-file demo: right-click a vault file, "Add to lilbee", ask about it.

Stages a fresh note in the vault (via `vault.create`), expands its parent
folder in the file explorer, right-clicks it to surface the "Add to
lilbee" context-menu entry, then switches to chat and asks about the
file's distinctive content.

This proves the differentiator: any vault file becomes a citable source
in one click, with no manual sync step.
"""
from __future__ import annotations

from _record import jitter_sleep, type_chunked, wait_for_idle
from playwright.sync_api import Page

FILE_PATH = "Notes/Quick add demo.md"
FILE_BODY = """# Quick add demo

When chatting with lilbee about kayak portage tips, remember these three
rules I picked up at the Algonquin outfitter:

1. Always carry the kayak above your shoulder, not on top of it -- you
   lose less energy fighting the weight on long carries.
2. Tape the gunwale where the yoke sits, otherwise the paint chips off
   inside two trips.
3. Drop the rudder before launching; raising it underwater snaps the
   pull-cord every time.

The outfitter's name was Alex; their shop is on the Oxtongue river just
south of the park gate.
"""
QUESTION = "What does the Algonquin outfitter say about carrying a kayak?"


def run(page: Page) -> None:
    # Dark theme + fresh state. Drain any modal stack before the demo
    # touches the workspace -- a half-open modal-bg from a prior demo or
    # from the activate-via-System-Events flash intercepts clicks.
    page.evaluate('''() => { if (window.app?.setTheme) window.app.setTheme('obsidian'); }''')
    for _ in range(6):
        page.keyboard.press("Escape")
        page.wait_for_timeout(120)
    page.evaluate('''() => {
        document.querySelectorAll('.modal-bg').forEach(el => el.click());
        document.querySelectorAll('.modal-close-button').forEach(el => el.click());
    }''')
    jitter_sleep(0.4)

    # Layout: file explorer on the left, no chat/wiki/tasks open. Single
    # main-pane file (whichever opens by default) is fine.
    page.evaluate('''async () => {
        const app = window.app;
        app.workspace.detachLeavesOfType('lilbee-chat');
        app.workspace.detachLeavesOfType('lilbee-tasks');
        app.workspace.detachLeavesOfType('lilbee-wiki');
        if (app.workspace.leftSplit?.collapsed) app.workspace.leftSplit.expand();
        if (!app.workspace.rightSplit?.collapsed) app.workspace.rightSplit.collapse();
        const explorer = app.workspace.getLeavesOfType('file-explorer')[0];
        if (explorer) app.workspace.revealLeaf(explorer);
    }''')
    jitter_sleep(1.0)

    # Stage the new file: delete a stale copy if present, then create it
    # with the demo body. The plugin's vault watcher won't auto-add it.
    page.evaluate(f'''async () => {{
        const app = window.app;
        const existing = app.vault.getAbstractFileByPath({FILE_PATH!r});
        if (existing) {{ await app.vault.delete(existing); }}
        await app.vault.create({FILE_PATH!r}, {FILE_BODY!r});
    }}''')
    jitter_sleep(1.0)

    # Expand the Notes/ folder so the new file is visible.
    page.evaluate('''() => {
        const notes = document.querySelector('.nav-folder-title[data-path="Notes"]');
        if (notes && notes.parentElement?.classList.contains('is-collapsed')) {
            notes.click();
        }
    }''')
    jitter_sleep(1.5)

    # Reveal-in-explorer the new file (also scrolls it into view).
    page.evaluate(f'''() => {{
        const app = window.app;
        const file = app.vault.getAbstractFileByPath({FILE_PATH!r});
        if (file) {{
            const fileExplorer = app.workspace.getLeavesOfType('file-explorer')[0]?.view;
            if (fileExplorer?.revealInFolder) fileExplorer.revealInFolder(file);
        }}
    }}''')
    jitter_sleep(1.5)

    # Open the file in the main pane via the workspace API (Playwright's
    # synthetic click hits an opaque ``.modal-bg`` overlay that Electron
    # sometimes paints around new windows after a System-Events focus
    # change). The workspace.openLinkText flow is what Obsidian's own
    # double-click handler routes to anyway.
    page.evaluate(f'''() => {{
        const app = window.app;
        const file = app.vault.getAbstractFileByPath({FILE_PATH!r});
        if (file) {{
            const leaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(false);
            leaf.openFile(file);
        }}
    }}''')
    jitter_sleep(1.5)

    # Trigger the Add command via the registered command id. This is the
    # same code path the file-menu "Add to lilbee" entry runs; bypassing
    # the right-click flow keeps the script robust to Electron's
    # contextmenu-event quirks.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:add-file")')
    jitter_sleep(1.0)

    # The vault watcher may have already ingested the file when
    # vault.create ran, in which case lilbee surfaces a "Re-add it?"
    # confirmation. Click Continue when present so the demo proceeds
    # regardless of prior index state.
    try:
        page.locator('.modal-container button:has-text("Continue")').first.click(timeout=1500)
        jitter_sleep(0.8)
    except Exception:
        pass

    # Pop the Task Center via the ribbon so the recorded frames include
    # the in-flight task row.
    page.locator('[aria-label="Open lilbee Task Center"]').first.click()
    jitter_sleep(2.0)

    # Wait for the add task to complete (counters drop to 0 running).
    import re as _re
    import time as _time
    t0 = _time.monotonic()
    while (_time.monotonic() - t0) < 90:
        counters = page.evaluate('''() => document.querySelector('.lilbee-tasks-counters')?.innerText || ""''')
        m = _re.search(r'(\d+) running .* (\d+) queued .* (\d+) done', counters)
        if m and int(m.group(1)) == 0 and int(m.group(2)) == 0 and int(m.group(3)) >= 1:
            break
        page.wait_for_timeout(700)
    jitter_sleep(1.5)

    # Switch to chat as a focused single pane (collapse sidebars now).
    page.evaluate('''async () => {
        const app = window.app;
        app.workspace.detachLeavesOfType('lilbee-tasks');
        let chatLeaf = app.workspace.getLeavesOfType('lilbee-chat').find(
            l => l.getRoot && l.getRoot() === app.workspace.rootSplit
        );
        if (!chatLeaf) {
            chatLeaf = app.workspace.getMostRecentLeaf();
            if (chatLeaf) {
                await chatLeaf.setViewState({ type: 'lilbee-chat', active: true });
            }
        }
        const closeOthers = (split) => {
            if (!split || !split.children) return;
            for (const child of [...split.children]) {
                if (child === chatLeaf) continue;
                if (child.children) closeOthers(child);
                else if (child.detach && child !== chatLeaf) child.detach();
            }
        };
        closeOthers(app.workspace.rootSplit);
        if (chatLeaf) app.workspace.revealLeaf(chatLeaf);
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) app.workspace.leftSplit.collapse();
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) app.workspace.rightSplit.collapse();
    }''')
    jitter_sleep(1.2)

    # Clear, switch to Chat mode, send the kayak question.
    try:
        page.locator('.lilbee-chat-clear').first.click(timeout=1500)
        jitter_sleep(0.3)
    except Exception:
        pass
    chat_btn = page.locator('.lilbee-chat-mode-btn:has-text("Chat")').first
    if not chat_btn.evaluate('el => el.classList.contains("active")'):
        chat_btn.click()
        jitter_sleep(0.3)
    textarea = page.locator('textarea.lilbee-chat-textarea').first
    textarea.click()
    jitter_sleep(0.3)
    type_chunked(page, QUESTION, prose=True)
    jitter_sleep(0.4)
    page.keyboard.press("Enter")
    wait_for_idle(page, '.lilbee-chat-message.assistant', idle_for=3.0, timeout=90.0)
    jitter_sleep(2.5)

    # Open the Sources expander so the chip for the new file is visible.
    try:
        page.locator('.lilbee-chat-sources summary, .lilbee-chat-sources [role="button"]').first.click(timeout=2000)
        jitter_sleep(1.0)
    except Exception:
        pass
    jitter_sleep(2.0)
