.PHONY: demo demo-prep demo-gifs demo-publish

# Demo generation lives here, off main. scripts/demo.sh on main is a
# thin wrapper that worktrees gh-pages and delegates to these targets.
# OBSIDIAN_LILBEE_REPO_ROOT (passed in by the wrapper) points at the main
# checkout so demo recordings can reference paths there if needed.

TAPES := tour chat add lilbee_on_lilbee crawl catalog settings command_palette multi_vault first_start

# GIF width (px). The webms are recorded at retina 3456×2158; downscaling
# to 800 keeps the GIFs viewable and the file sizes embeddable in README.
GIF_WIDTH := 800
GIF_FPS := 15
GIF_COLORS := 128

demo-prep:  ## Install harness deps; verify ffmpeg + pyautogui + gifsicle
	@test -d demos-src/node_modules || ( cd demos-src && npm install )
	@command -v ffmpeg >/dev/null || ( echo "ffmpeg required (brew install ffmpeg)" >&2; exit 1 )
	@command -v gifsicle >/dev/null || ( echo "gifsicle required (brew install gifsicle)" >&2; exit 1 )
	@python3 -c "import pyautogui" 2>/dev/null || ( echo "pyautogui required (pip3 install pyautogui)" >&2; exit 1 )

demo: demo-gifs  ## Record every tape into demos/ (webm + gif)

# Internal: record webms. Run by `make demo` via the demo-gifs dependency.
demo-record:
	@cd demos-src && npm run demo:all
	@cp demos-src/output/*.webm demos/
	@cp demos-src/output/*.contact.png demos/

# Generate animated GIFs alongside the webms. README files can't embed
# webms but can embed gifs, so every demo needs both shapes. Uses
# palettegen for quality + gifsicle --lossy to shrink the result.
demo-gifs: demo-record
	@mkdir -p demos/.gif-tmp
	@for tape in $(TAPES); do \
		webm="demos/$$tape.webm"; \
		gif="demos/$$tape.gif"; \
		pal="demos/.gif-tmp/$$tape.palette.png"; \
		[ -f "$$webm" ] || { echo "missing $$webm, skipping"; continue; }; \
		echo "==> gififying $$tape"; \
		ffmpeg -y -i "$$webm" -vf "fps=$(GIF_FPS),scale=$(GIF_WIDTH):-1:flags=lanczos,palettegen=max_colors=$(GIF_COLORS)" "$$pal" >/dev/null 2>&1; \
		ffmpeg -y -i "$$webm" -i "$$pal" -lavfi "fps=$(GIF_FPS),scale=$(GIF_WIDTH):-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5" "$$gif" >/dev/null 2>&1; \
		gifsicle -O3 --lossy=80 -b "$$gif" >/dev/null 2>&1; \
	done
	@rm -rf demos/.gif-tmp

demo-publish:  ## Commit refreshed demos/ + push gh-pages
	git add demos/
	@if git diff --cached --quiet; then \
		echo "==> no changes to publish."; \
	else \
		git commit -m "demos: refresh rendered reel"; \
		echo "==> committed on gh-pages. push with: git push origin gh-pages"; \
	fi
