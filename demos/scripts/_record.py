#!/usr/bin/env python3
"""Run a scripted Obsidian demo with screen recording.

Usage: python3 demos/scripts/_record.py <demo-name>

Pre-reqs:
  1. Obsidian launched with --remote-debugging-port=9222 (see _prep.sh)
  2. lilbee external server already running, plugin already connected
  3. The demo profile vault is the active vault

What this does:
  1. Resolves the Obsidian window region via osascript.
  2. Starts ffmpeg recording (avfoundation, cropped to that region).
  3. Imports demos/scripts/<demo-name>.py and calls its run(page) function.
  4. Stops ffmpeg.
  5. Runs demos/_postprocess.sh on the .mov to produce .gif + .png.

Selectors and humanization helpers are in this module so each demo script
stays small and readable.
"""
from __future__ import annotations

import importlib
import os
import random
import signal
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "demos" / "_out"
OUT_DIR.mkdir(parents=True, exist_ok=True)

CDP_URL = "http://localhost:9222"
RECORD_DEVICE = "1:none"  # ffmpeg avfoundation: "Capture screen 0", no audio


def obsidian_window_rect() -> tuple[int, int, int, int]:
    """Return Obsidian window (x, y, w, h) in screen pixels via System Events."""
    script = """
    tell application "System Events" to tell process "Obsidian"
        set p to position of window 1
        set s to size of window 1
        set x to (item 1 of p)
        set y to (item 2 of p)
        set w to (item 1 of s)
        set h to (item 2 of s)
        return (x as string) & "," & (y as string) & "," & (w as string) & "," & (h as string)
    end tell
    """
    out = subprocess.check_output(["osascript", "-e", script], text=True).strip()
    parts = [int(p) for p in out.split(",")]
    return tuple(parts)  # type: ignore[return-value]


def position_obsidian(x: int = 120, y: int = 80, w: int = 1400, h: int = 900) -> None:
    """Move + resize the Obsidian window to a predictable region.

    Activate via System Events rather than `tell application "Obsidian"` --
    the latter sends an AppleEvent to Obsidian's main thread, which is
    sometimes blocked by Electron's renderer loop while a CDP session is
    open, producing a -1712 timeout.
    """
    script = f"""
    tell application "System Events" to tell process "Obsidian"
        set frontmost to true
        set position of window 1 to {{{x}, {y}}}
        set size of window 1 to {{{w}, {h}}}
    end tell
    """
    subprocess.run(["osascript", "-e", script], check=True, timeout=15)


def hide_other_apps() -> None:
    """Hide every visible GUI app except Obsidian + Finder.

    ffmpeg's `Capture screen 0` records the whole display; we crop in
    post to the Obsidian rect. Anything that paints in that rect during
    the recording (Slack notifications, a Terminal window, a Notes pop,
    iTerm with stdout flying by) ends up in the GIF. Hiding the other
    apps eliminates that surface entirely. Finder stays visible because
    hiding it leaves the desktop blank and the macOS focus model gets
    confused.
    """
    script = '''
    tell application "System Events"
        set procs to every process whose visible is true
        repeat with p in procs
            try
                if name of p is not "Obsidian" and name of p is not "Finder" then
                    set visible of p to false
                end if
            end try
        end repeat
    end tell
    '''
    try:
        subprocess.run(["osascript", "-e", script], timeout=10, check=False)
    except subprocess.TimeoutExpired:
        # Non-fatal: a stuck app shouldn't prevent recording.
        pass


def start_ffmpeg(out_mov: Path, crop: tuple[int, int, int, int]) -> subprocess.Popen[bytes]:
    """Start ffmpeg avfoundation recording cropped to the given region."""
    x, y, w, h = crop
    # macOS retina: avfoundation reports physical pixels. Multiply by display
    # scale (2x on standard retina). We let ffmpeg detect the size of "Capture
    # screen 0" and use the crop filter in pixel-doubled coordinates.
    scale = 2  # TODO: detect from system_profiler if non-retina
    cf = f"crop={w*scale}:{h*scale}:{x*scale}:{y*scale}"
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "avfoundation",
        "-framerate", "30",
        "-capture_cursor", "1",
        "-i", RECORD_DEVICE,
        "-vf", cf,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "ultrafast",
        str(out_mov),
    ]
    # ffmpeg avfoundation needs ~1s to negotiate the device; sleep after launch.
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    return p


def stop_ffmpeg(p: subprocess.Popen[bytes]) -> None:
    """Send 'q' to ffmpeg's stdin for a clean shutdown (preserves moov atom)."""
    if p.stdin:
        try:
            p.stdin.write(b"q")
            p.stdin.flush()
        except BrokenPipeError:
            pass
    try:
        p.wait(timeout=10)
    except subprocess.TimeoutExpired:
        p.send_signal(signal.SIGINT)
        p.wait(timeout=5)


# ---- humanization helpers (imported by demo scripts) -----------------------

