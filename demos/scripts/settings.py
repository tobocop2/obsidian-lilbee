"""Settings demo: page through every section so the surface is visible.

Beats:
  1. Open Settings, jump to the lilbee tab.
  2. Scroll smoothly through each named section (Server / Models /
     Search & Retrieval / Generation / Worker pool / Ingest / Wiki /
     API keys / Advanced).
  3. Pause briefly so each header is readable.
  4. Close.
"""
from __future__ import annotations

from _record import jitter_sleep
from _setup import prepare
from playwright.sync_api import Page

# Each entry is a substring that uniquely identifies the section's first
# visible header text. Order matches the rendered settings.
SECTION_ANCHORS = [
    "Server mode",
    "Models",
    "Search & Retrieval",
    "Generation",
    "Worker pool",
    "Ingest",
    "Wiki",
    "API keys",
    "Advanced",
]


def run(page: Page) -> None:
    prepare(page)

    page.evaluate('() => window.app.commands.executeCommandById("app:open-settings")')
    jitter_sleep(1.0)
    lilbee_tab = page.locator('.vertical-tab-nav-item:has-text("lilbee")').first
    lilbee_tab.scroll_into_view_if_needed()
    jitter_sleep(0.3)
    lilbee_tab.click()
    jitter_sleep(1.5)

    for anchor in SECTION_ANCHORS:
        scrolled = page.evaluate(f'''() => {{
            const scroller = document.querySelector('.vertical-tab-content-container');
            if (!scroller) return false;
            const candidates = scroller.querySelectorAll('h1, h2, h3, .setting-item-name, summary');
            for (const el of candidates) {{
                if (el.innerText.trim().toLowerCase().startsWith({anchor.lower()!r})) {{
                    if (el.tagName === 'SUMMARY') el.parentElement?.setAttribute('open', '');
                    const rect = el.getBoundingClientRect();
                    const sRect = scroller.getBoundingClientRect();
                    scroller.scrollBy({{ top: rect.top - sRect.top - 80, behavior: 'smooth' }});
                    return true;
                }}
            }}
            return false;
        }}''')
        jitter_sleep(2.2 if scrolled else 0.5)

    page.evaluate('''() => {
        const scroller = document.querySelector('.vertical-tab-content-container');
        if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    }''')
    jitter_sleep(2.5)

    page.keyboard.press("Escape")
    jitter_sleep(1.0)
