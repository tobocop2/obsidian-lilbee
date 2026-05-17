"""Chat demo: cited answer + mouse-click through to the source PDF page.

Single full-width chat (sidebars collapsed) so the streaming answer
and the three chip-clicks land with maximum readability. All clicks
mouse-driven via the OS cursor.
"""
from __future__ import annotations

from _mouse import click_at, click_locator, click_selector, coords_from_js
from _record import jitter_sleep, type_chunked, wait_for_idle
from _setup import prepare
from playwright.sync_api import Page

PROMPT = "I'm prepping this car to tow my boat. What does the manual say I need to check?"
CHIPS = ["p. 173", "p. 256", "pp. 211–212"]


def run(page: Page) -> None:
    prepare(page)

    # Single-pane chat in the main pane, sidebars collapsed.
    page.evaluate('''async () => {
        const app = window.app;
        if (!app) return;
        app.workspace.detachLeavesOfType('lilbee-tasks');
        app.workspace.detachLeavesOfType('lilbee-wiki');
        const rootChat = app.workspace.getLeavesOfType('lilbee-chat').find(
            l => l.getRoot && l.getRoot() === app.workspace.rootSplit
        );
        if (!rootChat) {
            for (const l of app.workspace.getLeavesOfType('lilbee-chat')) l.detach();
            const ribbon = document.querySelector('[aria-label="Open lilbee chat"]');
            if (ribbon) ribbon.click();
            await new Promise(r => setTimeout(r, 600));
        }
        // Close every OTHER tab in the root split.
        const chatLeaf = app.workspace.getLeavesOfType('lilbee-chat').find(
            l => l.getRoot && l.getRoot() === app.workspace.rootSplit
        );
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
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) app.workspace.leftSplit.collapse();
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) app.workspace.rightSplit.collapse();
    }''')
    jitter_sleep(1.5)
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
    type_chunked(page, PROMPT, prose=True)
    jitter_sleep(0.6)
    page.keyboard.press("Enter")

    wait_for_idle(page, '.lilbee-chat-message.assistant', idle_for=3.0, timeout=120.0)
    jitter_sleep(3.0)

    # Open Sources expander, force all details open.
    try:
        click_selector(page, '.lilbee-chat-sources summary', duration=0.4)
        jitter_sleep(0.6)
    except Exception:
        pass
    page.evaluate('''() => {
        document.querySelectorAll('.workspace-leaf').forEach(leaf => {
            if (getComputedStyle(leaf).display === 'none') return;
            leaf.querySelectorAll('details').forEach(d => d.open = true);
        });
    }''')
    jitter_sleep(1.5)

    # Mouse-click each chip in turn. Modal mounts, linger, Escape.
    for chip_label in CHIPS:
        coords = coords_from_js(page, f'''() => {{
            const leaves = document.querySelectorAll('.workspace-leaf');
            for (const leaf of leaves) {{
                if (getComputedStyle(leaf).display === 'none') continue;
                const chip = Array.from(leaf.querySelectorAll('.lilbee-source-chip-loc'))
                    .find(el => el.innerText.trim() === {chip_label!r});
                if (chip) {{
                    const r = chip.getBoundingClientRect();
                    return {{ x: r.x + r.width/2, y: r.y + r.height/2 }};
                }}
            }}
            return null;
        }}''')
        if not coords:
            continue
        click_at(page, coords["x"], coords["y"], duration=0.5)
        try:
            page.wait_for_selector('.lilbee-preview-modal-frame', timeout=5000)
        except Exception:
            continue
        jitter_sleep(4.0)
        page.keyboard.press("Escape")
        jitter_sleep(0.9)

    jitter_sleep(1.5)