def jitter_sleep(seconds: float, band: float = 0.18) -> None:
    """Sleep for seconds * (1 ± band) — the same ±18% jitter the VHS humanizer uses."""
    lo, hi = 1.0 - band, 1.0 + band
    time.sleep(seconds * random.uniform(lo, hi))


def type_chunked(page: Page, text: str, prose: bool = True) -> None:
    """Type text with mid-sentence pauses + per-line speed banding.

    - prose=True  → 38-58 ms per char (deliberate)
    - prose=False → 25-32 ms per char (practiced; for commands/paths)

    Long strings split at word boundaries with 80-260 ms thinking pauses
    between chunks.
    """
    delay_lo, delay_hi = (38, 58) if prose else (25, 32)
    if len(text) <= 24:
        page.keyboard.type(text, delay=random.uniform(delay_lo, delay_hi))
        return

    # Split into 2-4 chunks at word boundaries
    words = text.split(" ")
    n_chunks = random.randint(2, min(4, max(2, len(words) // 4)))
    per = max(1, len(words) // n_chunks)
    chunks: list[str] = []
    for i in range(0, len(words), per):
        chunks.append(" ".join(words[i:i + per]))
    # Re-attach spaces between chunks (chunks already have intra-chunk spaces)
    for i, chunk in enumerate(chunks):
        if i > 0:
            page.keyboard.type(" ", delay=random.uniform(delay_lo, delay_hi))
            jitter_sleep(random.uniform(0.08, 0.26))
        page.keyboard.type(chunk, delay=random.uniform(delay_lo, delay_hi))


def wait_for_text(page: Page, selector: str, contains: str, timeout: float = 60.0) -> None:
    """Poll a selector's innerText for a substring until found or timeout."""
    deadline = time.monotonic() + timeout
    last = ""
    while time.monotonic() < deadline:
        try:
            txt = page.locator(selector).first.inner_text()
        except Exception:
            txt = ""
        if contains in txt:
            return
        last = txt[:80]
        time.sleep(0.5)
    raise TimeoutError(f"text {contains!r} never appeared in {selector!r}; last: {last!r}")


def wait_for_idle(page: Page, selector: str, idle_for: float = 3.0, timeout: float = 120.0, min_chars: int = 50) -> None:
    """Wait until selector's innerText stops growing for idle_for seconds.

    Robust for streaming LLM output: we don't care WHAT the answer says, only
    that the streaming has finished. min_chars ensures we don't bail immediately
    on an empty selector.
    """
    deadline = time.monotonic() + timeout
    last_text = ""
    last_change = time.monotonic()
    while time.monotonic() < deadline:
        try:
            txt = page.locator(selector).last.inner_text()
        except Exception:
            txt = ""
        if txt != last_text:
            last_text = txt
            last_change = time.monotonic()
        elif len(txt) >= min_chars and (time.monotonic() - last_change) >= idle_for:
            return
        time.sleep(0.4)
    raise TimeoutError(f"selector {selector!r} never stopped changing; last len: {len(last_text)}")


# ---- main entry ------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        print("usage: python3 demos/scripts/_record.py <demo-name>", file=sys.stderr)
        sys.exit(2)
    name = sys.argv[1]

    # Import the demo module. Demo names are dash-separated (matching the
    # output GIF filename); Python modules use underscores, so translate
    # before import.
    sys.path.insert(0, str(REPO_ROOT / "demos" / "scripts"))
    demo_mod = importlib.import_module(name.replace("-", "_"))

    # Seed RNG by name so two renders of the same demo have the same jitter
    random.seed(name)

    # Position Obsidian window predictably + hide everything else so the
    # cropped capture only sees Obsidian pixels (no Terminal/iTerm/Slack
    # bleed-through if a notification lands on the recorded rect).
    print(f"==> positioning Obsidian window + hiding other apps", file=sys.stderr)
    hide_other_apps()
    position_obsidian()
    time.sleep(0.6)
    rect = obsidian_window_rect()
    print(f"    rect: {rect}", file=sys.stderr)

    # Start recording
    out_mov = REPO_ROOT / "demos" / "_out" / f"{name}.mov"
    print(f"==> recording to {out_mov}", file=sys.stderr)
    ff = start_ffmpeg(out_mov, rect)

    # Drive the demo via Playwright
    try:
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(CDP_URL)
            page = browser.contexts[0].pages[0]
            print(f"==> connected to {page.title()!r}", file=sys.stderr)
            demo_mod.run(page)
            browser.close()
    finally:
        print(f"==> stopping ffmpeg", file=sys.stderr)
        stop_ffmpeg(ff)

    # Post-process
    print(f"==> post-processing", file=sys.stderr)
    postproc = REPO_ROOT / "demos" / "_postprocess.sh"
    subprocess.run(["bash", str(postproc), str(out_mov), name], check=False)
    print(f"==> done: {name}.gif + {name}.png", file=sys.stderr)


if __name__ == "__main__":
    main()
