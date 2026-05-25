#!/usr/bin/env python3
"""Render a synthetic cursor PNG sequence from a recorded cursor trace.

The OS cursor in the avfoundation screen capture vanishes whenever it's
stationary (auto-hidden) and is captured inconsistently while moving, which
reads as a broken / disappearing cursor. So the capture runs with the OS
cursor OFF and we draw our own arrow pointer here, following the recorded
path. One always-visible, smooth cursor, no doubling.

Usage:
    python3 halo.py TRACE.tsv OUT_DIR WIDTH HEIGHT \
        START_MS DURATION_MS FPS CROP_X CROP_Y

Inputs:
    TRACE.tsv: lines of "ts_us\\tx\\ty" or "ts_us\\tx\\ty\\tstyle" where
        x,y are logical screen points (output of mouse.py --trace) and
        style is the CSS cursor under the pointer (default/pointer/text);
        it selects the arrow / hand / I-beam glyph.
    OUT_DIR: directory to write cursor-NNNNN.png frames (named halo-* for
        the recorder's overlay glob).
    WIDTH, HEIGHT: output PNG dimensions (the cropped video size in
        retina pixels).
    START_MS: video t=0 expressed as a wall-clock-ms timestamp; trace
        entries earlier than this are dropped.
    DURATION_MS: how much wall-clock time the video covers.
    FPS: frames per second of the video (30).
    CROP_X, CROP_Y: the top-left of the crop in retina pixels.

The cursor logical (x, y) is converted to retina (x*2, y*2), shifted by
the crop origin, and the arrow's tip (hotspot) is placed exactly there.
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw

# Glyph outlines in unscaled points, hotspot expressed separately. Scaled
# up for retina visibility. The hotspot is the logical cursor point: the
# arrow's tip, the hand's fingertip, the I-beam's centre.
_ARROW = [(0, 0), (0, 16), (4, 13), (7, 18), (9, 17), (6, 12), (11, 12)]
_ARROW_HOTSPOT = (0, 0)

# Pointing hand (index finger up), hotspot at the fingertip. Drawn as a
# silhouette so it reads as the "clickable" cursor without fine detail.
_HAND = [
    (5, 0), (7, 1), (7, 9),          # index finger
    (9, 8), (10, 9), (10, 8),        # middle finger knuckle
    (12, 9), (13, 10), (13, 9),      # ring finger knuckle
    (15, 11), (15, 22),              # pinky + right side of palm down to cuff
    (4, 22),                         # cuff bottom-left
    (4, 16), (1, 13),                # thumb
    (3, 11), (5, 11),                # palm back up to the finger base
]
_HAND_HOTSPOT = (5, 0)

_SCALE = 2.6
_OUTLINE = 3  # white border thickness in px

# I-beam half-dimensions in unscaled points (drawn procedurally, not as a
# polygon): stem half-height, serif half-width, stem half-width.
_IBEAM_H = 9
_IBEAM_SERIF = 4
_IBEAM_STEM = 1


def _stamp_outline(draw: "ImageDraw.ImageDraw", polys: list[list[tuple[float, float]]]) -> None:
    """Stamp a white border ring under each polygon, then a dark fill."""
    for dx in range(-_OUTLINE, _OUTLINE + 1):
        for dy in range(-_OUTLINE, _OUTLINE + 1):
            if dx * dx + dy * dy > _OUTLINE * _OUTLINE:
                continue
            for poly in polys:
                draw.polygon([(x + dx, y + dy) for x, y in poly], fill=(255, 255, 255, 255))
    for poly in polys:
        draw.polygon(poly, fill=(20, 20, 22, 255))


def _build_polygon_glyph(points: list[tuple[int, int]], hotspot: tuple[int, int]) -> tuple[Image.Image, int, int]:
    pts = [(x * _SCALE, y * _SCALE) for x, y in points]
    max_x = int(max(x for x, _ in pts))
    max_y = int(max(y for _, y in pts))
    margin = _OUTLINE + 1
    img = Image.new("RGBA", (max_x + 2 * margin, max_y + 2 * margin), (0, 0, 0, 0))
    off = [(x + margin, y + margin) for x, y in pts]
    _stamp_outline(ImageDraw.Draw(img), [off])
    return img, int(hotspot[0] * _SCALE) + margin, int(hotspot[1] * _SCALE) + margin


def _build_ibeam() -> tuple[Image.Image, int, int]:
    h = _IBEAM_H * _SCALE
    serif = _IBEAM_SERIF * _SCALE
    stem = _IBEAM_STEM * _SCALE
    margin = _OUTLINE + 1
    w = int(2 * serif)
    full_h = int(2 * h)
    img = Image.new("RGBA", (w + 2 * margin, full_h + 2 * margin), (0, 0, 0, 0))
    cx = w / 2 + margin
    top, bot = margin, full_h + margin
    # Stem + top/bottom serifs as three rectangles (as polygons for the
    # shared outline stamp).
    stem_rect = [(cx - stem, top), (cx + stem, top), (cx + stem, bot), (cx - stem, bot)]
    top_serif = [(cx - serif, top), (cx + serif, top), (cx + serif, top + stem * 1.5), (cx - serif, top + stem * 1.5)]
    bot_serif = [(cx - serif, bot - stem * 1.5), (cx + serif, bot - stem * 1.5), (cx + serif, bot), (cx - serif, bot)]
    _stamp_outline(ImageDraw.Draw(img), [stem_rect, top_serif, bot_serif])
    return img, int(cx), int((top + bot) / 2)


def _build_cursors() -> dict[str, tuple[Image.Image, int, int]]:
    """One glyph per CSS cursor family: arrow / hand / I-beam."""
    return {
        "default": _build_polygon_glyph(_ARROW, _ARROW_HOTSPOT),
        "pointer": _build_polygon_glyph(_HAND, _HAND_HOTSPOT),
        "text": _build_ibeam(),
    }


def _glyph_for(style: str) -> str:
    s = (style or "").strip().lower()
    if s == "pointer":
        return "pointer"
    if s in ("text", "vertical-text"):
        return "text"
    return "default"


def main(argv: list[str]) -> int:
    (
        trace_path,
        out_dir,
        width_s,
        height_s,
        start_ms_s,
        dur_ms_s,
        fps_s,
        crop_x_s,
        crop_y_s,
    ) = argv[:9]
    width, height = int(width_s), int(height_s)
    start_ms = int(start_ms_s)
    dur_ms = int(dur_ms_s)
    fps = int(fps_s)
    crop_x, crop_y = int(crop_x_s), int(crop_y_s)

    trace: list[tuple[float, float, float, str]] = []
    with open(trace_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            try:
                ts_us = int(parts[0])
                x = float(parts[1])
                y = float(parts[2])
            except ValueError:
                continue
            style = parts[3] if len(parts) >= 4 else "default"
            trace.append((ts_us / 1000.0, x, y, style))
    trace.sort(key=lambda e: e[0])
    trace = [e for e in trace if start_ms <= e[0] <= start_ms + dur_ms]

    cursors = _build_cursors()

    os.makedirs(out_dir, exist_ok=True)
    n_frames = int(dur_ms / 1000.0 * fps)

    trace_i = 0
    for frame in range(n_frames):
        t_frame = start_ms + frame * 1000.0 / fps
        while trace_i + 1 < len(trace) and trace[trace_i + 1][0] <= t_frame:
            trace_i += 1
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        if trace and trace_i < len(trace):
            _, lx, ly, style = trace[trace_i]
            cursor, hot_x, hot_y = cursors[_glyph_for(style)]
            # Logical -> retina, minus crop origin, then place the glyph's
            # hotspot on the cursor point.
            px = int(lx * 2 - crop_x - hot_x)
            py = int(ly * 2 - crop_y - hot_y)
            img.paste(cursor, (px, py), cursor)
        img.save(os.path.join(out_dir, f"halo-{frame:05d}.png"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
