// Prints the plugin's minimum lilbee server version, read from
// src/min-server-version.ts with esbuild's real TypeScript parser.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { transform } from "esbuild";

const SOURCE_PATH = fileURLToPath(new URL("../src/min-server-version.ts", import.meta.url));

/**
 * Evaluate TypeScript source and return its MIN_SERVER_VERSION export.
 * Throws when the export is missing or not a non-empty string. A static
 * `require` is blocked, which catches an added `import`; it does not
 * sandbox other side effects the source might run at evaluation time.
 */
export async function extractMinServerVersion(source) {
    const { code } = await transform(source, { loader: "ts", format: "cjs", target: "es2022" });
    const moduleObj = { exports: {} };
    const blockedRequire = () => {
        throw new Error("min-server-version.ts must not import anything");
    };
    const run = new Function("module", "exports", "require", code);
    run(moduleObj, moduleObj.exports, blockedRequire);
    const version = moduleObj.exports.MIN_SERVER_VERSION;
    if (typeof version !== "string" || version.length === 0) {
        throw new Error("MIN_SERVER_VERSION did not resolve to a non-empty string");
    }
    return version;
}

async function main(path) {
    const source = await readFile(path, "utf8");
    return extractMinServerVersion(source);
}

const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
    // An explicit path argument is for tests only; the workflow always reads the real file.
    const path = process.argv[2] ?? SOURCE_PATH;
    main(path)
        .then((version) => console.log(version))
        .catch((err) => {
            console.error(`print-min-server-version: ${err.message}`);
            process.exitCode = 1;
        });
}
