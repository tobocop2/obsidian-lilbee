"""Lilbee-on-lilbee demo: ingest lilbee's own README + ask about it.

The vault has ``Code/lilbee-README.md`` -- a slice of lilbee's
documentation -- that the demo lilbee server hasn't seen yet. Demo:

  1. Layout: file explorer left, chat main, Task Center right.
  2. Click Code/lilbee-README.md in the file explorer so the README
     opens in the main pane (the audience sees the actual content
     about to be indexed).
  3. Trigger lilbee:add-file -> watch the Task Center ingest task.
  4. Switch to chat + ask "What is lilbee in one sentence?" -> cited
     answer that quotes the README.
"""
from __future__ import annotations

from _mouse import click_locator, click_selector
from _record import jitter_sleep, type_chunked, wait_for_idle
from _setup import prepare
from playwright.sync_api import Page

README_PATH = "Code/lilbee-README.md"
QUESTION = "What is lilbee in one sentence?"


def run(page: Page) -> None:
    prepare(page)

    page.evaluate('''async () => {
        const app = window.app;
        app.workspace.detachLeavesOfType('lilbee-wiki');
        app.workspace.detachLeavesOfType('lilbee-tasks');
        const rootChat = app.workspace.getLeavesOfType('lilbee-chat').find(
            l => l.getRoot && l.getRoot() === app.workspace.rootSplit
        );
        if (!rootChat) {
            for (const l of app.workspace.getLeavesOfType('lilbee-chat')) l.detach();
            const ribbon = document.querySelector('[aria-label="Open lilbee chat"]');
            if (ribbon) ribbon.click();
            await new Promise(r => setTimeout(r, 600));
        }
        if (app.workspace.leftSplit?.collapsed) app.workspace.leftSplit.expand();
        if (app.workspace.rightSplit?.collapsed) app.workspace.rightSplit.expand();
        const explorer = app.workspace.getLeavesOfType('file-explorer')[0];
        if (explorer) app.workspace.revealLeaf(explorer);
    }''')
    jitter_sleep(1.2)
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:tasks")')
    jitter_sleep(0.6)
    try:
        click_selector(page, '.workspace-leaf-content[data-type="lilbee-tasks"] .lilbee-tasks-clear', duration=0.4)
        jitter_sleep(0.3)
    except Exception:
        pass

    # Expand Code/ folder so the README is reachable.
    page.evaluate('''() => {
        document.querySelectorAll('.nav-folder-title').forEach(el => {
            if (el.getAttribute('data-path') === 'Code' && el.parentElement?.classList.contains('is-collapsed')) {
                el.click();
            }
        });
    }''')
    jitter_sleep(0.8)

    # Mouse-click the README so it opens in the main pane.
    target = page.locator(f'.nav-file-title[data-path="{README_PATH}"]').first
    target.scroll_into_view_if_needed()
    click_locator(page, target, duration=0.5)
    jitter_sleep(2.5)

    # Ingest it.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:add-file")')
    jitter_sleep(1.0)
    try:
        click_selector(page, '.modal-container button:has-text("Continue")', duration=0.4)
        jitter_sleep(0.6)
    except Exception:
        pass

    # Wait for ingest.
    import re as _re
    import time as _time
    t0 = _time.monotonic()
    while _time.monotonic() - t0 < 120:
        counters = page.evaluate('() => document.querySelector(".lilbee-tasks-counters")?.innerText || ""')
        m = _re.search(r'(\d+) running .* (\d+) queued .* (\d+) done', counters)
        if m and int(m.group(1)) == 0 and int(m.group(2)) == 0 and int(m.group(3)) >= 1:
            break
        page.wait_for_timeout(700)
    jitter_sleep(2.0)

    # Bring chat into focus.
    page.evaluate('''() => {
        const chatLeaf = window.app.workspace.getLeavesOfType('lilbee-chat')
            .find(l => l.getRoot && l.getRoot() === window.app.workspace.rootSplit);
        if (chatLeaf) window.app.workspace.revealLeaf(chatLeaf);
    }''')
    page.wait_for_selector('.lilbee-chat-mode-btn', timeout=15000)

    try:
        click_selector(page, '.lilbee-chat-clear', duration=0.4)
        jitter_sleep(0.3)
    except Exception:
        pass
    search_btn = page.locator('.lilbee-chat-mode-btn:has-text("Search")').first
    if not search_btn.evaluate('el => el.classList.contains("active")'):
        click_locator(page, search_btn, duration=0.4)
        jitter_sleep(0.3)
    textarea = page.locator('textarea.lilbee-chat-textarea').first
    click_locator(page, textarea, duration=0.4)
    jitter_sleep(0.3)
    type_chunked(page, QUESTION, prose=True)
    jitter_sleep(0.5)
    page.keyboard.press("Enter")
    wait_for_idle(page, '.lilbee-chat-message.assistant', idle_for=3.0, timeout=120.0)
    jitter_sleep(3.0)
