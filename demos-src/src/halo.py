#!/usr/bin/env python3
"""Generate a transparent halo PNG sequence from a cursor trace.

Usage:
    python3 halo.py TRACE.tsv OUT_DIR WIDTH HEIGHT \
        START_MS DURATION_MS FPS CROP_X CROP_Y

Inputs:
    TRACE.tsv: lines of "ts_us\\tx\\ty" where x,y are logical screen
        points (output of mouse.py --trace).
    OUT_DIR: directory to write halo-NNNNN.png frames.
    WIDTH, HEIGHT: output PNG dimensions (the cropped video size in
        retina pixels).
    START_MS: video t=0 expressed as a wall-clock-ms timestamp; trace
        entries earlier than this are dropped.
    DURATION_MS: how much wall-clock time the video covers.
    FPS: frames per second of the video (30).
    CROP_X, CROP_Y: the top-left of the crop in retina pixels.

The cursor logical (x, y) is converted to retina (x*2, y*2) then
shifted by the crop origin so the halo lands on the cursor in the
cropped video.
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw


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

    # Soft halo brush: a stack of concentric semi-transparent circles
    # plus a brighter inner ring. Bumped to 96 px so the macOS cursor
    # at retina is easy to spot in the final webm.
    halo_r = 96
    brush_size = halo_r * 2
    brush = Image.new("RGBA", (brush_size, brush_size), (0, 0, 0, 0))
    d = ImageDraw.Draw(brush)
    for r in range(halo_r, 12, -6):
        # Quadratic falloff with slightly higher peak alpha so the
        # outer glow stays visible on light backgrounds.
        alpha = int(150 * (1 - r / halo_r) ** 2)
        d.ellipse(
            (halo_r - r, halo_r - r, halo_r + r, halo_r + r),
            fill=(255, 215, 90, alpha),
        )
    d.ellipse(
        (halo_r - 22, halo_r - 22, halo_r + 22, halo_r + 22),
        outline=(255, 240, 150, 255),
        width=6,
    )

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
            # Convert logical -> retina, subtract crop offset, then
            # center the brush on the cursor tip.
            cx = int(lx * 2 - crop_x - halo_r)
            cy = int(ly * 2 - crop_y - halo_r)
            if -brush_size < cx < width and -brush_size < cy < height:
                img.paste(brush, (cx, cy), brush)
        img.save(os.path.join(out_dir, f"halo-{frame:05d}.png"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
