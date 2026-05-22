.PHONY: demo demo-prep demo-publish

# Demo generation lives here, off main. scripts/demo.sh on main is a
# thin wrapper that worktrees gh-pages and delegates to these targets.
# OBSIDIAN_LILBEE_REPO_ROOT (passed in by the wrapper) points at the main
# checkout so demo recordings can reference paths there if needed.

TAPES := tour chat add lilbee_on_lilbee crawl catalog settings command_palette multi_vault first_start

demo-prep:  ## Install harness deps; verify Obsidian + CDP + lilbee server are reachable
	@test -d demos-src/node_modules || ( cd demos-src && npm install )
	@command -v ffmpeg >/dev/null || ( echo "ffmpeg required (brew install ffmpeg)" >&2; exit 1 )
	@python3 -c "import pyautogui" 2>/dev/null || ( echo "pyautogui required (pip3 install pyautogui)" >&2; exit 1 )

demo:  ## Record every tape into demos/ (CDP + pyautogui driven)
	@cd demos-src && npm run demo:all
	@cp demos-src/output/*.webm demos/
	@cp demos-src/output/*.contact.png demos/

demo-publish:  ## Commit refreshed demos/ + push gh-pages
	git add demos/
	@if git diff --cached --quiet; then \
		echo "==> no changes to publish."; \
	else \
		git commit -m "demos: refresh rendered reel"; \
		echo "==> committed on gh-pages. push with: git push origin gh-pages"; \
	fi
