import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        setupFiles: ["tests/setup.ts", "tests/setup-node-paths.ts"],
        // integration.test.ts hits the network (real binary download) and runs on its
        // own 3-OS workflow (integration.yml); keep the unit suite fast and deterministic.
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
            electron: new URL("./tests/__mocks__/electron.ts", import.meta.url).pathname,
        },
    },
});
