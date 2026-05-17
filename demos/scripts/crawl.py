"""Crawl demo: pull a Wikipedia page into the corpus, then ask about it.

Mirrors the lilbee TUI tui-crawl demo:
  - URL:      https://en.wikipedia.org/wiki/Chevrolet_Caprice
  - Question: "When was the 9C1 police package introduced?"
  - Expected: 1986 (the model year when the 9C1 sedan was introduced
              per the Wikipedia article).

Flow: Command Palette -> "lilbee: Crawl web page" -> CrawlModal -> paste
URL -> Crawl -> wait for "completed" status on the new task in the Task
Center sidebar -> open Chat -> ask the question -> cited answer.
"""
from __future__ import annotations

from _record import jitter_sleep, type_chunked, wait_for_idle
from _setup import prepare
from playwright.sync_api import Page

URL = "https://en.wikipedia.org/wiki/Chevrolet_Caprice"
QUESTION = "When was the 9C1 police package introduced?"


def run(page: Page) -> None:
    prepare(page)

    # Layout: chat in the main pane, Task Center pinned to the right
    # sidebar with the COMPLETED section cleared so the audience sees a
    # fresh "0 done" baseline before the crawl beat starts.
    page.evaluate('''async () => {
        const app = window.app;
        if (!app) return;
        app.workspace.detachLeavesOfType('lilbee-wiki');
        app.workspace.detachLeavesOfType('lilbee-tasks');
        // Main pane: a single chat leaf. Detach every prior chat first
        // so a leftover sidebar chat can't render alongside.
        app.workspace.detachLeavesOfType('lilbee-chat');
        const chatLeaf = app.workspace.getMostRecentLeaf();
        if (chatLeaf) {
            await chatLeaf.setViewState({ type: 'lilbee-chat', active: true });
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
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) {
            app.workspace.leftSplit.collapse();
        }
        // Right sidebar: Task Center, expanded.
        if (app.workspace.rightSplit?.collapsed) {
            app.workspace.rightSplit.expand();
        }
    }''')
    jitter_sleep(0.6)
    # Mount the Task Center in the right sidebar.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:tasks")')
    jitter_sleep(0.8)
    # Clear the COMPLETED section so the new crawl task is the only one
    # visible -- the audience sees the empty "0 done" then watches a
    # single task fill in.
    try:
        page.locator('.lilbee-tasks-clear').first.click(timeout=1500)
        jitter_sleep(0.4)
    except Exception:
        pass
    jitter_sleep(1.0)

    # Open the crawl modal via the command id directly.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:crawl")')
    jitter_sleep(1.2)

    # Paste the URL into the lilbee-crawl-url input.
    url_input = page.locator('input.lilbee-crawl-url').first
    url_input.click()
    jitter_sleep(0.3)
    type_chunked(page, URL, prose=False)
    jitter_sleep(0.8)

    # Click the Crawl button.
    page.locator('.modal-container button.mod-cta:has-text("Crawl")').first.click()
    jitter_sleep(1.0)

    # Modal closes; the Task Center has a COMPLETED section that fills when
    # the crawl finishes. Poll for the counters row ("N running . N queued
    # . N done") to settle at "0 running . 0 queued . >=1 done" with a
    # task whose label mentions Caprice / Chevrolet / wikipedia.
    deadline_ms = 180_000
    import re as _re
    import time as _time
    t0 = _time.monotonic()
    while (_time.monotonic() - t0) * 1000 < deadline_ms:
        state = page.evaluate('''() => {
            const counters = document.querySelector('.lilbee-tasks-counters')?.innerText || "";
            const completed = document.querySelectorAll('.lilbee-tasks-section')[2];
            const completedText = completed?.innerText.toLowerCase() || "";
            return { counters, completedText };
        }''')
        m = _re.search(r'(\d+) running .* (\d+) queued .* (\d+) done', state.get("counters", ""))
        if m:
            running, queued, done = int(m.group(1)), int(m.group(2)), int(m.group(3))
            label = state.get("completedText", "")
            if running == 0 and queued == 0 and done >= 1 and (
                "caprice" in label or "chevrolet" in label or "wikipedia" in label
            ):
                break
        page.wait_for_timeout(900)

    # Linger on the completed task before we move on.
    jitter_sleep(2.0)

    # Chat layout: re-mount via the plugin's idempotent activateChatView
    # in case the initial layout reset's leaf got reaped by the crawl
    # flow. activateChatView reveals the existing leaf if present or
    # creates a fresh one.
    page.evaluate('() => window.app.plugins.plugins.lilbee.activateChatView()')
    jitter_sleep(1.2)
    # Wait for the chat toolbar to render (async fetchAndFillSelectors).
    page.wait_for_selector('.lilbee-chat-mode-btn', timeout=15000)

    # Clear any prior chat content so the cited Caprice answer reads cleanly.
    try:
        page.locator('.lilbee-chat-clear').first.click(timeout=1500)
        jitter_sleep(0.4)
    except Exception:
        pass

    # Use Search mode (the chat-mode dispatch bug is filed separately).
    search_btn = page.locator('.lilbee-chat-mode-btn:has-text("Search")').first
    if not search_btn.evaluate('el => el.classList.contains("active")'):
        search_btn.click()
        jitter_sleep(0.4)

    # Send the question + wait for the streamed answer.
    textarea = page.locator('textarea.lilbee-chat-textarea').first
    textarea.click()
    jitter_sleep(0.3)
    type_chunked(page, QUESTION, prose=True)
    jitter_sleep(0.6)
    page.keyboard.press("Enter")
    wait_for_idle(page, '.lilbee-chat-message.assistant', idle_for=3.0, timeout=120.0)

    # Linger so the citation chip lands fully in the recorded frames.
    jitter_sleep(3.5)

    # Open the Sources expander so the chip (wikipedia URL) is visible.
    try:
        page.locator('.lilbee-chat-sources summary, .lilbee-chat-sources [role="button"]').first.click(timeout=2000)
        jitter_sleep(1.0)
    except Exception:
        pass
    jitter_sleep(2.0)
