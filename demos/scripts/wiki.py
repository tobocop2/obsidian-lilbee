"""Wiki demo: mouse-walk the auto-generated concept pages.

Wiki is experimental in lilbee today; this demo shows the surface
without overselling it. Beats:

  1. Open the wiki sidebar (mouse-click on the wiki-list view).
  2. Click a concept page so it renders in detail.
  3. Click a footnote ``[1]`` -> CitationModal shows the provenance.
  4. Close.
  5. ``lilbee:wiki-drafts`` -> DraftModal lists low-faithfulness pages.
  6. Close.
  7. ``lilbee:wiki-lint`` -> LintModal shows the health check result.
  8. Close.
"""
from __future__ import annotations

from _mouse import click_at, coords_from_js
from _record import jitter_sleep
from _setup import prepare
from playwright.sync_api import Page

PAGE_TITLE = "Semantic Chunking"


def run(page: Page) -> None:
    prepare(page)

    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:wiki")')
    jitter_sleep(2.0)

    # Mouse-click the named concept page.
    coords = coords_from_js(page, f'''() => {{
        const items = document.querySelectorAll('.lilbee-wiki-list > div, .lilbee-wiki-list .lilbee-wiki-item, .lilbee-wiki-list h3');
        for (const el of items) {{
            if (el.innerText.includes({PAGE_TITLE!r})) {{
                const r = el.getBoundingClientRect();
                return {{ x: r.x + r.width/2, y: r.y + r.height/2 }};
            }}
        }}
        return null;
    }}''')
    if coords:
        click_at(page, coords["x"], coords["y"], duration=0.5)
    jitter_sleep(3.5)

    # Mouse-click the first [1] footnote.
    coords = coords_from_js(page, '''() => {
        const detail = document.querySelector('.lilbee-wiki-detail');
        const link = Array.from(detail?.querySelectorAll('.footnote-link') ?? [])
            .find(el => el.innerText.trim() === "[1]");
        if (!link) return null;
        const r = link.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2 };
    }''')
    if coords:
        click_at(page, coords["x"], coords["y"], duration=0.4)
    jitter_sleep(4.0)
    page.keyboard.press("Escape")
    jitter_sleep(1.2)

    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:wiki-drafts")')
    jitter_sleep(4.5)
    page.keyboard.press("Escape")
    jitter_sleep(1.0)

    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:wiki-lint")')
    jitter_sleep(4.0)
    page.keyboard.press("Escape")
    jitter_sleep(1.5)
