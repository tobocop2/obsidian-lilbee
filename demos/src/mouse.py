#!/usr/bin/env python3
"""Cursor helper used by the demo recorder.

Why this exists: the computer-use MCP ``mouse_move`` is instant — the
OS cursor jumps from source to target with no interpolation, and a
30 fps screen capture sees the jump as a teleport. This file uses
pyautogui to drive the OS cursor along a Bezier curve at high
frequency so ffmpeg records continuous motion.

Usage:

    python3 mouse.py move X Y          # smooth move only
    python3 mouse.py click X Y         # smooth move + click
    python3 mouse.py type "text"       # type with per-char delay
    python3 mouse.py key KEY           # single key press (e.g. 'escape')
    python3 mouse.py scroll X Y AMOUNT # scroll N ticks at (X, Y)
    python3 mouse.py pos               # print current cursor pos as 'X Y'

All coords are in macOS logical points (the screen coordinate system),
matching what pyautogui exposes via ``pyautogui.size()`` / ``position()``.
The Node side of the harness is responsible for translating viewport
coords from Playwright (browser DOM) to logical screen coords.
"""
from __future__ import annotations

import math
import os
import random
import subprocess
import sys
import time

# When set, every cursor position is appended to this file as
# "ts_us\tx\ty\n". record.ts reads it after the run to drive a halo
# overlay in post-processing.
_TRACE_PATH = os.environ.get("MOUSE_TRACE_PATH")


def _trace(x: float, y: float) -> None:
    if _TRACE_PATH:
        try:
            with open(_TRACE_PATH, "a") as f:
                f.write(f"{int(time.time() * 1_000_000)}\t{x:.1f}\t{y:.1f}\n")
        except OSError:
            pass

try:
    import pyautogui

    pyautogui.PAUSE = 0.0
    pyautogui.FAILSAFE = False
except ImportError as exc:
    print(f"pyautogui required: {exc}", file=sys.stderr)
    sys.exit(2)


# Distance -> total move duration. Short hops snap quick; long sweeps
# take longer so the curve has room to breathe.
_MIN_MS = 220
_MAX_MS = 900
_PX_PER_SEC = 1900

# Perpendicular control-point offset as a fraction of straight-line
# distance. A small arc reads as a real hand; a big arc reads as a
# circus trick.
_CURVE_FRACTION = 0.07

# Sub-step granularity. ffmpeg records at 30 fps, so ~33 ms / step
# means roughly one rendered frame per intermediate point. We push to
# 16 ms (60 fps inside pyautogui) so motion always has more samples
# than the capture can resolve.
_STEP_MS = 16


def _duration_for(dx: float, dy: float) -> float:
    distance = math.hypot(dx, dy)
    target = distance / _PX_PER_SEC * 1000
    return max(_MIN_MS, min(_MAX_MS, target))


def _bezier_points(start: tuple[float, float], end: tuple[float, float], n_steps: int) -> list[tuple[float, float]]:
    sx, sy = start
    ex, ey = end
    dx, dy = ex - sx, ey - sy
    distance = math.hypot(dx, dy)
    if distance < 4:
        return [end]
    # Perpendicular unit vector + signed offset.
    perp_x, perp_y = -dy / distance, dx / distance
    side = 1 if random.random() < 0.5 else -1
    offset = distance * _CURVE_FRACTION * side
    cx = (sx + ex) / 2 + perp_x * offset
    cy = (sy + ey) / 2 + perp_y * offset
    points: list[tuple[float, float]] = []
    for i in range(1, n_steps + 1):
        t = _ease_in_out_quad(i / n_steps)
        omt = 1.0 - t
        bx = omt * omt * sx + 2 * omt * t * cx + t * t * ex
        by = omt * omt * sy + 2 * omt * t * cy + t * t * ey
        points.append((bx, by))
    return points


def _ease_in_out_quad(t: float) -> float:
    return 2 * t * t if t < 0.5 else 1 - (-2 * t + 2) ** 2 / 2


