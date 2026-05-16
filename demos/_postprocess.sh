#!/usr/bin/env bash
# Convert a QuickTime .mov screen recording into an optimized .gif + .png still
# for the obsidian-lilbee demo reel.
#
# Usage:
#   bash demos/_postprocess.sh <input.mov> [name] [still-offset-seconds]
#
# Input is a QuickTime "Selected Portion" recording of the Obsidian window at
# 1400x900. The output GIF crops the top 32 px to strip macOS window chrome
# (title bar / traffic-lights), so it reads as platform-neutral.
#
# Outputs:
#   demos/_out/<name>.gif   (24 fps, palette-optimized, gifsicle-pruned)
#   demos/_out/<name>.png   (still pulled from <still-offset> seconds in)
#
# Optional env vars:
#   SPEED=N   speed-up multiplier applied to the whole clip (default 1).
#             Use SPEED=4 to compress a long crawl/wait demo into a
#             watchable GIF. Both video pts and the still-offset are
#             scaled by 1/SPEED so the still still lands on the same
#             logical beat.
#
# Defaults:
#   name             = basename of input minus .mov
#   still-offset     = 2  (seconds; pick a representative frame)

set -euo pipefail

INPUT=${1:?"usage: $0 <input.mov> [name] [still-offset]"}
NAME=${2:-$(basename "$INPUT" .mov)}
SPEED=${SPEED:-1}
# Default: still at 90% of duration so it shows the landed state, not the intro.
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT" 2>/dev/null || echo "10")
DEFAULT_STILL=$(awk -v d="$DURATION" -v s="$SPEED" 'BEGIN { printf "%.1f", (d * 0.9) / s }')
STILL_OFFSET=${3:-$DEFAULT_STILL}
# When SPEED != 1 the input timestamp the still gets sampled from must be
# in pre-speedup seconds; the post-speedup still-offset is what the user
# experiences. Translate back: t_in = t_out * SPEED.
STILL_OFFSET_IN=$(awk -v t="$STILL_OFFSET" -v s="$SPEED" 'BEGIN { printf "%.2f", t * s }')

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
OUT_DIR="$REPO_ROOT/demos/_out"
mkdir -p "$OUT_DIR"

PALETTE=$(mktemp /tmp/palette-XXXXXX.png)
trap 'rm -f "$PALETTE"' EXIT

# No crop: leave the macOS chrome / Obsidian frame visible so the GIF shows
# the full plugin window, not a clipped portion.
SCALE_FILTER="scale=1400:-2:flags=lanczos"
GIF_FPS=24

# Speed multiplier: applies setpts=PTS/SPEED to the video stream so the
# whole clip plays back faster. Combine with fps so the output GIF stays
# at the target frame rate.
PTS_FILTER="setpts=PTS/${SPEED}"

echo "==> $NAME : palette gen (speed=${SPEED}x)"
ffmpeg -y -loglevel error -i "$INPUT" \
  -vf "${PTS_FILTER},fps=${GIF_FPS},${SCALE_FILTER},palettegen=max_colors=256" \
  "$PALETTE"

echo "==> $NAME : gif encode"
ffmpeg -y -loglevel error -i "$INPUT" -i "$PALETTE" \
  -lavfi "${PTS_FILTER},fps=${GIF_FPS},${SCALE_FILTER} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4" \
  "$OUT_DIR/$NAME.gif"

if command -v gifsicle >/dev/null; then
  echo "==> $NAME : gifsicle optimize"
  gifsicle -O3 --lossy=80 -b "$OUT_DIR/$NAME.gif"
fi

echo "==> $NAME : still at ${STILL_OFFSET}s (sampled from ${STILL_OFFSET_IN}s in)"
ffmpeg -y -loglevel error -ss "$STILL_OFFSET_IN" -i "$INPUT" \
  -vf "${SCALE_FILTER}" \
  -frames:v 1 "$OUT_DIR/$NAME.png"

echo "==> done. size: $(du -h "$OUT_DIR/$NAME.gif" | cut -f1) gif, $(du -h "$OUT_DIR/$NAME.png" | cut -f1) png"
