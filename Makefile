.PHONY: build test lint format format-check release release-store demo demo-prep demo-publish

build:  ## esbuild → main.js
	npm run build

test:  ## vitest with v8 coverage (100% required)
	npm test

lint:  ## eslint src/ tests/
	npm run lint

format:  ## prettier --write
	npm run format

format-check:  ## prettier --check
	npm run format:check

release:  ## Bump the beta version, tag, push, and create the GH release
	bash scripts/release.sh

release-store:  ## Bump the stable version, tag (no v prefix), and release with assets
	bash scripts/release_store.sh

demo-prep:  ## Stage harness deps via the gh-pages worktree
	bash scripts/demo.sh prep

demo:  ## Record every demo tape via the gh-pages worktree
	bash scripts/demo.sh render

demo-publish:  ## Commit + push refreshed renders on gh-pages
	bash scripts/demo.sh publish
