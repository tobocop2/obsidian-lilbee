import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
    { ignores: ["node_modules/", "coverage/", "main.js", "dist/", "*.mjs", ".worktrees/"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    prettierConfig,
    {
        rules: {
            "@typescript-eslint/no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                destructuredArrayIgnorePattern: "^_",
            }],
            "@typescript-eslint/no-explicit-any": "error",
        },
    },
    {
        files: ["src/views/chat-view.ts", "src/views/setup-wizard.ts"],
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    },
    {
        files: ["tests/**/*.ts"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unsafe-function-type": "off",
            "no-empty": "off",
            "require-yield": "off",
        },
    },
);
