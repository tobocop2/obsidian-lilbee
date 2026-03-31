#!/bin/bash
# Generate every figlet font rendering of the email, in multiple split strategies
# Output: email-fonts.txt

OUT="email-fonts.txt"
FONTS_DIR="/opt/homebrew/Cellar/figlet/2.2.5/share/figlet/fonts"
MAX_WIDTH=44

> "$OUT"

for font_file in "$FONTS_DIR"/*.flf; do
    font=$(basename "$font_file" .flf)

    echo "================================================================================" >> "$OUT"
    echo "FONT: $font" >> "$OUT"
    echo "================================================================================" >> "$OUT"

    # Strategy 1: full email on one line
    echo "" >> "$OUT"
    echo "--- one line: tobias.perelstein@gmail.com ---" >> "$OUT"
    figlet -f "$font" -w 200 "tobias.perelstein@gmail.com" >> "$OUT" 2>/dev/null

    # Strategy 2: two lines (name + @domain)
    echo "" >> "$OUT"
    echo "--- two lines: tobias.perelstein / @gmail.com ---" >> "$OUT"
    figlet -f "$font" -w 200 "tobias.perelstein" >> "$OUT" 2>/dev/null
    figlet -f "$font" -w 200 "@gmail.com" >> "$OUT" 2>/dev/null

    # Strategy 3: three lines (tobias / .perelstein / @gmail.com)
    echo "" >> "$OUT"
    echo "--- three lines: tobias / .perelstein / @gmail.com ---" >> "$OUT"
    figlet -f "$font" -w 200 "tobias" >> "$OUT" 2>/dev/null
    figlet -f "$font" -w 200 ".perelstein" >> "$OUT" 2>/dev/null
    figlet -f "$font" -w 200 "@gmail.com" >> "$OUT" 2>/dev/null

    echo "" >> "$OUT"
    echo "" >> "$OUT"
done

echo "Done — $(wc -l < "$OUT" | tr -d ' ') lines written to $OUT"
