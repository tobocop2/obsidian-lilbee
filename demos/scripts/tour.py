"""Tour demo: short mouse-driven sweep across every plugin surface.

No chat question (the per-token streaming latency made the v1 tour
drag); every beat is a mouse-click that exposes a different surface,
held just long enough to be recognisable.

Beats (each ~3-4 s):
  1. Collapsed-sidebar baseline so the status bar + ribbons read.
  2. Ribbon -> open chat sidebar.
  3. Ribbon -> open Task Center sidebar.
  4. Cmd-id -> open Catalog modal.
  5. Cmd-id -> open Documents modal.
  6. Cmd-id -> open Wiki sidebar.
  7. Cmd-id -> open Settings, click the lilbee tab.
  8. Close back to chat.
"""
from __future__ import annotations

from _mouse import click_locator
from _record import jitter_sleep
from _setup import prepare
from playwright.sync_api import Page


def run(page: Page) -> None:
    prepare(page)

    # Baseline: sidebars collapsed, lilbee leaves detached.
    page.evaluate('''() => {
        const app = window.app;
        app.workspace.detachLeavesOfType('lilbee-tasks');
        app.workspace.detachLeavesOfType('lilbee-wiki');
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) app.workspace.leftSplit.collapse();
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) app.workspace.rightSplit.collapse();
    }''')
    jitter_sleep(1.5)

    # Beat 2: Ribbon -> chat.
    click_locator(page, page.locator('[aria-label="Open lilbee chat"]').first, duration=0.5)
    jitter_sleep(2.5)

    # Beat 3: Ribbon -> Task Center.
    click_locator(page, page.locator('[aria-label="Open lilbee Task Center"]').first, duration=0.5)
    jitter_sleep(2.5)

    # Beat 4: Catalog modal.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:catalog")')
    jitter_sleep(2.5)
    page.keyboard.press("Escape")
    jitter_sleep(0.5)

    # Beat 5: Documents modal.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:documents")')
    jitter_sleep(2.5)
    page.keyboard.press("Escape")
    jitter_sleep(0.5)

    # Beat 6: Wiki sidebar.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:wiki")')
    jitter_sleep(2.5)

    # Beat 7: Settings + click the lilbee tab.
    page.evaluate('() => window.app.commands.executeCommandById("app:open-settings")')
    jitter_sleep(1.2)
    lilbee_tab = page.locator('.vertical-tab-nav-item:has-text("lilbee")').first
    lilbee_tab.scroll_into_view_if_needed()
    click_locator(page, lilbee_tab, duration=0.4)
    jitter_sleep(2.5)
    page.keyboard.press("Escape")
    jitter_sleep(0.5)

    # Beat 8: closing frame on chat.
    page.evaluate('''() => {
        const app = window.app;
        const chatLeaf = app.workspace.getLeavesOfType('lilbee-chat')[0];
        if (chatLeaf) app.workspace.revealLeaf(chatLeaf);
    }''')
    jitter_sleep(2.0)
