import { defineConfig } from "vitest/config";

// Real-process orphan-reaping integration test. No coverage gate (it drives the
// OS, not branches) and no obsidian server; runs across Linux/macOS/Windows in
// CI via `npm run test:reap`.
export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        setupFiles: ["tests/setup.ts"],
        include: ["tests/reap.integration.test.ts"],
        testTimeout: 60_000,
        alias: {
            obsidian: new URL("./tests/__mocks__/obsidian.ts", import.meta.url).pathname,
        },
    },
});
