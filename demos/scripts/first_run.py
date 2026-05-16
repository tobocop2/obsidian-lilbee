"""First-run demo: SetupWizard walk-through.

Drives the six-step SetupWizard from a fresh-install posture without
actually committing to a model download (the recording stops at the model
picker so we don't pin a real on-camera pull every render). The demo
conveys: "first time you open lilbee, here's what you see."

Beats:
  1. Welcome step (intro copy)
  2. SERVER step: pick "Managed" -- lilbee runs inside Obsidian's host
  3. MODEL step: show the curated chat-model picker (Qwen3 4B card etc.)
  4. linger on the picker so the model cards are visible
  5. close the wizard (Escape) without committing

The actual install/pull flow lives in the catalog demo; this one is
about the first impression.
"""
from __future__ import annotations

from _record import jitter_sleep
from playwright.sync_api import Page


def run(page: Page) -> None:
    page.evaluate('''() => { if (window.app?.setTheme) window.app.setTheme('obsidian'); }''')
    for _ in range(4):
        page.keyboard.press("Escape")
        page.wait_for_timeout(120)

    # Single-pane: detach lilbee leaves so the wizard isn't framed by
    # half-open sidebars.
    page.evaluate('''() => {
        const app = window.app;
        app.workspace.detachLeavesOfType('lilbee-chat');
        app.workspace.detachLeavesOfType('lilbee-tasks');
        app.workspace.detachLeavesOfType('lilbee-wiki');
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) app.workspace.leftSplit.collapse();
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) app.workspace.rightSplit.collapse();
    }''')
    jitter_sleep(0.8)

    # Open the SetupWizard.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:setup")')
    jitter_sleep(3.5)  # let the welcome copy land + linger so it's readable

    # Beat 2: click "Get started".
    page.locator('.modal-container button.mod-cta:has-text("Get started")').first.click()
    jitter_sleep(2.5)

    # Beat 3: SERVER step. Click the "Managed" card / button -- the
    # wizard renders mode pickers as buttons inside .modal-container.
    page.evaluate('''() => {
        const modal = document.querySelector('.modal-container');
        const buttons = modal.querySelectorAll('button, [role="button"], [class*="card"]');
        for (const b of buttons) {
            const t = b.innerText.toLowerCase();
            if (t.includes("managed")) { b.click(); return; }
        }
    }''')
    jitter_sleep(3.0)

    # Beat 4: advance to MODEL step via Next/Continue button if rendered.
    page.evaluate('''() => {
        const modal = document.querySelector('.modal-container');
        const next = Array.from(modal?.querySelectorAll('button') ?? []).find(b => /next|continue/i.test(b.innerText));
        if (next) next.click();
    }''')
    jitter_sleep(3.5)

    # Linger on the model picker so the cards (Qwen3, Llama, etc.) are
    # visible and readable in the recorded frames.
    jitter_sleep(3.0)

    # Don't commit to a download. Escape closes the wizard cleanly.
    page.keyboard.press("Escape")
    jitter_sleep(0.5)
    # Confirm the close if the wizard prompts.
    try:
        page.locator('.modal-container button:has-text("Discard")').first.click(timeout=1500)
    except Exception:
        try:
            page.locator('.modal-container button:has-text("Cancel")').first.click(timeout=1500)
        except Exception:
            pass
    jitter_sleep(1.2)
