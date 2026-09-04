import { execFile, spawn } from "child_process";
import {
    appendFileSync,
    existsSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    unlinkSync,
    copyFileSync,
    cpSync,
    statSync,
    renameSync,
    readdirSync,
    rmSync,
} from "fs";
import { basename, join, resolve, dirname } from "path";
import { createHash } from "crypto";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Injectable Node bindings; exported for test mocking. */
export const node = {
    spawn,
    execFile: execFileAsync,
    appendFileSync,
    existsSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    unlinkSync,
    copyFileSync,
    cpSync,
    statSync,
    renameSync,
    readdirSync,
    rmSync,
    join,
    basename,
    resolve,
    dirname,
    createHash,
    processKill: process.kill.bind(process),
    fetch: window.fetch.bind(window),
};
