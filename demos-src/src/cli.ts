/**
 * CLI entry.
 *
 *   npm run demo tour              -> records tapes/tour.ts via record()
 *   npm run demo:all               -> records every tapes/*.ts
 */
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { record } from "./record.ts";
import type { Storyboard } from "./lib.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TAPES_DIR = join(REPO_ROOT, "tapes");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const names = all
    ? readdirSync(TAPES_DIR)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => f.replace(/\.ts$/, ""))
    : args.filter((a) => !a.startsWith("--"));

  if (names.length === 0) {
    console.error("usage: npm run demo <name> [<name>...]   or   npm run demo:all");
    process.exitCode = 1;
    return;
  }

  for (const name of names) {
    const tapePath = join(TAPES_DIR, `${name}.ts`);
    console.log(`\n==> ${name}`);
    const mod = await import(pathToFileURL(tapePath).href);
    const sb = mod.default as Storyboard | undefined;
    if (!sb) throw new Error(`${tapePath} has no default export`);
    await record(sb);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
