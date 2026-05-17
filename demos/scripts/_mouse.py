"""OS-level mouse driving for the demo rig.

Playwright dispatches clicks via CDP, which Chromium routes through its
own input pipeline -- the OS cursor doesn't move. For a screen
recording the cursor needs to physically slide across the screen, so
every click in the demos goes through pyautogui (which drives the
native macOS cursor) and the Playwright client only resolves the
target element's coordinates.

Coordinates from Playwright's ``bounding_box`` are viewport-relative.
``RecordingFrame`` translates them to absolute screen coordinates using
the Obsidian window's position + the macOS title-bar offset that
``position_obsidian`` pins in ``_record.py``.
"""
from __future__ import annotations

import time
from typing import Any

try:
    import pyautogui

    pyautogui.PAUSE = 0.0
    pyautogui.FAILSAFE = False
except ImportError as exc:
    raise ImportError("pyautogui is required for mouse-driven recordings: pip install pyautogui") from exc

from playwright.sync_api import Locator, Page

# Obsidian's window contents start ~24 px below the window-position y
# (macOS unified title bar). The tab bar is part of the page viewport,
# so Playwright's bounding box already accounts for it.
_TITLEBAR_OFFSET_Y = 24


def _absolute(page: Page, x: float, y: float) -> tuple[int, int]:
    """Translate viewport-relative coords to absolute screen coords."""
    # Stash the Obsidian window rect from the recording-rig setup.
    rect = page.evaluate('() => ({x: window.screenX, y: window.screenY})')
    return (int(rect["x"] + x), int(rect["y"] + _TITLEBAR_OFFSET_Y + y))


def move_to(page: Page, x: float, y: float, *, duration: float = 0.25) -> None:
    """Smoothly slide the OS cursor to a viewport-relative coordinate."""
    ax, ay = _absolute(page, x, y)
    pyautogui.moveTo(ax, ay, duration=duration)


def click_at(page: Page, x: float, y: float, *, duration: float = 0.25) -> None:
    """Move + click at a viewport-relative coordinate."""
    move_to(page, x, y, duration=duration)
    pyautogui.click()
    time.sleep(0.15)


def click_locator(page: Page, locator: Locator, *, duration: float = 0.3) -> None:
    """Mouse-click the centre of a Playwright locator."""
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    if box is None:
        raise RuntimeError("locator has no bounding box (display:none?)")
    click_at(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, duration=duration)


def click_selector(page: Page, selector: str, *, duration: float = 0.3) -> None:
    """Mouse-click the first match of a CSS selector."""
    click_locator(page, page.locator(selector).first, duration=duration)


def click_first_visible(page: Page, finder_js: str, *, duration: float = 0.3) -> bool:
    """Find an element via custom JS, then OS-click its centre.

    ``finder_js`` is a JS expression that returns the target element's
    centre coordinates as ``{x, y}`` (viewport-relative), or ``null``
    when no candidate is found. Returns ``True`` if a click was issued.
    """
    coords = page.evaluate(finder_js)
    if not coords:
        return False
    click_at(page, coords["x"], coords["y"], duration=duration)
    return True


def scroll_at(page: Page, x: float, y: float, *, dy: int, steps: int = 4) -> None:
    """Move cursor to (x, y) then mouse-wheel scroll by ``dy`` per step."""
    move_to(page, x, y, duration=0.2)
    step_delta = dy // steps
    for _ in range(steps):
        pyautogui.scroll(step_delta)
        time.sleep(0.15)


def type_at(page: Page, x: float, y: float, text: str, *, char_delay: float = 0.04) -> None:
    """Click into an input, then type with native key events."""
    click_at(page, x, y)
    pyautogui.typewrite(text, interval=char_delay)


def screen_centre_of(box: dict[str, float]) -> tuple[float, float]:
    """Centre of a bounding-box dict, for chaining."""
    return (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def coords_from_js(page: Page, finder_js: str) -> dict[str, float] | None:
    """Wrapper that runs a JS finder and returns {x, y} or None."""
    return page.evaluate(finder_js)


__all__ = [
    "click_at",
    "click_first_visible",
    "click_locator",
    "click_selector",
    "coords_from_js",
    "move_to",
    "screen_centre_of",
    "scroll_at",
    "type_at",
]
