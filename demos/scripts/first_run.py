"""First-run demo: mouse-driven walk through the SetupWizard.

Stops at the model picker without committing to a download (the
recording shouldn't pin a real on-camera pull). All clicks go through
the OS cursor.
"""
from __future__ import annotations

from _mouse import click_at, click_selector, coords_from_js
from _record import jitter_sleep
from _setup import prepare
from playwright.sync_api import Page


def run(page: Page) -> None:
    prepare(page)

    # Detach lilbee leaves so the wizard isn't framed by half-open sidebars.
    page.evaluate('''() => {
        const app = window.app;
        app.workspace.detachLeavesOfType('lilbee-chat');
        app.workspace.detachLeavesOfType('lilbee-tasks');
        app.workspace.detachLeavesOfType('lilbee-wiki');
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) app.workspace.leftSplit.collapse();
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) app.workspace.rightSplit.collapse();
    }''')
    jitter_sleep(0.8)

    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:setup")')
    jitter_sleep(3.5)

    # Mouse-click "Get started".
    click_selector(page, '.modal-container button.mod-cta:has-text("Get started")', duration=0.5)
    jitter_sleep(2.5)

    # Mouse-click the "Managed" mode card/button.
    coords = coords_from_js(page, '''() => {
        const modal = document.querySelector('.modal-container');
        const buttons = modal?.querySelectorAll('button, [role="button"], [class*="card"]') ?? [];
        for (const b of buttons) {
            if (b.innerText.toLowerCase().includes("managed")) {
                const r = b.getBoundingClientRect();
                return { x: r.x + r.width/2, y: r.y + r.height/2 };
            }
        }
        return null;
    }''')
    if coords:
        click_at(page, coords["x"], coords["y"], duration=0.4)
    jitter_sleep(3.0)

    # Mouse-click Next/Continue to reach the model picker.
    coords = coords_from_js(page, '''() => {
        const modal = document.querySelector('.modal-container');
        const next = Array.from(modal?.querySelectorAll('button') ?? []).find(b => /next|continue/i.test(b.innerText));
        if (!next) return null;
        const r = next.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2 };
    }''')
    if coords:
        click_at(page, coords["x"], coords["y"], duration=0.4)
    jitter_sleep(3.5)

    jitter_sleep(3.0)

    page.keyboard.press("Escape")
    jitter_sleep(0.5)
    try:
        click_selector(page, '.modal-container button:has-text("Discard")', duration=0.4)
    except Exception:
        try:
            click_selector(page, '.modal-container button:has-text("Cancel")', duration=0.4)
        except Exception:
            pass
    jitter_sleep(1.2)
