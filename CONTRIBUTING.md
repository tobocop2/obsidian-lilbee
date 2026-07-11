# Contributing to lilbee

Thanks for your interest in contributing! lilbee is the Obsidian plugin for the
[lilbee](https://github.com/tobocop2/lilbee) local RAG knowledge base. It is written in
TypeScript, bundled with esbuild, and tested with Vitest.

## Prerequisites

- Node.js 20+
- npm

## Getting Started

```bash
git clone https://github.com/tobocop2/obsidian-lilbee.git
cd obsidian-lilbee
npm install
```

To try your build in a real vault, point the plugin at your vault's
`.obsidian/plugins/lilbee/` directory and run the watch build:

```bash
npm run dev      # esbuild watch mode -> main.js
```

Copy `main.js`, `manifest.json`, and `styles.css` into the plugin folder (or symlink the
repo), then reload Obsidian.

## Before Submitting

1. `npm run format` to auto-format
2. `npm run lint` for ESLint
3. `npm test` to run Vitest with coverage
4. `npm run build` to confirm the production bundle compiles

CI runs lint, `format:check`, the test suite, and the build on every pull request. Run them
locally first so the PR comes in green.

## Guidelines

- **Open an issue before large changes** so we can discuss the approach first.
- **100% test coverage** is enforced by Vitest thresholds; PRs that drop coverage will fail.
- **No `any`** — define interfaces in `src/types.ts` and use `unknown` plus a cast only at
  SSE boundaries.
- **All `fetch` goes through `LilbeeClient`** (`src/api.ts`); no other module calls the
  network directly.
- **Namespace CSS classes** `lilbee-*` and build DOM with Obsidian's helpers
  (`createDiv`, `createEl`, `setText`), never `innerHTML`.
- Keep user-facing strings in `src/locales/en.ts`.

See `AGENTS.md` in the repo root for the full architecture and code-style guide.

## Project layout

- `src/` holds the plugin source. `main.ts` is the entry point and wires up the commands and
  views; `api.ts` holds the `LilbeeClient` that every network call goes through; `views/`
  contains the chat, Task Center, wiki, and memories panels; `settings.ts` builds the settings
  tab; and `locales/en.ts` holds every user-facing string.
- `tests/` mirrors `src/` with Vitest unit tests. Integration tests that need a running server
  live behind `npm run test:integration`.
- `site/` is the project website published to obsidian.lilbee.sh by CI on every push to `main`.
- `esbuild.config.mjs` is the bundler that emits `main.js`, the file Obsidian actually loads.

## Testing

Unit tests run in Node with Obsidian's API mocked (there is no real DOM), so you don't need a
vault to run them. Add or update a test alongside any change in `src/`, and keep the suite at
100% coverage on statements, branches, functions, and lines; the Vitest thresholds fail the
build below that. For flows that talk to a real server, run a
local `lilbee serve` and use the integration config. Run `npm test` before opening a PR so the
coverage gate doesn't surprise you in CI.

## Running the Plugin Against a Server

The plugin needs a reachable lilbee server. In managed mode it downloads and runs the server
itself; in external mode you run `lilbee serve` and point the plugin at its URL. Either way it
talks to localhost over HTTP. See the [README](README.md) for setup.
