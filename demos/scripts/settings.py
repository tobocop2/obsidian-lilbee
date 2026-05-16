"""Settings demo: open Settings, jump to the lilbee tab, drive the filter.

The filter input is the headline: typing in `.lilbee-settings-filter`
narrows the visible setting rows in real time. The demo:

  1. open the Settings modal (Cmd+,)
  2. click the lilbee tab in the sidebar
  3. focus the filter, type "results"  -> Results count narrows in
  4. clear, type "rerank"              -> reranker toggle row narrows in
  5. clear, type "strict"              -> Search strictness row narrows in
  6. clear -> all settings restored
  7. close
"""
from __future__ import annotations

from _record import jitter_sleep, type_chunked
from playwright.sync_api import Page


def run(page: Page) -> None:
    # Dark theme + fresh state.
    page.evaluate('''() => { if (window.app?.setTheme) window.app.setTheme('obsidian'); }''')
    page.keyboard.press("Escape")
    jitter_sleep(0.3)

    # Open Settings via Obsidian's command id (works cross-platform; the
    # Cmd+, hotkey is macOS-only and not always honoured through CDP).
    page.evaluate('''() => window.app.commands.executeCommandById("app:open-settings")''')
    jitter_sleep(1.2)

    # Click the lilbee tab. The vertical nav may need scrolling on smaller
    # screens; .scrollIntoViewIfNeeded handles that.
    lilbee_tab = page.locator('.vertical-tab-nav-item:has-text("lilbee")').first
    lilbee_tab.scroll_into_view_if_needed()
    jitter_sleep(0.4)
    lilbee_tab.click()
    jitter_sleep(1.2)

    # Focus the filter input.
    filt = page.locator('input.lilbee-settings-filter').first
    filt.click()
    jitter_sleep(0.5)

    # Beat 1: "results" narrows to Results count.
    type_chunked(page, "results", prose=False)
    jitter_sleep(2.5)

    # Clear (triple-click + delete is more reliable than .fill across modals).
    filt.click()
    page.keyboard.press("Meta+A")
    page.keyboard.press("Backspace")
    jitter_sleep(0.8)

    # Beat 2: "rerank" narrows to the reranker toggle.
    type_chunked(page, "rerank", prose=False)
    jitter_sleep(2.5)

    filt.click()
    page.keyboard.press("Meta+A")
    page.keyboard.press("Backspace")
    jitter_sleep(0.8)

    # Beat 3: "strict" narrows to Search strictness.
    type_chunked(page, "strict", prose=False)
    jitter_sleep(2.5)

    # Clear, full settings restored.
    filt.click()
    page.keyboard.press("Meta+A")
    page.keyboard.press("Backspace")
    jitter_sleep(2.0)

    # Close the modal.
    page.keyboard.press("Escape")
    jitter_sleep(1.0)
