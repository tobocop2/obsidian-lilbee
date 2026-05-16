"""Click-to-source demo: click a cited page chip, modal opens at that page.

Picks up the chat state from `chat` (towing answer with chips for p. 173,
p. 256, pp. 211-212). If no chat answer is present (fresh session), the
towing prompt is sent first so the demo is self-contained.

The headline beat: each chip click opens the SourcePreviewModal at the
exact page in cv-manual.pdf via the Chromium PDFium viewer's `#page=N`
fragment honour. (Previously broken by a content_type spelling mismatch
between server and plugin; fixed in this branch.)
"""
from __future__ import annotations

from _record import jitter_sleep, type_chunked, wait_for_idle
from _setup import prepare
from playwright.sync_api import Page

PROMPT = "I'm prepping this car to tow my boat. What does the manual say I need to check?"

# Chips to click in order. Each is the visible label text on the
# `.lilbee-source-chip-loc` element inside the expanded `<details>` block.
CHIPS = ["p. 173", "p. 256", "pp. 211–212"]


def run(page: Page) -> None:
    prepare(page)

    # Same single-pane chat layout as chat.py (sidebars closed, chat fills
    # the main area, no New-tab placeholder).
    page.evaluate('''async () => {
        const app = window.app;
        if (!app) return;
        app.workspace.detachLeavesOfType('lilbee-tasks');
        app.workspace.detachLeavesOfType('lilbee-wiki');
        let chatLeaf = app.workspace.getLeavesOfType('lilbee-chat').find(
            l => l.getRoot && l.getRoot() === app.workspace.rootSplit
        );
        if (!chatLeaf) {
            chatLeaf = app.workspace.getMostRecentLeaf();
            if (chatLeaf) {
                await chatLeaf.setViewState({ type: 'lilbee-chat', active: true });
            }
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
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) {
            app.workspace.rightSplit.collapse();
        }
    }''')
    jitter_sleep(1.5)

    # If no assistant answer is on screen, prime the chat by sending the
    # towing prompt. Otherwise pick up where the chat demo left off.
    has_answer = page.evaluate('''() => {
        const leaves = document.querySelectorAll('.workspace-leaf');
        for (const leaf of leaves) {
            if (getComputedStyle(leaf).display === 'none') continue;
            if (leaf.querySelector('.lilbee-chat-message.assistant')) return true;
        }
        return false;
    }''')
    if not has_answer:
        # Switch to Chat mode (default is Search).
        chat_btn = page.locator('.lilbee-chat-mode-btn:has-text("Chat")').first
        if not chat_btn.evaluate('el => el.classList.contains("active")'):
            chat_btn.click()
            jitter_sleep(0.4)
        textarea = page.locator('textarea.lilbee-chat-textarea').first
        textarea.click()
        jitter_sleep(0.3)
        type_chunked(page, PROMPT, prose=True)
        jitter_sleep(0.6)
        page.keyboard.press("Enter")
        wait_for_idle(page, '.lilbee-chat-message.assistant', idle_for=3.0, timeout=120.0)

    # Linger so the reader sees the cited answer + chips already in view.
    jitter_sleep(2.0)

    # Expand the Sources <details> in the visible leaf so the chips are
    # clickable on camera.
    page.evaluate('''() => {
        const leaves = document.querySelectorAll('.workspace-leaf');
        for (const leaf of leaves) {
            if (getComputedStyle(leaf).display === 'none') continue;
            leaf.querySelectorAll('details').forEach(d => d.open = true);
        }
    }''')
    jitter_sleep(1.2)

    # Click each chip in turn. Wait for the modal to mount, linger so the
    # viewer can scroll to the target page, then close with Escape.
    for chip_label in CHIPS:
        clicked = page.evaluate(f'''() => {{
            const leaves = document.querySelectorAll('.workspace-leaf');
            for (const leaf of leaves) {{
                if (getComputedStyle(leaf).display === 'none') continue;
                const chip = Array.from(leaf.querySelectorAll('.lilbee-source-chip-loc'))
                    .find(el => el.innerText.trim() === {chip_label!r});
                if (chip) {{ chip.click(); return true; }}
            }}
            return false;
        }}''')
        if not clicked:
            continue
        # Modal mount + PDFium viewer page-scroll settle.
        page.wait_for_selector('.lilbee-preview-modal-frame', timeout=5000)
        jitter_sleep(4.5)
        page.keyboard.press("Escape")
        jitter_sleep(1.0)

    # Final beat so the closing frame isn't mid-modal-dismiss.
    jitter_sleep(1.5)
