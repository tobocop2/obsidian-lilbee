# lilbee Obsidian Plugin — Development Guide

## Project

Obsidian plugin for [lilbee](../../), a local RAG knowledge base. In managed mode the plugin downloads and runs the lilbee server itself; in external mode it talks to a `lilbee serve` you run. Either way it communicates over localhost HTTP. TypeScript, esbuild, Vitest.

## Commands

```bash
npm run build        # Production build → main.js
npm run dev          # Watch mode (esbuild)
npm test             # Vitest with v8 coverage (100% required)
npm run test:watch   # Vitest watch mode
```

From the repo root: `make plugin-build`, `make plugin-test`, `make plugin-dev`.

## Architecture

```
src/
  main.ts            # Plugin entry: lifecycle, commands, ribbon, status bar, auto-sync
  types.ts           # All interfaces + DEFAULT_SETTINGS + as-const constant sets
  api.ts             # LilbeeClient — typed HTTP client with SSE streaming
  settings.ts        # Settings tab + model management UI
  binary-manager.ts  # Downloads and verifies the lilbee server binary per platform
  server-manager.ts  # Spawns/stops the managed server, discovers its auto-assigned port
  session-token.ts   # Discovers / holds the server session token
  vault-registry.ts  # Shared-install lock + per-vault registry (one server at a time)
  task-queue.ts      # Background job queue that feeds the Task Center
  wiki-sync.ts       # Mirrors wiki pages into the vault as markdown
  storage-stats.ts   # Disk-usage reporting for the shared install
  utils.ts, utils/   # Shared helpers (e.g. model-ref parsing)
  locales/en.ts      # User-facing strings (MESSAGES)
  components/         # Reusable render components (model cards, etc.)
  views/             # Chat sidebar, search, model catalog, Task Center, wiki,
                     # source preview, crawl, documents, setup wizard, status,
                     # and the modals they use
```

**Key design decisions:**
- `LilbeeClient` is the only module that calls `fetch`. All other modules go through it.
- Streaming endpoints (chat, sync, model pull) use `async*` generators yielding `SSEEvent`.
- Views create DOM in `onOpen()`, never in the constructor.
- All CSS classes are namespaced `lilbee-*`.
- Settings are merged with `DEFAULT_SETTINGS` on load for forward compatibility.

## Code Style

- **No `any`** — define interfaces in `types.ts`; use `unknown` + cast at SSE boundaries only.
- **Null guards** — always check container elements exist before manipulating DOM.
- **Error handling** — wrap all API calls in try/catch, show `new Notice(message)` on failure.
- **Constants** — named constants for magic numbers (`MAX_EXCERPT_CHARS`, `SEARCH_DEBOUNCE_MS`). Use `as const` objects for string literal sets (`SSE_EVENT`, `JSON_HEADERS`, `SERVER_STATE`, `SERVER_MODE`, `MODEL_TASK`, `CAPABILITY`, `TASK_TYPE`, …, all in `types.ts`). Never compare against raw string literals when a constant exists.
- **Obsidian DOM helpers** — use `createDiv()`, `createEl()`, `setText()`, `addClass()`. No `innerHTML`.
- **Comments state what, not a story** — a comment names a non-obvious invariant or constraint in one line. Cut the narration and justification: not "the server emits this without a code, so it's matched on the substring it always carries", just "substring the server includes when the litellm extra is missing". Avoid multi-sentence comment blocks that explain the reasoning behind the code; prefer a clear name and no comment. Same for JSDoc: describe what a function is, not the chain of consequences that motivated it.
- **Import order** — obsidian imports first, then local modules.
- **Strict TypeScript** — `noImplicitAny`, `strictNullChecks` enabled in tsconfig.

## TypeScript Best Practices

### Const Assertions for String Unions
Use `as const satisfies` objects for string literal sets shared across modules. Prefer this over enums:
```typescript
// Paired type + constant pattern for state machines
export type ServerState = "stopped" | "starting" | "ready" | "error";
export const SERVER_STATE = {
    STOPPED: "stopped",
    STARTING: "starting",
    READY: "ready",
    ERROR: "error",
} as const satisfies Record<string, ServerState>;

// Plain const assertion for event registries
export const SSE_EVENT = {
    TOKEN: "token",
    DONE: "done",
} as const;
```
Always use the constant (`SERVER_STATE.READY`) in comparisons, never the raw string (`"ready"`).

### Discriminated Unions
Model state transitions with discriminated unions, not boolean flags:
```typescript
type StreamEvent =
    | { type: "token"; data: string }
    | { type: "done"; data: null }
    | { type: "error"; data: string };
```

### Error Handling
- Wrap all `fetch` calls through a centralized `assertOk()` pattern.
- Use `try/catch` at the call site, never inside the HTTP client.
- Surface errors to users via `new Notice()`, never `console.error` alone.

### Function Length
- Target max 30 lines per function. Extract helpers when exceeding this.
- Settings display code may exceed this for fluent builder chains — acceptable when each builder call is a single statement.

### Exports
- Export only what other modules need. Keep helpers and internal functions unexported.
- Exception: export for testing is acceptable (e.g. `findBinary`, `ensureDataDir`, `node` in server-manager.ts).

### No Dead Code
- Don't leave empty lifecycle overrides (e.g. `onClose() {}`) — remove them entirely.
- Delete unused imports, variables, and functions rather than commenting them out.

### Null Handling
- Prefer `T | null` over `T | undefined` for data model fields (matches Python server).
- Use `undefined` only for optional function parameters.
- Guard nullable DOM references before use: `if (!this.el) return;`

