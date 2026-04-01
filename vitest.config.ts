import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
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
