"""Wiki demo: browse the auto-generated concept pages and their provenance.

Walks the wiki layer end-to-end:
  1. open the wiki sidebar
  2. click a concept page ("Semantic Chunking") so it renders in detail
  3. click a footnote [1] -> CitationModal shows the cited paragraph
     and which source file + chunk hash it came from
  4. close
  5. lilbee:wiki-drafts -> DraftModal lists the quarantined low-faithfulness
     pages (the proof that the wiki layer is more than "ask a model to
     summarize")
  6. close
  7. lilbee:wiki-lint -> LintModal shows the health check result
  8. close

Pre-condition: the wiki has been built once via
``lilbee wiki build`` against demos/sample-vault (see
``demos/wiki-recipe.md``). On a fresh corpus this demo records empty
state and is uninteresting; the recipe step keeps the published / draft
counts in the validated baseline.
"""
from __future__ import annotations

from _record import jitter_sleep
from playwright.sync_api import Page

# Which concept page to drill into. Must exist in the validated recipe
# output (see demos/wiki-recipe.md).
PAGE_TITLE = "Semantic Chunking"


def run(page: Page) -> None:
    page.evaluate('''() => { if (window.app?.setTheme) window.app.setTheme('obsidian'); }''')
    for _ in range(4):
        page.keyboard.press("Escape")
        page.wait_for_timeout(120)

    # Wiki sidebar (lands in the right or left split depending on prior
    # layout; the WikiView itself doesn't care which split it's in).
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:wiki")')
    jitter_sleep(2.0)

    # Click the named concept page. The list items render the title text
    # alongside metadata; match by innerText include.
    page.evaluate(f'''() => {{
        const items = document.querySelectorAll('.lilbee-wiki-list > div, .lilbee-wiki-list .lilbee-wiki-item, .lilbee-wiki-list h3');
        for (const el of items) {{
            if (el.innerText.includes({PAGE_TITLE!r})) {{ el.click(); return; }}
        }}
    }}''')
    jitter_sleep(3.5)

    # Click the first footnote [1] in the rendered page to open the
    # CitationModal (provenance: which source file + which paragraph).
    page.evaluate('''() => {
        const detail = document.querySelector('.lilbee-wiki-detail');
        const link = Array.from(detail?.querySelectorAll('.footnote-link') ?? [])
            .find(el => el.innerText.trim() === "[1]");
        if (link) link.click();
    }''')
    jitter_sleep(4.0)

    # Close the CitationModal.
    page.keyboard.press("Escape")
    jitter_sleep(1.2)

    # Open the drafts review modal. Faithfulness < 0.5 pages live here,
    # quarantined until a human reviews them.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:wiki-drafts")')
    jitter_sleep(4.5)

    page.keyboard.press("Escape")
    jitter_sleep(1.0)

    # Run wiki-lint. The result modal shows stale links / orphan citations
    # / drift -- the recipe baseline should report 0 errors.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:wiki-lint")')
    jitter_sleep(4.0)

    page.keyboard.press("Escape")
    jitter_sleep(1.5)
