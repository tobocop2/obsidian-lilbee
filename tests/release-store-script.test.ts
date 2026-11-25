import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const STORE_SCRIPT = fileURLToPath(new URL("../scripts/release_store.sh", import.meta.url));
const BETA_SCRIPT = fileURLToPath(new URL("../scripts/release.sh", import.meta.url));
const nodeMajor = process.versions.node.split(".")[0];

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
}

interface Fixture {
    repo: string;
    env: NodeJS.ProcessEnv;
}

// A throwaway repo whose origin is a local bare repo, with a stub gh on PATH,
// so the script runs end to end without publishing anything. The launcher
// dependency has the same version as the plugin: the defect case.
function makeFixture(cur: string, nvmrc: string): Fixture {
    const root = mkdtempSync(join(tmpdir(), "release-script-"));
    const origin = join(root, "origin.git");
    const repo = join(root, "repo");
    const bin = join(root, "bin");
    mkdirSync(bin);
    git(root, "init", "-q", "--bare", "-b", "main", origin);
    git(root, "init", "-q", "-b", "main", repo);
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "t");
    git(repo, "remote", "add", "origin", origin);

    const lock = {
        name: "p",
        version: cur,
        lockfileVersion: 3,
        requires: true,
        packages: {
            "": { name: "p", version: cur, dependencies: { lilbee: cur } },
            "node_modules/lilbee": {
                version: cur,
                resolved: `https://registry.npmjs.org/lilbee/-/lilbee-${cur}.tgz`,
                integrity: "sha512-abc",
            },
        },
    };
    const files: Record<string, string> = {
        "package.json": JSON.stringify({ name: "p", version: cur, dependencies: { lilbee: cur } }, null, 2),
        "package-lock.json": JSON.stringify(lock, null, 2),
        // minAppVersion equals the plugin version, so a global replace would change it.
        "manifest.json": JSON.stringify({ id: "p", version: cur, minAppVersion: cur }, null, "\t"),
        "versions.json": JSON.stringify({ [cur]: cur }, null, "\t"),
        ".nvmrc": nvmrc,
    };
    for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(repo, name), body + "\n");
    }
    git(repo, "add", ...Object.keys(files));
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "push", "-q", "origin", "main");

    const gh = join(bin, "gh");
    writeFileSync(gh, '#!/bin/sh\n[ "$2" = "list" ] && echo 1\n[ "$1" = "api" ] && echo v0.0.0\nexit 0\n');
    chmodSync(gh, 0o755);
    return { repo, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

function run(script: string, fx: Fixture): ReturnType<typeof spawnSync> {
    return spawnSync("bash", [script], { cwd: fx.repo, env: fx.env, encoding: "utf8" });
}

function readJson(repo: string, name: string): any {
    return JSON.parse(readFileSync(join(repo, name), "utf8"));
}

function expectOnlyPluginVersionMoved(fx: Fixture, cur: string, next: string): void {
    const lock = readJson(fx.repo, "package-lock.json");
    expect(lock.version).toBe(next);
    expect(lock.packages[""].version).toBe(next);
    expect(lock.packages[""].dependencies.lilbee).toBe(cur);
    expect(lock.packages["node_modules/lilbee"].version).toBe(cur);
    expect(lock.packages["node_modules/lilbee"].resolved).toContain(cur);

    expect(readJson(fx.repo, "package.json").version).toBe(next);
    expect(readJson(fx.repo, "package.json").dependencies.lilbee).toBe(cur);
    expect(readJson(fx.repo, "manifest.json").version).toBe(next);
    expect(readJson(fx.repo, "manifest.json").minAppVersion).toBe(cur);
}

describe.skipIf(process.platform === "win32")("scripts/release_store.sh", () => {
    it("bumps the plugin version and leaves the launcher dependency in the lock alone", () => {
        const fx = makeFixture("0.6.101", nodeMajor);
        const res = run(STORE_SCRIPT, fx);
        expect(res.status, String(res.stderr)).toBe(0);

        expectOnlyPluginVersionMoved(fx, "0.6.101", "0.6.102");
        expect(readJson(fx.repo, "versions.json")["0.6.102"]).toBe("0.6.101");
        expect(git(fx.repo, "tag", "--list", "0.6.102").trim()).toBe("0.6.102");
    });

    it("refuses to run when the active Node does not match .nvmrc", () => {
        const fx = makeFixture("0.6.101", String(Number(nodeMajor) + 1));
        const res = run(STORE_SCRIPT, fx);
        expect(res.status).toBe(1);
        expect(res.stderr).toContain(".nvmrc needs Node");
        expect(git(fx.repo, "tag", "--list").trim()).toBe("");
        expect(readJson(fx.repo, "package.json").version).toBe("0.6.101");
    });
});

describe.skipIf(process.platform === "win32")("scripts/release.sh", () => {
    it("bumps the beta version and leaves the launcher dependency in the lock alone", () => {
        const fx = makeFixture("0.6.101b7", nodeMajor);
        const res = run(BETA_SCRIPT, fx);
        expect(res.status, String(res.stderr)).toBe(0);

        expectOnlyPluginVersionMoved(fx, "0.6.101b7", "0.6.101b8");
        expect(git(fx.repo, "tag", "--list", "v0.6.101b8").trim()).toBe("v0.6.101b8");
    });
});