### Type Assertions
- Minimize `as` casts. Use them only at serialization boundaries (SSE event data).
- Never use `as any` in production code. Use `as unknown as T` in tests for mock compatibility.

### Immutable Defaults
- Copy default objects with spread: `{ ...DEFAULT_SETTINGS }` to avoid shared mutation.
- Use `as const` for constant objects to prevent accidental mutation.

## Testing

### Requirements
- **100% coverage** on statements, branches, functions, and lines — enforced by vitest thresholds.
- Every new public function needs tests. Every branch needs coverage.
- Tests run in Node, not a browser — there is no real DOM.

### V8 Coverage Gotcha: Property Initializer Arrow Functions
V8 counts arrow functions in property initializers (e.g. `private cancel = () => {}`) as distinct coverable functions. If the constructor immediately overwrites the property, the initializer arrow is never called and shows as uncovered — dropping function coverage below 100% even though every *meaningful* function is tested.

**Fix:** use a type-only declaration (`private cancel: () => void`) instead of an initializer when the constructor always assigns a value. Do not dismiss the coverage gap as a "vitest quirk" — inspect `coverage-final.json` to find the exact uncovered functions:
```bash
cat coverage/coverage-final.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for path, info in data.items():
    for key, count in info['f'].items():
        if count == 0:
            fn = info['fnMap'][key]
            print(f'{path}:{fn[\"loc\"][\"start\"][\"line\"]} - {fn[\"name\"]}')
"
```

### Mock Architecture
`tests/__mocks__/obsidian.ts` provides the entire Obsidian API mock:
- `MockElement` — simulates Obsidian's enhanced HTMLElement (`createDiv`, `createEl`, `empty`, `setText`, `addClass`, `addEventListener`).
- Test helpers on MockElement: `find(cls)`, `findAll(cls)`, `trigger(event, ...args)`.
- `App`, `Plugin`, `Modal`, `ItemView`, `PluginSettingTab`, `Notice`, `Setting` — all mocked.
- `Notice.instances` array + `Notice.clear()` for asserting on user notifications.

Vitest aliases `obsidian` to this mock via `vitest.config.ts`.

### Test Patterns
```typescript
// Factory helpers reduce boilerplate
const container = new MockElement() as unknown as HTMLElement;
const app = new App();

// Async generator mocks for streaming
async function* mockStream(events: SSEEvent[]) {
    for (const e of events) yield e;
}

// Collect async generator results
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
    const items: T[] = [];
    for await (const item of gen) items.push(item);
    return items;
}

// Trigger events on MockElements
element.trigger("click", mockEvent);

// Assert notices
expect(Notice.instances.map(n => n.message)).toContain("expected message");
```

- Use `vi.useFakeTimers()` for debounce tests.
- Use `vi.stubGlobal("fetch", vi.fn())` for API tests.
- Access private methods via `(instance as any).method()` when needed.
- Call `Notice.clear()` in `beforeEach`.

### Mocking Modules While Preserving Exports
When you stub one export from a module but need its other exports (helpers, types, re-exported constants) to stay real, use `importOriginal`:
```typescript
vi.mock("../src/server-manager", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/server-manager")>();
    return {
        ...actual,  // keep everything else the module exports
        ServerManager: vi.fn().mockImplementation(() => ({ ... })),
    };
});
```

### What NOT to Mock
- Don't mock `types.ts` — use real interfaces and constants.
- Don't mock between view modules — let `renderDocumentResult` run for real in search-modal tests.

## Obsidian API Notes

- `ItemView.containerEl.children[1]` is the content area — standard convention but undocumented.
- `app.workspace.openLinkText(path, "")` opens files by path.
- `app.vault.on("create" | "modify" | "delete" | "rename", callback)` for vault events.
- `Plugin.registerEvent()` for auto-cleanup of event listeners on unload.
- `addStatusBarItem()` returns an element for status text; use `setText()`.

## Build

esbuild bundles `src/main.ts` → `main.js` (CJS, ES2022). Externals: `obsidian`, `electron`, codemirror/lezer packages, Node builtins. The output `main.js` and `manifest.json` are what gets installed into `.obsidian/plugins/lilbee/`.

## Server Dependency

The plugin needs a reachable lilbee server. In **managed mode** (default) it downloads the binary (`binary-manager.ts`), spawns it (`server-manager.ts`) on a port the OS assigns, and discovers that port and the session token from the server's data dir. In **external mode** the user runs `lilbee serve` themselves and points the plugin at its URL (default `http://127.0.0.1:7433`) plus a session token. When the server is unreachable, API calls fail gracefully with user-visible Notice messages and the status bar shows the error state.

## Dependencies & Abstractions

**DO NOT reinvent well-known abstractions.** Before implementing a common pattern (error handling, async utilities, data structures), check if a popular library exists:

| Need | Recommended Library |
|------|---------------------|
| Result/Either type | [neverthrow](https://github.com/supermacro/neverthrow) (7k+ stars, 0 deps) |
| Functional programming | [fp-ts](https://github.com/gcanti/fp-ts) |
| Async utilities | Native TypeScript (Promise.all, etc.) |

If a library is chosen, add it to `dependencies` in package.json (not devDependencies), as it will be bundled into the plugin.

Example - using neverthrow for error handling:
```typescript
import { Result, ok, err } from "neverthrow";

async function fetchData(): Promise<Result<Data, Error>> {
    try {
        return ok(await doFetch());
    } catch (e) {
        return err(e instanceof Error ? e : new Error(String(e)));
    }
}

// Usage
const result = await fetchData();
if (result.isOk()) {
    console.log(result.value);
} else {
    console.error(result.error);
}
```
