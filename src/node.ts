import { requestUrl } from "obsidian";
import { execFile, spawn } from "child_process";
import { get as httpsGet } from "https";
import {
    appendFileSync,
    createWriteStream,
    existsSync,
    mkdirSync,
    chmodSync,
    writeFileSync,
    readFileSync,
    unlinkSync,
    copyFileSync,
    cpSync,
    statSync,
    statfs,
    renameSync,
    readdirSync,
    rmSync,
} from "fs";
import { basename, join, resolve, dirname } from "path";
import { createHash } from "crypto";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const statfsAsync = promisify(statfs);

/** Injectable Node bindings; exported for test mocking. */
export const node = {
    spawn,
    execFile: execFileAsync,
    appendFileSync,
    existsSync,
    mkdirSync,
    chmodSync,
    writeFileSync,
    readFileSync,
    unlinkSync,
    copyFileSync,
    cpSync,
    statSync,
    statfs: statfsAsync,
    renameSync,
    readdirSync,
    rmSync,
    createWriteStream,
    join,
    basename,
    resolve,
    dirname,
    createHash,
    processKill: process.kill.bind(process),
    requestUrl,
    // Node's https, not the renderer's fetch: GitHub's asset redirect fails CORS in the renderer.
    httpsGet,
    fetch: window.fetch.bind(window),
};
