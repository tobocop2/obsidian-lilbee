"""Chat demo: open lilbee chat, ask the towing question, get a cited answer.

Parallels the lilbee TUI tui-chat demo but uses the towing prompt (more
interesting + multi-section retrieval against the same Crown Vic PDF).
"""
from __future__ import annotations

from _record import jitter_sleep, type_chunked, wait_for_idle
from _setup import prepare
from playwright.sync_api import Page

PROMPT = "I'm prepping this car to tow my boat. What does the manual say I need to check?"


def run(page: Page) -> None:
    prepare(page)

    # Clean single-pane layout: chat fills the whole main area, no sidebars,
    # no New-tab placeholder, no other tabs.
    page.evaluate('''async () => {
        const app = window.app;
        if (!app) return;
        // Detach sidebar lilbee leaves so chat isn't duplicated.
        app.workspace.detachLeavesOfType('lilbee-tasks');
        app.workspace.detachLeavesOfType('lilbee-wiki');
        // Find any existing lilbee-chat leaf in the main pane; if not, take
        // the most-recent main-pane leaf and convert it to lilbee-chat.
        let chatLeaf = app.workspace.getLeavesOfType('lilbee-chat').find(
            l => l.getRoot && l.getRoot() === app.workspace.rootSplit
        );
        if (!chatLeaf) {
            chatLeaf = app.workspace.getMostRecentLeaf();
            if (chatLeaf) {
                await chatLeaf.setViewState({ type: 'lilbee-chat', active: true });
            }
        }
        // Close every OTHER tab in the root split (only chat survives).
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
        // Collapse both sidebars.
        if (app.workspace.leftSplit && !app.workspace.leftSplit.collapsed) {
            app.workspace.leftSplit.collapse();
        }
        if (app.workspace.rightSplit && !app.workspace.rightSplit.collapsed) {
            app.workspace.rightSplit.collapse();
        }
    }''')
    jitter_sleep(1.5)

    # Clear any prior chat content
    try:
        page.locator('.lilbee-chat-clear').first.click(timeout=1500)
        jitter_sleep(0.4)
    except Exception:
        pass

    # Switch to Chat mode (default is Search). Click the Chat toggle button.
    chat_btn = page.locator('.lilbee-chat-mode-btn:has-text("Chat")').first
    if not chat_btn.evaluate('el => el.classList.contains("active")'):
        chat_btn.click()
        jitter_sleep(0.4)

    # Focus the chat textarea + type the prompt with prose cadence
    textarea = page.locator('textarea.lilbee-chat-textarea').first
    textarea.click()
    jitter_sleep(0.3)
    type_chunked(page, PROMPT, prose=True)
    jitter_sleep(0.8)

    # Send. Default Obsidian / lilbee binding: Cmd+Enter or just Enter.
    # The textarea's wired to submit on Enter (Shift+Enter newlines).
    page.keyboard.press("Enter")

    # Wait for the streamed answer to finish (idle for 3 s, no exact-text
    # matching since Qwen3 8B isn't deterministic). 120 s ceiling covers the
    # 6-item towing answer comfortably.
    wait_for_idle(page, '.lilbee-chat-message.assistant', idle_for=3.0, timeout=120.0)

    # Linger so the reader can scan the cited answer.
    jitter_sleep(3.5)

    # Click the Sources expander so the source chips render in the still.
    try:
        page.locator('.lilbee-chat-sources summary, .lilbee-chat-sources [role="button"]').first.click(timeout=2000)
        jitter_sleep(1.0)
    except Exception:
        pass
    # Linger one more beat so the recorded frames include the expanded sources.
    jitter_sleep(2.5)
