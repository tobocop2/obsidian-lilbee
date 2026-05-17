"""Crawl demo: pull a Wikipedia page into the corpus, then ask about it.

Beats:
  1. Sidebars collapsed; open CrawlModal, paste the Caprice URL, Crawl.
  2. Modal closes. Expand the right sidebar with the Task Center and
     the left sidebar with the file explorer so the audience sees the
     crawl + sync tasks land AND the new lilbee/_web/.../index.md file
     appear in the vault tree side by side.
  3. Collapse the left sidebar (so the chat has room) and ask
     "When was the 9C1 police package introduced?" -> cited answer
     pointing at the wiki page.
  4. Click the source chip -> SourcePreviewModal opens to the wiki
     markdown with inline images. Scroll to surface body + image.
"""
from __future__ import annotations

from _record import jitter_sleep, type_chunked, wait_for_idle
from _setup import prepare
from playwright.sync_api import Page

URL = "https://en.wikipedia.org/wiki/Chevrolet_Caprice"
QUESTION = "When was the 9C1 police package introduced?"


def run(page: Page) -> None:
    prepare(page)

    # Sidebars collapsed for the modal beat (avoids click-overlap with the
    # file explorer / right sidebar geometry while the modal is open).
    page.evaluate('''async () => {
        const app = window.app;
        app.workspace.detachLeavesOfType('lilbee-wiki');
        app.workspace.detachLeavesOfType('lilbee-tasks');
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) app.workspace.leftSplit.collapse();
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) app.workspace.rightSplit.collapse();
        // Make sure exactly one chat exists in the main pane. Prefer an
        // existing main-pane chat; fall back to repurposing the most
        // recent main-pane leaf.
        const existingChat = app.workspace.getLeavesOfType('lilbee-chat').find(
            l => l.getRoot && l.getRoot() === app.workspace.rootSplit
        );
        let chatLeaf = existingChat;
        if (!chatLeaf) {
            // Detach sidebar chats then claim the most-recent main leaf.
            for (const l of app.workspace.getLeavesOfType('lilbee-chat')) l.detach();
            chatLeaf = app.workspace.getMostRecentLeaf();
            if (!chatLeaf || (chatLeaf.getRoot && chatLeaf.getRoot() !== app.workspace.rootSplit)) {
                // Root split is empty -- ribbon-click the chat icon as a
                // last resort (creates a fresh main-pane leaf reliably).
                document.querySelector('[aria-label="Open lilbee chat"]')?.click();
                await new Promise(r => setTimeout(r, 400));
                chatLeaf = app.workspace.getLeavesOfType('lilbee-chat').find(
                    l => l.getRoot && l.getRoot() === app.workspace.rootSplit
                ) || app.workspace.getLeavesOfType('lilbee-chat')[0];
            } else {
                await chatLeaf.setViewState({ type: 'lilbee-chat', active: true });
            }
        }
        if (chatLeaf) app.workspace.revealLeaf(chatLeaf);
    }''')
    jitter_sleep(1.2)
    page.wait_for_selector('.lilbee-chat-mode-btn', timeout=15000)

    # Open the crawl modal (centered, sidebars collapsed).
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:crawl")')
    jitter_sleep(1.2)
    url_input = page.locator('input.lilbee-crawl-url').first
    url_input.click()
    jitter_sleep(0.3)
    type_chunked(page, URL, prose=False)
    jitter_sleep(0.6)
    page.locator('.modal-container button.mod-cta:has-text("Crawl")').first.click()
    jitter_sleep(1.0)

    # Open the Task Center on the right + file explorer on the left so
    # both the in-flight task and the soon-to-appear file are visible.
    page.evaluate('''() => {
        const app = window.app;
        if (app.workspace.rightSplit?.collapsed) app.workspace.rightSplit.expand();
        if (app.workspace.leftSplit?.collapsed) app.workspace.leftSplit.expand();
        const explorer = app.workspace.getLeavesOfType('file-explorer')[0];
        if (explorer) app.workspace.revealLeaf(explorer);
    }''')
    jitter_sleep(0.6)
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:tasks")')
    jitter_sleep(1.0)

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

    # Expand the lilbee/ folder in the file explorer so the audience
    # clocks the new wiki page inside the vault.
    page.evaluate('''() => {
        const exp = window.app.workspace.getLeavesOfType('file-explorer')[0]?.view;
        if (exp?.requestSort) exp.requestSort();
        document.querySelectorAll('.nav-folder-title').forEach(el => {
            const p = el.getAttribute('data-path');
            if (p && (p === 'lilbee' || p.startsWith('lilbee/_web') || p.startsWith('lilbee/_web/'))) {
                if (el.parentElement?.classList.contains('is-collapsed')) el.click();
            }
        });
    }''')
    jitter_sleep(4.0)

    # Collapse the left sidebar so the chat has room for the answer beat.
    page.evaluate('''() => {
        const app = window.app;
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) app.workspace.leftSplit.collapse();
    }''')
    jitter_sleep(0.8)

    # Ask the question.
    try:
        page.locator('.lilbee-chat-clear').first.click(timeout=1500)
        jitter_sleep(0.4)
    except Exception:
        pass
    search_btn = page.locator('.lilbee-chat-mode-btn:has-text("Search")').first
    if not search_btn.evaluate('el => el.classList.contains("active")'):
        search_btn.click()
        jitter_sleep(0.4)
    textarea = page.locator('textarea.lilbee-chat-textarea').first
    textarea.click()
    jitter_sleep(0.3)
    type_chunked(page, QUESTION, prose=True)
    jitter_sleep(0.6)
    page.keyboard.press("Enter")
    wait_for_idle(page, '.lilbee-chat-message.assistant', idle_for=3.0, timeout=120.0)
    jitter_sleep(2.0)

    # Open Sources expander + click the chip. The Wikipedia chip routes
    # through openLinkText (it's a vault file), so the wiki markdown opens
    # in the main pane -- replacing the chat with the actual page,
    # complete with inline images.
    page.evaluate('''() => {
        document.querySelectorAll('.workspace-leaf').forEach(leaf => {
            if (getComputedStyle(leaf).display === 'none') return;
            leaf.querySelectorAll('details').forEach(d => d.open = true);
        });
    }''')
    jitter_sleep(0.8)
    # The aggregated source row uses a wrapper span with the filename
    # followed by per-chunk ``open`` chips that actually carry the click
    # handlers. Click the first ``.lilbee-source-chip-loc``.
    page.evaluate('''() => {
        const leaves = document.querySelectorAll('.workspace-leaf');
        for (const leaf of leaves) {
            if (getComputedStyle(leaf).display === 'none') continue;
            const chip = leaf.querySelector('.lilbee-source-chip-loc');
            if (chip) { chip.click(); return; }
        }
    }''')
    jitter_sleep(3.0)

    # Scroll the source-preview body so an image (Wikipedia infobox or
    # article photo) + body text both land in frame. Use scrollTop= (sync)
    # instead of scrollBy(smooth) so the scroll happens before the
    # screencap, not via a queued animation.
    for offset in (1500, 3000, 4500):
        page.evaluate(f'''() => {{
            const host = document.querySelector('.lilbee-preview-host');
            if (host) host.scrollTop = {offset};
        }}''')
        jitter_sleep(2.0)

    jitter_sleep(1.0)
