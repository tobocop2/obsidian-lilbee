"""Shared per-demo setup: dark theme, drained modals, no stuck menus.

Every demo script calls `prepare(page)` as its first line. Centralising
this means a fix to the theme or menu-drain logic lands once instead of
in 9 places.
"""
from __future__ import annotations

from playwright.sync_api import Page

from _record import jitter_sleep


def prepare(page: Page) -> None:
    """Bring Obsidian to a known clean state before the demo runs.

    - Force the dark theme via the vault config (``setTheme`` alone is
      transient; ``setConfig('theme', 'obsidian')`` persists and stops
      Obsidian from falling back to the OS preference mid-recording).
    - Dismiss any open modals (a prior demo or a half-finished probe can
      leave a confirmation dialog or context menu pinned to the DOM
      that would intercept clicks).
    - Drain Obsidian's left-over .menu DOM nodes (right-click context
      menus from earlier interactive probing sometimes persist as
      orphan ``.menu`` elements that aren't dismissed by Escape).
    """
    page.evaluate('''() => {
        const app = window.app;
        if (!app) return;
        if (app.vault.setConfig) app.vault.setConfig('theme', 'obsidian');
        if (app.setTheme) app.setTheme('obsidian');
    }''')
    # Settle on the new theme paint.
    page.wait_for_timeout(250)

    # Drain modals.
    for _ in range(6):
        page.keyboard.press("Escape")
        page.wait_for_timeout(80)

    # Force-close any lingering modal containers and orphan menus.
    page.evaluate('''() => {
        document.querySelectorAll('.modal-bg').forEach(el => el.click());
        document.querySelectorAll('.modal-close-button').forEach(el => el.click());
        // Obsidian's right-click .menu elements are top-level body children;
        // they don't always respond to Escape (e.g. when triggered via a
        // synthesised contextmenu that the keyboard handler never saw).
        document.querySelectorAll('body > .menu').forEach(el => el.remove());
    }''')
    jitter_sleep(0.3)
