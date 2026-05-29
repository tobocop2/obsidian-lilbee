import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        // Run test files sequentially. The view suites share process-level state
        // (DOM mocks, reconnect timers) that leaks across files under parallel
        // worker scheduling, which is stable locally but flakes on CI runners.
        // Sequential execution is the configuration that passes deterministically
        // everywhere; the suite is fast enough that the wall-clock cost is small.
        fileParallelism: false,
        // integration.test.ts performs a real network binary download and is run
        // by its own job (vitest.integration.config.ts, 180s timeout). Running it
        // here too made the unit suite double-execute it and let its slow download
        // skew parallel worker scheduling on CI. Keep the unit run hermetic.
        exclude: [
            "**/node_modules/**",
            "**/.worktrees/**",
            "**/.claude/**",
            "**/*.bak/**",
            "**/tests.bak/**",
            "**/integration.test.ts",
        ],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/**/*.d.ts"],
            reporter: ["text", "json-summary", "html"],
            thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
        },
        alias: {
            obsidian: new URL("./tests/__mocks__/obsidian.ts", import.meta.url).pathname,
        },
    },
});
