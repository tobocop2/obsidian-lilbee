"""Crawl demo: crawl the Caprice page + click through to the source.

Layout: file explorer left, chat + Task Center side-by-side in the
main pane (so neither is squished by sidebar geometry). All clicks
mouse-driven via the OS cursor.

Beats:
  1. Sidebars collapsed; open CrawlModal + paste the Caprice URL +
     click Crawl.
  2. Modal closes. Split the main pane horizontally: chat on the left,
     Task Center on the right (equal width). Expand the left sidebar
     so the file explorer is visible.
  3. The new ``lilbee/_web/.../index.md`` lands in the file explorer
     while the Task Center on the right fills with the crawl + sync
     tasks.
  4. Send "When was the 9C1 police package introduced?" -> cited 1986
     answer from the wiki page.
  5. Mouse-click the source chip -> SourcePreviewModal opens to the
     wiki markdown, scrolls through three positions to surface inline
     images.
"""
from __future__ import annotations

from _mouse import click_locator, click_selector
from _record import jitter_sleep, type_chunked, wait_for_idle
from _setup import prepare
from playwright.sync_api import Page

URL = "https://en.wikipedia.org/wiki/Chevrolet_Caprice"
QUESTION = "When was the 9C1 police package introduced?"


def run(page: Page) -> None:
    prepare(page)

    # Single main-pane chat for the modal beat; sidebars collapsed so
    # the modal lands centred without anything overlapping its inputs.
    page.evaluate('''async () => {
        const app = window.app;
        app.workspace.detachLeavesOfType('lilbee-wiki');
        app.workspace.detachLeavesOfType('lilbee-tasks');
        const existingMain = app.workspace.getLeavesOfType('lilbee-chat').find(
            l => l.getRoot && l.getRoot() === app.workspace.rootSplit
        );
        if (!existingMain) {
            for (const l of app.workspace.getLeavesOfType('lilbee-chat')) l.detach();
            const ribbonChat = document.querySelector('[aria-label="Open lilbee chat"]');
            if (ribbonChat) ribbonChat.click();
            await new Promise(r => setTimeout(r, 600));
        }
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) app.workspace.leftSplit.collapse();
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) app.workspace.rightSplit.collapse();
    }''')
    jitter_sleep(1.2)
    page.wait_for_selector('.lilbee-chat-mode-btn', timeout=15000)

    # Open crawl modal + paste URL + click Crawl. All mouse-driven.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:crawl")')
    jitter_sleep(1.2)
    url_input = page.locator('input.lilbee-crawl-url').first
    click_locator(page, url_input, duration=0.5)
    jitter_sleep(0.3)
    type_chunked(page, URL, prose=False)
    jitter_sleep(0.6)
    click_selector(page, '.modal-container button.mod-cta:has-text("Crawl")', duration=0.5)
    jitter_sleep(1.0)

    # Now expand the layout: file explorer left, Task Center as a
    # horizontal split in the main pane (right of the chat). Each gets
    # equal width so neither is squished.
    page.evaluate('''async () => {
        const app = window.app;
        if (app.workspace.leftSplit?.collapsed) app.workspace.leftSplit.expand();
        const explorer = app.workspace.getLeavesOfType('file-explorer')[0];
        if (explorer) app.workspace.revealLeaf(explorer);
        const chatLeaf = app.workspace.getLeavesOfType('lilbee-chat').find(
            l => l.getRoot && l.getRoot() === app.workspace.rootSplit
        );
        if (!chatLeaf) return;
        // Split horizontally to place the Task Center to the right of chat.
        const tasksLeaf = app.workspace.createLeafBySplit(chatLeaf, 'vertical', false);
        await tasksLeaf.setViewState({ type: 'lilbee-tasks', active: false });
        app.workspace.setActiveLeaf(chatLeaf);
    }''')
    jitter_sleep(1.2)

    # Wait for crawl + sync to settle.
    import re as _re
    import time as _time
    deadline_ms = 240_000
    t0 = _time.monotonic()
    while (_time.monotonic() - t0) * 1000 < deadline_ms:
        state = page.evaluate('''() => {
            const counters = document.querySelector('.lilbee-tasks-counters')?.innerText || "";
            const completed = document.querySelectorAll('.lilbee-tasks-section')[2];
            return { counters, completedText: (completed?.innerText || '').toLowerCase() };
        }''')
        m = _re.search(r'(\d+) running .* (\d+) queued .* (\d+) done', state.get("counters", ""))
        if m and int(m.group(1)) == 0 and int(m.group(2)) == 0 and int(m.group(3)) >= 1:
            if "caprice" in state.get("completedText", "") or "wikipedia" in state.get("completedText", ""):
                break
        page.wait_for_timeout(800)
    jitter_sleep(2.0)

    # Expand the lilbee/ folder so the audience clocks the new wiki
    # markdown landing in the vault.
    page.evaluate('''() => {
        document.querySelectorAll('.nav-folder-title').forEach(el => {
            const p = el.getAttribute('data-path');
            if (p && (p === 'lilbee' || p.startsWith('lilbee/_web'))) {
                if (el.parentElement?.classList.contains('is-collapsed')) el.click();
            }
        });
    }''')
    jitter_sleep(3.5)

    # Send the question.
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
    jitter_sleep(0.6)
    page.keyboard.press("Enter")
    wait_for_idle(page, '.lilbee-chat-message.assistant', idle_for=3.0, timeout=120.0)
    jitter_sleep(2.0)

    # Open Sources expander, mouse-click the first source chip.
    page.evaluate('''() => {
        document.querySelectorAll('.workspace-leaf').forEach(leaf => {
            if (getComputedStyle(leaf).display === 'none') return;
            leaf.querySelectorAll('details').forEach(d => d.open = true);
        });
    }''')
    jitter_sleep(0.8)
    chip = page.locator('.lilbee-source-chip-loc').first
    click_locator(page, chip, duration=0.5)
    jitter_sleep(3.0)

    # Scroll the source preview through three positions so an image
    # lands in frame alongside body text.
    for offset in (1500, 3000, 4500):
        page.evaluate(f'''() => {{
            const host = document.querySelector('.lilbee-preview-host');
            if (host) host.scrollTop = {offset};
        }}''')
        jitter_sleep(2.0)

    jitter_sleep(1.0)
