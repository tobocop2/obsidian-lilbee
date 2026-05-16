"""Catalog demo: walk every tab, demonstrate infinite scroll, pull a model.

Beats:
  1. Open Catalog modal -- Discover tab is the default.
  2. Click each tab in order: Chat -> Embed -> Vision -> Rerank ->
     Library. Brief linger on each so the grid is visible.
  3. On the content-rich tabs, scroll the grid to surface infinite
     scroll (more cards mount as the bottom sentinel is observed).
  4. Search "gemma 2", click Pull on Gemma 2 2B (small enough that the
     pull lands fast on camera).
  5. Close the catalog modal -- reveals the Task Center pane that was
     pre-staged in the right sidebar with the in-flight pull task.
  6. Linger on the progress bar so the async-visibility beat is clear.
"""
from __future__ import annotations

from _record import jitter_sleep, type_chunked
from _setup import prepare
from playwright.sync_api import Page

TABS_TO_WALK = ["Chat", "Embed", "Vision", "Rerank", "Library"]
PULL_MODEL = {"hf_repo": "bartowski/gemma-2-2b-it-GGUF", "search": "gemma 2"}


def _click_tab(page: Page, label: str) -> None:
    page.evaluate(f'''() => {{
        const buttons = document.querySelectorAll('.modal-container button');
        for (const b of buttons) {{
            if (b.innerText.trim() === {label!r}) {{ b.click(); return; }}
        }}
    }}''')


def run(page: Page) -> None:
    prepare(page)

    # Pre-stage the right sidebar with a freshly cleared Task Center so
    # the pull task lands in an empty COMPLETED section when the catalog
    # modal closes.
    page.evaluate('''async () => {
        const app = window.app;
        if (app.workspace.rightSplit?.collapsed) app.workspace.rightSplit.expand();
    }''')
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:tasks")')
    jitter_sleep(0.8)
    try:
        page.locator('.lilbee-tasks-clear').first.click(timeout=1500)
        jitter_sleep(0.4)
    except Exception:
        pass

    # Open catalog.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:catalog")')
    jitter_sleep(2.0)

    for tab in TABS_TO_WALK:
        _click_tab(page, tab)
        jitter_sleep(2.6)
        if tab in ("Chat", "Library"):
            page.evaluate('''() => {
                const grid = document.querySelector('.lilbee-catalog-body');
                if (grid) grid.scrollBy({ top: 600, behavior: 'smooth' });
            }''')
            jitter_sleep(2.0)
            page.evaluate('''() => {
                const grid = document.querySelector('.lilbee-catalog-body');
                if (grid) grid.scrollBy({ top: 600, behavior: 'smooth' });
            }''')
            jitter_sleep(2.0)

    # Back to Chat to do the pull demo.
    _click_tab(page, "Chat")
    jitter_sleep(1.5)
    page.evaluate('''() => {
        const grid = document.querySelector('.lilbee-catalog-body');
        if (grid) grid.scrollTo({ top: 0, behavior: 'smooth' });
    }''')
    jitter_sleep(1.0)

    search = page.locator('input.lilbee-catalog-search').first
    search.click()
    jitter_sleep(0.3)
    type_chunked(page, PULL_MODEL["search"], prose=False)
    jitter_sleep(2.5)

    page.evaluate(f'''() => {{
        const card = document.querySelector('.lilbee-model-card[data-repo="{PULL_MODEL["hf_repo"]}"]');
        card?.querySelector('.lilbee-catalog-pull')?.click();
    }}''')
    jitter_sleep(1.5)

    # ConfirmPullModal -- accept it.
    try:
        page.locator('.modal-container button.mod-cta').first.click(timeout=1500)
        jitter_sleep(0.8)
    except Exception:
        pass

    # Close the catalog so the Task Center pane is the focus.
    page.keyboard.press("Escape")
    jitter_sleep(1.0)

    # Linger on the in-flight pull task in the Task Center.
    jitter_sleep(8.0)
