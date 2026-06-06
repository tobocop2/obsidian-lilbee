// Mirrors the community-store automated review locally. Not part of `npm run lint`.
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["node_modules/", "coverage/", "main.js", "dist/", "*.mjs", ".worktrees/", "tests/"] },
    ...obsidianmd.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
);
