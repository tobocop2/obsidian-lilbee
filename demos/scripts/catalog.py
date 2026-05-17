"""Catalog demo: mouse-walk every tab + demo infinite scroll on each.

Beats:
  1. Open Catalog modal (defaults to Discover).
  2. Mouse-click each tab in turn: Discover -> Chat -> Embed -> Vision
     -> Rerank -> Library. On every tab, mouse-wheel-scroll the grid to
     surface infinite-scroll loading more cards.
  3. Back to Chat, search ``gemma 2``, mouse-click Pull. Catalog
     closes and the Task Center on the right shows the live pull.
"""
from __future__ import annotations

from _mouse import click_locator, click_selector, scroll_at
from _record import jitter_sleep, type_chunked
from _setup import prepare
from playwright.sync_api import Page

TABS = ["Discover", "Chat", "Embed", "Vision", "Rerank", "Library"]
PULL_REPO = "bartowski/gemma-2-2b-it-GGUF"


def run(page: Page) -> None:
    prepare(page)

    # Pre-stage the right sidebar's Task Center so the pull progress
    # has somewhere to land when the catalog closes.
    page.evaluate('''() => {
        const app = window.app;
        if (app.workspace.rightSplit?.collapsed) app.workspace.rightSplit.expand();
    }''')
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:tasks")')
    jitter_sleep(0.8)
    try:
        click_selector(page, '.workspace-leaf-content[data-type="lilbee-tasks"] .lilbee-tasks-clear', duration=0.4)
        jitter_sleep(0.3)
    except Exception:
        pass

    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:catalog")')
    jitter_sleep(2.0)

    grid_box = page.evaluate(
        '() => { const g = document.querySelector(".lilbee-catalog-body");'
        ' const r = g?.getBoundingClientRect();'
        ' return r ? {cx: r.x + r.width/2, cy: r.y + r.height/2} : null; }'
    )
    for tab_label in TABS:
        tab_btn = page.locator(f'.modal-container button:text-is("{tab_label}")').first
        if tab_btn.count() == 0:
            continue
        click_locator(page, tab_btn, duration=0.4)
        jitter_sleep(1.8)
        if grid_box:
            scroll_at(page, grid_box["cx"], grid_box["cy"], dy=-12, steps=4)
            jitter_sleep(1.6)
            scroll_at(page, grid_box["cx"], grid_box["cy"], dy=-12, steps=4)
            jitter_sleep(1.6)
            scroll_at(page, grid_box["cx"], grid_box["cy"], dy=30, steps=6)
            jitter_sleep(0.6)

    chat_tab = page.locator('.modal-container button:text-is("Chat")').first
    click_locator(page, chat_tab, duration=0.4)
    jitter_sleep(1.2)

    search = page.locator('input.lilbee-catalog-search').first
    click_locator(page, search, duration=0.4)
    jitter_sleep(0.3)
    type_chunked(page, "gemma 2", prose=False)
    jitter_sleep(2.0)

    page.wait_for_selector(f'.lilbee-model-card[data-repo="{PULL_REPO}"]', timeout=10000)
    pull_btn = page.locator(f'.lilbee-model-card[data-repo="{PULL_REPO}"] .lilbee-catalog-pull').first
    if pull_btn.count() > 0:
        click_locator(page, pull_btn, duration=0.4)
        jitter_sleep(1.2)
        try:
            click_selector(page, '.modal-container button.mod-cta', duration=0.4)
            jitter_sleep(0.6)
        except Exception:
            pass

    close_btn = page.locator('.modal-container .modal-close-button').first
    if close_btn.count() > 0:
        click_locator(page, close_btn, duration=0.4)
    else:
        page.keyboard.press("Escape")
    jitter_sleep(8.0)
