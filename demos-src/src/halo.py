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
    TRACE.tsv: lines of "ts_us\\tx\\ty" where x,y are logical screen
        points (output of mouse.py --trace).
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

# Arrow pointer outline, tip (hotspot) at (0, 0), in unscaled points. A
# compact classic pointer. Scaled up for retina visibility.
_ARROW = [(0, 0), (0, 16), (4, 13), (7, 18), (9, 17), (6, 12), (11, 12)]
_SCALE = 2.6
_OUTLINE = 3  # white border thickness in px


def _build_cursor() -> tuple[Image.Image, int, int]:
    """Return (arrow image, tip_x, tip_y) — tip is the offset of the hotspot."""
    pts = [(x * _SCALE, y * _SCALE) for x, y in _ARROW]
    max_x = int(max(x for x, _ in pts))
    max_y = int(max(y for _, y in pts))
    margin = _OUTLINE + 1
    img = Image.new("RGBA", (max_x + 2 * margin, max_y + 2 * margin), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    off = [(x + margin, y + margin) for x, y in pts]
    # White border: stamp the silhouette in a ring of offsets, then the
    # black fill on top.
    for dx in range(-_OUTLINE, _OUTLINE + 1):
        for dy in range(-_OUTLINE, _OUTLINE + 1):
            if dx * dx + dy * dy > _OUTLINE * _OUTLINE:
                continue
            draw.polygon([(x + dx, y + dy) for x, y in off], fill=(255, 255, 255, 255))
    draw.polygon(off, fill=(20, 20, 22, 255))
    return img, margin, margin


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

    trace: list[tuple[float, float, float]] = []
    with open(trace_path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) != 3:
                continue
            try:
                ts_us = int(parts[0])
                x = float(parts[1])
                y = float(parts[2])
            except ValueError:
                continue
            trace.append((ts_us / 1000.0, x, y))
    trace.sort()
    trace = [(t, x, y) for (t, x, y) in trace if start_ms <= t <= start_ms + dur_ms]

    cursor, tip_x, tip_y = _build_cursor()

    os.makedirs(out_dir, exist_ok=True)
    n_frames = int(dur_ms / 1000.0 * fps)

    trace_i = 0
    for frame in range(n_frames):
        t_frame = start_ms + frame * 1000.0 / fps
        while trace_i + 1 < len(trace) and trace[trace_i + 1][0] <= t_frame:
            trace_i += 1
        img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        if trace and trace_i < len(trace):
            _, lx, ly = trace[trace_i]
            # Logical -> retina, minus crop origin, then place the arrow tip
            # (hotspot) on the cursor point.
            px = int(lx * 2 - crop_x - tip_x)
            py = int(ly * 2 - crop_y - tip_y)
            img.paste(cursor, (px, py), cursor)
        img.save(os.path.join(out_dir, f"halo-{frame:05d}.png"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
