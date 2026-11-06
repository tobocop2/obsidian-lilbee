.PHONY: build test lint format format-check fixtures release release-store demo demo-prep demo-publish

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

# The route schema the contract tests read, as a lilbee release attaches it.
# Pin one with LILBEE_RELEASE=v0.6.90b700.
LILBEE_RELEASE ?= latest
LILBEE_ASSETS = https://github.com/tobocop2/lilbee/releases/$(if $(filter latest,$(LILBEE_RELEASE)),latest/download,download/$(LILBEE_RELEASE))

fixtures:  ## Download openapi.json from a lilbee release
	curl -fsSL --retry 3 -o tests/fixtures/openapi.json $(LILBEE_ASSETS)/openapi.json

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
