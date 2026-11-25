import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/release_store.sh", import.meta.url));
const nodeMajor = process.versions.node.split(".")[0];

const CUR = "0.6.101";
const NEXT = "0.6.102";

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function write(path: string, body: string): void {
    writeFileSync(path, body);
}

interface Fixture {
    repo: string;
    env: NodeJS.ProcessEnv;
}

// A throwaway repo whose origin is a local bare repo, with a stub gh on PATH,
// so the script runs end to end without publishing anything.
function makeFixture(nvmrc: string): Fixture {
    const root = mkdtempSync(join(tmpdir(), "release-store-"));
    const origin = join(root, "origin.git");
    const repo = join(root, "repo");
    const bin = join(root, "bin");
    mkdirSync(bin);
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    git(root, "init", "-q", "-b", "main", repo);
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "t");
    git(repo, "remote", "add", "origin", origin);

    // The launcher dependency has the same version as the plugin: the defect case.
    const lock = {
        name: "p",
        version: CUR,
        lockfileVersion: 3,
        requires: true,
        packages: {
            "": { name: "p", version: CUR, dependencies: { lilbee: CUR } },
            "node_modules/lilbee": {
                version: CUR,
                resolved: `https://registry.npmjs.org/lilbee/-/lilbee-${CUR}.tgz`,
                integrity: "sha512-abc",
            },
        },
    };
    write(
        join(repo, "package.json"),
        JSON.stringify({ name: "p", version: CUR, dependencies: { lilbee: CUR } }, null, 2) + "\n",
    );
    write(join(repo, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
    write(
        join(repo, "manifest.json"),
        JSON.stringify({ id: "p", version: CUR, minAppVersion: "1.8.7" }, null, "\t") + "\n",
    );
    write(join(repo, "versions.json"), JSON.stringify({ [CUR]: "1.8.7" }, null, "\t") + "\n");
    write(join(repo, ".nvmrc"), nvmrc + "\n");
    git(repo, "add", "package.json", "package-lock.json", "manifest.json", "versions.json", ".nvmrc");
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "push", "-q", "origin", "main");

    const gh = join(bin, "gh");
    write(gh, '#!/bin/sh\n[ "$2" = "list" ] && echo 1\nexit 0\n');
    chmodSync(gh, 0o755);
    return { repo, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

function run(fx: Fixture): ReturnType<typeof spawnSync> {
    return spawnSync("bash", [SCRIPT], { cwd: fx.repo, env: fx.env, encoding: "utf8" });
}

function readJson(repo: string, name: string): any {
    return JSON.parse(readFileSync(join(repo, name), "utf8"));
}

describe.skipIf(process.platform === "win32")("scripts/release_store.sh", () => {
    let fx: Fixture;

    beforeEach(() => {
        fx = makeFixture(nodeMajor);
    });

    it("bumps the plugin version and leaves the launcher dependency in the lock alone", () => {
        const res = run(fx);
        expect(res.status, String(res.stderr)).toBe(0);

        const lock = readJson(fx.repo, "package-lock.json");
        expect(lock.version).toBe(NEXT);
        expect(lock.packages[""].version).toBe(NEXT);
        expect(lock.packages[""].dependencies.lilbee).toBe(CUR);
        expect(lock.packages["node_modules/lilbee"].version).toBe(CUR);
        expect(lock.packages["node_modules/lilbee"].resolved).toContain(CUR);

        expect(readJson(fx.repo, "package.json").version).toBe(NEXT);
        expect(readJson(fx.repo, "package.json").dependencies.lilbee).toBe(CUR);
        expect(readJson(fx.repo, "manifest.json").version).toBe(NEXT);
        expect(readJson(fx.repo, "versions.json")[NEXT]).toBe("1.8.7");
        expect(git(fx.repo, "tag", "--list", NEXT).trim()).toBe(NEXT);
    });

    it("refuses to run when the active Node does not match .nvmrc", () => {
        const other = makeFixture(String(Number(nodeMajor) + 1));
        const res = run(other);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain(".nvmrc needs Node");
        expect(git(other.repo, "tag", "--list").trim()).toBe("");
        expect(readJson(other.repo, "package.json").version).toBe(CUR);
    });
});
