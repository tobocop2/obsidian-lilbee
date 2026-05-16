"""Tour demo: a 60-90s sweep through every lilbee surface.

Order (each beat ~5-8s):
  1. Status bar shows "lilbee: ready [external] (Qwen3 8B)" + sync hint
  2. Open chat sidebar via the ribbon (Open lilbee chat)
  3. Ask a quick cited question -> streamed reply with chip
  4. Open Task Center via the ribbon
  5. Open the catalog modal via command id -> close
  6. Open the documents modal via command id -> close
  7. Open the wiki sidebar via command id
  8. Open the settings modal -> jump to lilbee tab -> close
  9. Back to chat as the closing frame

This is a flythrough, not a deep dive. Each beat lingers just long
enough for the surface to be recognisable.
"""
from __future__ import annotations

from _record import jitter_sleep, type_chunked, wait_for_idle
from playwright.sync_api import Page

QUICK_PROMPT = "What is lilbee in one sentence?"


def run(page: Page) -> None:
    # Dark theme + dismiss anything left from a prior demo.
    page.evaluate('''() => { if (window.app?.setTheme) window.app.setTheme('obsidian'); }''')
    page.keyboard.press("Escape")
    jitter_sleep(0.3)
    page.keyboard.press("Escape")
    jitter_sleep(0.3)

    # ------------------------------------------------------------------
    # Beat 1: collapsed-sidebar baseline + status bar visible
    # ------------------------------------------------------------------
    page.evaluate('''() => {
        const app = window.app;
        app.workspace.detachLeavesOfType('lilbee-tasks');
        app.workspace.detachLeavesOfType('lilbee-wiki');
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) app.workspace.leftSplit.collapse();
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) app.workspace.rightSplit.collapse();
    }''')
    jitter_sleep(2.0)

    # ------------------------------------------------------------------
    # Beat 2: ribbon -> chat. Use the registered ribbon icon.
    # ------------------------------------------------------------------
    page.locator('[aria-label="Open lilbee chat"]').first.click()
    jitter_sleep(1.5)

    # ------------------------------------------------------------------
    # Beat 3: quick cited chat answer.
    # ------------------------------------------------------------------
    try:
        page.locator('.lilbee-chat-clear').first.click(timeout=1500)
        jitter_sleep(0.3)
    except Exception:
        pass
    chat_btn = page.locator('.lilbee-chat-mode-btn:has-text("Chat")').first
    if not chat_btn.evaluate('el => el.classList.contains("active")'):
        chat_btn.click()
        jitter_sleep(0.4)
    textarea = page.locator('textarea.lilbee-chat-textarea').first
    textarea.click()
    jitter_sleep(0.3)
    type_chunked(page, QUICK_PROMPT, prose=True)
    jitter_sleep(0.4)
    page.keyboard.press("Enter")
    wait_for_idle(page, '.lilbee-chat-message.assistant', idle_for=2.5, timeout=60.0)
    jitter_sleep(2.0)

    # ------------------------------------------------------------------
    # Beat 4: Task Center via ribbon (lands as a sidebar leaf).
    # ------------------------------------------------------------------
    page.locator('[aria-label="Open lilbee Task Center"]').first.click()
    jitter_sleep(3.0)

    # ------------------------------------------------------------------
    # Beat 5: catalog modal. Glance, then close.
    # ------------------------------------------------------------------
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:catalog")')
    jitter_sleep(3.0)
    page.keyboard.press("Escape")
    jitter_sleep(0.8)

    # ------------------------------------------------------------------
    # Beat 6: documents modal. Glance, then close.
    # ------------------------------------------------------------------
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:documents")')
    jitter_sleep(3.0)
    page.keyboard.press("Escape")
    jitter_sleep(0.8)

    # ------------------------------------------------------------------
    # Beat 7: wiki sidebar.
    # ------------------------------------------------------------------
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:wiki")')
    jitter_sleep(3.0)

    # ------------------------------------------------------------------
    # Beat 8: settings -> lilbee tab -> close.
    # ------------------------------------------------------------------
    page.evaluate('() => window.app.commands.executeCommandById("app:open-settings")')
    jitter_sleep(1.2)
    lilbee_tab = page.locator('.vertical-tab-nav-item:has-text("lilbee")').first
    lilbee_tab.scroll_into_view_if_needed()
    jitter_sleep(0.3)
    lilbee_tab.click()
    jitter_sleep(2.5)
    page.keyboard.press("Escape")
    jitter_sleep(0.8)

    # ------------------------------------------------------------------
    # Beat 9: closing frame on chat
    # ------------------------------------------------------------------
    page.evaluate('''async () => {
        const app = window.app;
        const chatLeaf = app.workspace.getLeavesOfType('lilbee-chat')[0];
        if (chatLeaf) app.workspace.revealLeaf(chatLeaf);
    }''')
    jitter_sleep(2.0)
