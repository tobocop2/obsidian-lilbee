"""Catalog demo: browse models, drill into one, swap the active chat model.

No pulls on camera. The demo sticks to already-installed models so the
recording stays short and reproducible. Flow:

  1. Open CatalogModal via command id.
  2. Type "qwen" in the search; results narrow.
  3. Click the info button (i) on a Qwen3 card -> ModelInfoModal opens
     with size + description.
  4. Close the info modal.
  5. Click "pick" on the same card -> sets it as the active chat model.
  6. Close catalog.
  7. Linger on the status bar so the audience sees the chat-model name
     update.
"""
from __future__ import annotations

from _record import jitter_sleep, type_chunked
from playwright.sync_api import Page


def run(page: Page) -> None:
    page.evaluate('''() => { if (window.app?.setTheme) window.app.setTheme('obsidian'); }''')
    for _ in range(4):
        page.keyboard.press("Escape")
        page.wait_for_timeout(120)

    # Open the catalog.
    page.evaluate('() => window.app.commands.executeCommandById("lilbee:lilbee:catalog")')
    jitter_sleep(1.8)

    # Search.
    search = page.locator('input.lilbee-catalog-search').first
    search.click()
    jitter_sleep(0.3)
    type_chunked(page, "qwen", prose=False)
    jitter_sleep(2.5)

    # Click the "i" info button on the Qwen3 4B card. Cards are
    # `.lilbee-model-card[data-repo="<hf-id>"]`; the info button is
    # `.lilbee-model-card-info`.
    page.evaluate('''() => {
        const card = document.querySelector('.lilbee-model-card[data-repo="Qwen/Qwen3-4B-GGUF"]');
        card?.querySelector('.lilbee-model-card-info')?.click();
    }''')
    jitter_sleep(3.0)

    # ModelInfoModal opens as a second modal on top. Linger so the audience
    # can read the size + description, then Escape pops only the top modal.
    page.keyboard.press("Escape")
    jitter_sleep(1.2)

    # Click "Use" on the Qwen3 4B card -- this swaps the active chat model.
    # The card whose model is already active shows an "Active" button
    # instead; for the 4B card (currently not active) the button is "Use".
    page.evaluate('''() => {
        const card = document.querySelector('.lilbee-model-card[data-repo="Qwen/Qwen3-4B-GGUF"]');
        card?.querySelector('.lilbee-catalog-use')?.click();
    }''')
    jitter_sleep(2.5)

    # Close the catalog so the status bar update lands as the closing
    # frame.
    page.keyboard.press("Escape")
    jitter_sleep(0.6)
    page.keyboard.press("Escape")
    jitter_sleep(2.0)
