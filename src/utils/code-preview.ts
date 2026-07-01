// Maps a source file to the Prism language id Obsidian's bundled highlighter
// understands, so code source previews render as highlighted code instead of
// plain text. Extensions absent here (markdown, plain text) render as-is.
const EXTENSION_LANGUAGE: Record<string, string> = {
    py: "python",
    pyi: "python",
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    scala: "scala",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    swift: "swift",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    json: "json",
    jsonc: "json",
    xml: "xml",
    sql: "sql",
    lua: "lua",
    dart: "dart",
    ex: "elixir",
    exs: "elixir",
    hs: "haskell",
};

// Extensionless filenames that are still code.
const FILENAME_LANGUAGE: Record<string, string> = {
    dockerfile: "docker",
    makefile: "makefile",
};

/** Prism language id for a source path, or null when it should render as-is. */
export function languageForSource(source: string): string | null {
    const name = source.replace(/^.*[\\/]/, "").toLowerCase();
    const dot = name.lastIndexOf(".");
    if (dot <= 0) {
        return FILENAME_LANGUAGE[name] ?? null;
    }
    return EXTENSION_LANGUAGE[name.slice(dot + 1)] ?? null;
}

/** Pixels to scroll a rendered code block so the cited line sits near the top
 *  with a couple of lines of lead-in — the code equivalent of the PDF preview's
 *  jump to the cited page. Returns 0 when there is nothing to scroll to. */
export function citedLineScrollTop(scrollHeight: number, totalLines: number, line: number | null): number {
    if (line === null || line <= 1 || totalLines <= 0 || scrollHeight <= 0) return 0;
    const lineHeight = scrollHeight / totalLines;
    return Math.max(0, (line - 1) * lineHeight - lineHeight * 2);
}

/** Wrap content in a fenced code block whose fence outlives any backtick run
 *  inside it, so embedded backticks can't close the block early. */
export function toCodeFence(content: string, lang: string): string {
    const longestRun = (content.match(/`+/g) ?? []).reduce((n, run) => Math.max(n, run.length), 0);
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    return `${fence}${lang}\n${content}\n${fence}`;
}
