"""Chat demo: cited answer + click-through to the source PDF page.

One demo, two beats:
  1. Ask the towing question -- streamed reply with chips for the cited
     pages of cv-manual.pdf (p. 173, p. 256, pp. 211-212).
  2. Click each chip in turn -- SourcePreviewModal opens at the exact
     page in the embedded PDFium viewer.

The lilbee TUI tui-chat + tui-click-source demos run as two separate
videos; in the plugin they're the same flow with a natural pause
between, so we ship one combined GIF instead of duplicating the chat
context.
"""
from __future__ import annotations

from _record import jitter_sleep, type_chunked, wait_for_idle
from _setup import prepare
from playwright.sync_api import Page

PROMPT = "I'm prepping this car to tow my boat. What does the manual say I need to check?"

# Chips to click after the answer lands. Each is the visible label text
# on a `.lilbee-source-chip-loc` element inside the expanded `<details>`.
CHIPS = ["p. 173", "p. 256", "pp. 211–212"]


def run(page: Page) -> None:
    prepare(page)

    # Clean single-pane layout: chat fills the whole main area, no sidebars,
    # no New-tab placeholder, no other tabs. Detaches every existing
    # lilbee-chat leaf first so a sidebar chat left over from a prior run
    # can't end up rendered next to the main-pane one.
    page.evaluate('''async () => {
        const app = window.app;
        if (!app) return;
        app.workspace.detachLeavesOfType('lilbee-tasks');
        app.workspace.detachLeavesOfType('lilbee-wiki');
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
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) {
            app.workspace.rightSplit.collapse();
        }
    }''')
    jitter_sleep(1.5)

    # Clear any prior chat content.
    try:
        page.locator('.lilbee-chat-clear').first.click(timeout=1500)
        jitter_sleep(0.4)
    except Exception:
        pass

    # Switch to Chat mode.
    chat_btn = page.locator('.lilbee-chat-mode-btn:has-text("Chat")').first
    if not chat_btn.evaluate('el => el.classList.contains("active")'):
        chat_btn.click()
        jitter_sleep(0.4)

    # Type prompt + send.
    textarea = page.locator('textarea.lilbee-chat-textarea').first
    textarea.click()
    jitter_sleep(0.3)
    type_chunked(page, PROMPT, prose=True)
    jitter_sleep(0.6)
    page.keyboard.press("Enter")

    # Wait for the streamed answer.
    wait_for_idle(page, '.lilbee-chat-message.assistant', idle_for=3.0, timeout=120.0)
    jitter_sleep(3.0)

    # Open Sources expander so the chips are visible.
    try:
        page.locator('.lilbee-chat-sources summary, .lilbee-chat-sources [role="button"]').first.click(timeout=2000)
        jitter_sleep(1.0)
    except Exception:
        pass
    # Force every <details> open in the visible chat leaf so chip access
    # is reliable regardless of which expander Obsidian rendered.
    page.evaluate('''() => {
        const leaves = document.querySelectorAll('.workspace-leaf');
        for (const leaf of leaves) {
            if (getComputedStyle(leaf).display === 'none') continue;
            leaf.querySelectorAll('details').forEach(d => d.open = true);
        }
    }''')
    jitter_sleep(2.0)

    # Click each chip. Modal mounts + PDFium scrolls to the target page,
    # linger so the reader sees the highlighted region, Escape to close.
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
        page.wait_for_selector('.lilbee-preview-modal-frame', timeout=5000)
        jitter_sleep(4.0)
        page.keyboard.press("Escape")
        jitter_sleep(0.9)

    jitter_sleep(1.5)
