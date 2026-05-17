"""Settings demo: mouse-page through every lilbee settings section.

Emphasises the breadth of knobs the plugin exposes. The cursor is
driven via OS-level pyautogui so each action is visibly mouse-driven,
not a teleporting JS click.
"""
from __future__ import annotations

from _mouse import click_locator, scroll_at
from _record import jitter_sleep
from _setup import prepare
from playwright.sync_api import Page

# Section anchors in order. Each is a substring uniquely identifying
# the first row of the section. The demo scrolls until the anchor is
# near the top of the viewport, lingers, then continues.
SECTION_ANCHORS = [
    "Server mode",
    "Setup wizard",
    "Models",
    "Active chat model",
    "Search & Retrieval",
    "Results count",
    "Generation",
    "Worker pool",
    "Ingest",
    "Wiki",
    "Crawling",
    "API keys",
    "Advanced",
]


def run(page: Page) -> None:
    prepare(page)

    page.evaluate('() => window.app.commands.executeCommandById("app:open-settings")')
    jitter_sleep(1.2)

    lilbee_tab = page.locator('.vertical-tab-nav-item:has-text("lilbee")').first
    lilbee_tab.scroll_into_view_if_needed()
    click_locator(page, lilbee_tab, duration=0.5)
    jitter_sleep(1.0)

    scroller_box = page.evaluate(
        '() => { const el = document.querySelector(".vertical-tab-content-container");'
        ' const r = el?.getBoundingClientRect();'
        ' return r ? {x: r.x, y: r.y, w: r.width, h: r.height} : null; }'
    )
    if scroller_box is None:
        return
    scroll_cx = scroller_box["x"] + scroller_box["w"] / 2
    scroll_cy = scroller_box["y"] + scroller_box["h"] / 2

    for anchor in SECTION_ANCHORS:
        page.evaluate(f'''() => {{
            const scroller = document.querySelector('.vertical-tab-content-container');
            scroller?.querySelectorAll('summary').forEach(s => {{
                if (s.innerText.trim().toLowerCase().startsWith({anchor.lower()!r})) {{
                    s.parentElement?.setAttribute('open', '');
                }}
            }});
        }}''')
        for _ in range(8):
            target_offset = page.evaluate(f'''() => {{
                const scroller = document.querySelector('.vertical-tab-content-container');
                if (!scroller) return null;
                const candidates = scroller.querySelectorAll('h1, h2, h3, .setting-item-name, summary');
                for (const el of candidates) {{
                    if (el.innerText.trim().toLowerCase().startsWith({anchor.lower()!r})) {{
                        const r = el.getBoundingClientRect();
                        const sr = scroller.getBoundingClientRect();
                        return Math.round(r.top - sr.top - 60);
                    }}
                }}
                return null;
            }}''')
            if target_offset is None or abs(target_offset) < 40:
                break
            direction = -3 if target_offset < 0 else 3
            scroll_at(page, scroll_cx, scroll_cy, dy=direction * 4, steps=2)
            jitter_sleep(0.2)
        jitter_sleep(1.5)

    # End scrolled to the bottom so the Advanced section is fully on screen.
    scroll_at(page, scroll_cx, scroll_cy, dy=-30, steps=6)
    jitter_sleep(2.0)

    close_btn = page.locator('.modal-container .modal-close-button').first
    if close_btn.count() > 0:
        click_locator(page, close_btn, duration=0.4)
    else:
        page.keyboard.press("Escape")
    jitter_sleep(1.0)