def smooth_move(x: float, y: float) -> None:
    start = pyautogui.position()
    duration_ms = _duration_for(x - start.x, y - start.y)
    n_steps = max(8, int(duration_ms / _STEP_MS))
    points = _bezier_points((start.x, start.y), (x, y), n_steps)
    if not points:
        return
    per_step_s = (duration_ms / 1000.0) / len(points)
    for px, py in points:
        pyautogui.moveTo(px, py)
        _trace(px, py)
        time.sleep(per_step_s)


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: mouse.py <move|click|type|key|scroll|pos> [args]", file=sys.stderr)
        return 2
    cmd, *args = argv
    # Trace current position at command entry so the halo overlay has
    # a sample even for non-move commands (click, key, type).
    p0 = pyautogui.position()
    _trace(p0.x, p0.y)
    if cmd == "pos":
        pos = pyautogui.position()
        print(f"{pos.x} {pos.y}")
        return 0
    if cmd == "move":
        x, y = float(args[0]), float(args[1])
        smooth_move(x, y)
        return 0
    if cmd == "click":
        x, y = float(args[0]), float(args[1])
        smooth_move(x, y)
        time.sleep(0.15)
        pyautogui.click()
        time.sleep(0.08)
        return 0
    if cmd == "rightclick":
        x, y = float(args[0]), float(args[1])
        smooth_move(x, y)
        time.sleep(0.15)
        pyautogui.rightClick()
        time.sleep(0.08)
        return 0
    if cmd == "type":
        text = args[0]
        # pyautogui.typewrite on macOS drops or duplicates chars at
        # speed and pyautogui.hotkey('cmd','v') occasionally types 'v'
        # literally. AppleScript via System Events is reliable for
        # both per-char animation and clipboard paste.
        if len(text) > 30:
            subprocess.run(["pbcopy"], input=text, text=True, check=True)
            time.sleep(0.15)
            subprocess.run(
                [
                    "osascript",
                    "-e",
                    'tell application "System Events" to keystroke "v" using command down',
                ],
                check=True,
            )
            time.sleep(0.15)
        else:
            # Build a single AppleScript that types each char with a
            # small delay so the viewer sees the animation.
            esc = lambda c: c.replace("\\", "\\\\").replace('"', '\\"')
            lines = ['tell application "System Events"']
            for ch in text:
                lines.append(f'keystroke "{esc(ch)}"')
                lines.append("delay 0.07")
            lines.append("end tell")
            subprocess.run(["osascript", "-e", "\n".join(lines)], check=True)
        return 0
    if cmd == "menu":
        # Smooth-move the cursor over a context-menu item by name,
        # then click it. We ask AppleScript for the menu item's screen
        # position so the viewer sees the cursor move onto the item
        # and click it, the same way a person would.
        name = args[0]
        pos_script = (
            'tell application "System Events"\n'
            '  tell process "Obsidian"\n'
            f'    set pos to position of menu item "{name}" of menu 1\n'
            f'    set sz to size of menu item "{name}" of menu 1\n'
            '    return (item 1 of pos) & "," & (item 2 of pos) & "," & (item 1 of sz) & "," & (item 2 of sz)\n'
            '  end tell\n'
            'end tell'
        )
        try:
            out = subprocess.run(
                ["osascript", "-e", pos_script], check=True, capture_output=True, text=True,
            ).stdout.strip()
        except subprocess.CalledProcessError as e:
            print(f"menu-click '{name}' failed to find item: {e.stderr}", file=sys.stderr)
            return 1
        parts = out.split(", ")
        if len(parts) != 4:
            print(f"menu-click '{name}' got unexpected position output: {out}", file=sys.stderr)
            return 1
        mx, my, mw, mh = [int(p) for p in parts]
        cx, cy = mx + mw // 2, my + mh // 2
        smooth_move(cx, cy)
        _trace(cx, cy)
        time.sleep(0.18)
        pyautogui.click()
        time.sleep(0.1)
        return 0
    if cmd == "key":
        key = args[0]
        # Hotkey like "cmd+p" maps to pyautogui.hotkey('cmd','p').
        if "+" in key:
            parts = [p.strip() for p in key.split("+")]
            pyautogui.hotkey(*parts)
        else:
            pyautogui.press(key)
        return 0
    if cmd == "scroll":
        x, y = float(args[0]), float(args[1])
        amount = int(args[2])
        smooth_move(x, y)
        time.sleep(0.15)
        # Real trackpad/wheel scrolls don't fire as a continuous spin.
        # Emit short bursts of 3-4 ticks, then a noticeable pause, so
        # the captured scroll reads as a series of swipes rather than
        # one long blur.
        ticks = abs(amount)
        sign = 1 if amount > 0 else -1
        i = 0
        while i < ticks:
            burst = min(4, ticks - i)
            for _ in range(burst):
                pyautogui.scroll(sign)
                time.sleep(0.045)
            i += burst
            time.sleep(0.12 + random.uniform(0, 0.06))
        return 0
    print(f"unknown command: {cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
