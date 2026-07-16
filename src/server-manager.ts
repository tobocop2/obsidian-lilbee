import type { ChildProcess } from "child_process";
import type { Readable } from "stream";
import type { ServerState } from "./types";
import { LOG_FILE, LOGS_DIR, PLATFORM, SERVER_STATE } from "./types";
import { node } from "./binary-manager";
import { appendCapped } from "./utils/capped-log";

/** Human-readable cause for a child that went away: signal beats exit code. */
function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
    if (signal) return `signal ${signal}`;
    if (code !== null) return `exit code ${code}`;
    return "unknown cause";
}

const SERVER_MANAGER_CONFIG = {
    HEALTH_POLL_INTERVAL_MS: 1000,
    HEALTH_POLL_MAX_ATTEMPTS: 120,
    ADOPT_PROBE_TIMEOUT_MS: 2000,
    ADOPTED_WATCH_INTERVAL_MS: 5000,
    SHUTDOWN_REQUEST_TIMEOUT_MS: 3000,
    // Must exceed the server's own worst-case fleet teardown (bounded ~10s
    // server-side) so a graceful stop is never cut short by an escalation.
    STOP_GRACE_MS: 12_000,
    KILL_GRACE_MS: 5000,
    CRASH_RESTART_DELAY_MS: 3000,
    MAX_CRASH_RESTARTS: 3,
    PORT_FILE_POLL_INTERVAL_MS: 500,
    PORT_FILE_MAX_ATTEMPTS: 240,
    SPAWN_CRASH_LOG_MAX_BYTES: 262_144,
} as const;

/** Exit code a refused `lilbee serve` uses when another server holds its lock. */
export const LOCK_REFUSAL_EXIT_CODE = 3;

/** Sidecar the server writes next to its scope lock, naming the holder. */
const SCOPE_OWNER_FILE = "server.scope.owner.json";

/** Identity of the server holding the shared root, read from its sidecar. */
export interface ScopeOwner {
    dataDir: string;
    pid: number;
}

/** The server refused to start: another vault's server owns the shared root. */
export class ScopeHeldError extends Error {
    constructor(serverOutput: string) {
        super(serverOutput || "another lilbee server owns the shared root");
        this.name = "ScopeHeldError";
    }
}

export function readScopeOwner(sharedRoot: string): ScopeOwner | null {
    const path = node.join(sharedRoot, SCOPE_OWNER_FILE);
    if (!node.existsSync(path)) return null;
    try {
        const parsed = JSON.parse(node.readFileSync(path, "utf-8")) as {
            data_dir?: unknown;
            pid?: unknown;
        };
        if (typeof parsed.data_dir !== "string" || typeof parsed.pid !== "number") return null;
        return { dataDir: parsed.data_dir, pid: parsed.pid };
    } catch {
        return null;
    }
}

/** Port + bearer token of the server serving *dataDir*, from its session files. */
export function readServerSession(dataDir: string): { port: number; token: string } | null {
    try {
        const portRaw = node.readFileSync(node.join(dataDir, "data", "server.port"), "utf-8");
        const port = parseInt(portRaw.trim(), 10);
        if (isNaN(port) || port <= 0 || port > 65535) return null;
        const sessionRaw = node.readFileSync(node.join(dataDir, "data", "server.json"), "utf-8");
        const parsed = JSON.parse(sessionRaw) as { token?: unknown };
        if (typeof parsed.token !== "string") return null;
        return { port, token: parsed.token };
    } catch {
        return null;
    }
}

/**
 * Ask the server serving *dataDir* to stop, via its own API. True when the
 * request was accepted. Talks fetch directly rather than through LilbeeClient:
 * the target is reached during lifecycle negotiation (possibly another vault's
 * server, with its own token and port) before any client for it exists.
 */
export async function requestServerShutdown(dataDir: string): Promise<boolean> {
    const session = readServerSession(dataDir);
    if (session === null) return false;
    try {
        const res = await node.fetch(`http://127.0.0.1:${session.port}/api/shutdown`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.token}` },
            signal: AbortSignal.timeout(SERVER_MANAGER_CONFIG.SHUTDOWN_REQUEST_TIMEOUT_MS),
        });
        return res.ok;
    } catch {
        return false;
    }
}

/** Poll until the server serving *dataDir* stops answering; false on timeout. */
export async function awaitServerGone(dataDir: string, timeoutMs: number): Promise<boolean> {
    const session = readServerSession(dataDir);
    if (session === null) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await node.fetch(`http://127.0.0.1:${session.port}/api/health`, {
                signal: AbortSignal.timeout(SERVER_MANAGER_CONFIG.ADOPT_PROBE_TIMEOUT_MS),
            });
        } catch {
            return true;
        }
        await new Promise((r) => window.setTimeout(r, SERVER_MANAGER_CONFIG.PORT_FILE_POLL_INTERVAL_MS));
    }
    return false;
}

export interface ServerManagerOptions {
    binaryPath: string;
    dataDir: string;
    /**
     * The shared root every vault's server competes for. Passed to the server
     * as its exclusive scope, so the one-managed-server-ever invariant is
     * enforced by an OS lock the server holds, not by plugin bookkeeping.
     */
    sharedRoot: string;
    /**
     * HuggingFace cache and GGUF storage. Set via `LILBEE_MODELS_DIR` so the
     * server uses the same path across all vaults — without it, lilbee would
     * scope models to each per-vault data-dir and re-download per vault.
     */
    modelsDir: string;
    ragSystemPrompt: string;
    generalSystemPrompt: string;
    /**
     * Version of the installed binary, i.e. what a spawn would launch. May
     * carry the release tag's leading "v", which the server's health report
     * omits. Empty when unknown; adoption then skips the version check.
     */
    installedVersion: string;
    onStateChange?: (state: ServerState) => void;
    onRestartsExhausted?: (output: string) => void;
    onShutdownFailure?: (error: Error) => void;
    /** Receives one line per lifecycle decision (spawn, adopt, stop, crash-restart). */
    onJournal?: (message: string) => void;
}

const DESIRED = {
    RUNNING: "running",
    STOPPED: "stopped",
} as const;

type Desired = (typeof DESIRED)[keyof typeof DESIRED];

/**
 * Supervises the one managed server for this vault's data dir.
 *
 * The supervisor never hunts processes: a healthy server found at start is
 * adopted, a server it must replace is asked to exit over its API, and only
 * its own spawned child is ever signalled — with the exit awaited, so
 * "stopped" always means the process is gone and its exit event consumed.
 * Mutual exclusion lives in the server's own OS locks (data dir + scope);
 * a refused spawn surfaces as ScopeHeldError instead of a crash loop.
 */
export class ServerManager {
    private opts: ServerManagerOptions;
    private child: ChildProcess | null = null;
    /** Resolves when the current child's exit event fires; created at spawn. */
    private childExit: Promise<void> | null = null;
    private desired: Desired = DESIRED.STOPPED;
    private adopted = false;
    private adoptedWatch: number | null = null;
    private _state: ServerState = SERVER_STATE.STOPPED;
    private crashCount = 0;
    private restartTimer: number | null = null;
    private _actualPort: number | null = null;
    private _outputLines: string[] = [];
    /** Set when the child can no longer come up (spawn error, refusal, restarts exhausted); aborts discovery. */
    private fatalStartError: Error | null = null;
    /** Bumped per start(); a superseded attempt's discovery loop steps aside. */
    private startGeneration = 0;
    private static readonly MAX_OUTPUT_LINES = 20;

    constructor(opts: ServerManagerOptions) {
        this.opts = opts;
    }

    get lastOutput(): string {
        return this._outputLines.join("\n");
    }

    get state(): ServerState {
        return this._state;
    }

    get serverUrl(): string {
        if (this._actualPort === null) return "";
        return `http://127.0.0.1:${this._actualPort}`;
    }

    get dataDir(): string {
        return this.opts.dataDir;
    }

    private get portFilePath(): string {
        return `${this.opts.dataDir}/data/server.port`;
    }

    private get crashLogPath(): string {
        return `${this.opts.dataDir}/${LOGS_DIR}/${LOG_FILE.SPAWN_CRASH}`;
    }

    /** Persist the output ring buffer so a crash survives an Obsidian restart. */
    private snapshotCrashOutput(): void {
        const header = `=== crash ${new Date().toISOString()} ===\n`;
        appendCapped(
            this.crashLogPath,
            `${header}${this.lastOutput}\n`,
            SERVER_MANAGER_CONFIG.SPAWN_CRASH_LOG_MAX_BYTES,
        );
    }

    private setState(s: ServerState): void {
        this._state = s;
        this.opts.onStateChange?.(s);
    }

    private journal(message: string): void {
        this.opts.onJournal?.(message);
    }

    /** True when stop() has been requested; a method so TS narrowing can't fold it away. */
    private stopRequested(): boolean {
        return this.desired === DESIRED.STOPPED;
    }

    /** Throws when waiting any longer is pointless: superseded, unrecoverable, or stopped. */
    private assertStartupViable(generation: number): void {
        if (this.startGeneration !== generation) throw new Error("Superseded by a newer start");
        if (this.fatalStartError) throw this.fatalStartError;
        if (this.stopRequested()) throw new Error("Server was stopped during startup");
    }

    private async waitForPortFile(generation: number): Promise<void> {
        for (let i = 0; i < SERVER_MANAGER_CONFIG.PORT_FILE_MAX_ATTEMPTS; i++) {
            this.assertStartupViable(generation);
            if (node.existsSync(this.portFilePath)) {
                const content = node.readFileSync(this.portFilePath, "utf-8").trim();
                const port = parseInt(content, 10);
                if (!isNaN(port) && port > 0 && port <= 65535) {
                    this._actualPort = port;
                    return;
                }
            }
            await new Promise((r) => window.setTimeout(r, SERVER_MANAGER_CONFIG.PORT_FILE_POLL_INTERVAL_MS));
        }
        throw new Error("Port file not found within timeout");
    }

    private buildSpawnEnv(): Record<string, string | undefined> {
        const env: Record<string, string | undefined> = {
            ...process.env,
            // Force UTF-8 locale/stdio: GUI-spawned children inherit no locale,
            // so the server defaults to ASCII and crashes crawling non-ASCII output.
            LANG: "en_US.UTF-8",
            LC_ALL: "en_US.UTF-8",
            PYTHONIOENCODING: "utf-8",
            PYTHONUTF8: "1",
            LILBEE_CORS_ORIGINS: "app://obsidian.md",
            LILBEE_PARENT_PID: String(process.pid),
            LILBEE_MODELS_DIR: this.opts.modelsDir,
            LILBEE_EXCLUSIVE_SCOPE: this.opts.sharedRoot,
        };
        if (this.opts.ragSystemPrompt) {
            env.LILBEE_RAG_SYSTEM_PROMPT = this.opts.ragSystemPrompt;
        }
        if (this.opts.generalSystemPrompt) {
            env.LILBEE_GENERAL_SYSTEM_PROMPT = this.opts.generalSystemPrompt;
        }
        return env;
    }

    private pushOutputLine(line: string): void {
        this._outputLines.push(line);
        if (this._outputLines.length > ServerManager.MAX_OUTPUT_LINES) {
            this._outputLines.shift();
        }
    }

    private attachOutputCapture(child: ChildProcess): void {
        this.attachStreamCapture(child.stdout);
        this.attachStreamCapture(child.stderr);
    }

    private attachStreamCapture(stream: Readable | null): void {
        if (!stream) return;
        let partial = "";
        stream.on("data", (chunk: Buffer) => {
            partial += chunk.toString();
            const lines = partial.split("\n");
            partial = lines.pop()!;
            for (const line of lines) {
                if (line.length > 0) this.pushOutputLine(line);
            }
        });
    }

    private attachLifecycleHandlers(child: ChildProcess): void {
        child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
            // A process this manager no longer tracks has no say in its state.
            if (child !== this.child) return;
            this.child = null;
            if (this.desired === DESIRED.STOPPED) return;
            if (code === LOCK_REFUSAL_EXIT_CODE) {
                // Another server owns the lock; the server's refusal message is
                // already in the output capture. Not a crash: no restart loop.
                this.journal(`spawned server pid ${child.pid} refused to start: another server owns the shared root`);
                this.fatalStartError = new ScopeHeldError(this.lastOutput);
                this.setState(SERVER_STATE.ERROR);
                return;
            }
            this.pushOutputLine(`server exited (${describeExit(code, signal)})`);
            this.journal(`server pid ${child.pid} exited (${describeExit(code, signal)})`);
            this.snapshotCrashOutput();
            this.scheduleCrashRestart();
        });
        child.on("error", (err: Error) => {
            if (child !== this.child) return;
            this.child = null;
            if (this.desired === DESIRED.STOPPED) return;
            const line = `failed to launch server: ${err.message}`;
            this.journal(line);
            this.pushOutputLine(line);
            this.snapshotCrashOutput();
            this.fatalStartError = new Error(`Failed to launch server: ${err.message}`);
            this.setState(SERVER_STATE.ERROR);
        });
    }

    private scheduleCrashRestart(): void {
        if (this.crashCount < SERVER_MANAGER_CONFIG.MAX_CRASH_RESTARTS) {
            this.crashCount++;
            this.journal(
                `restarting in ${SERVER_MANAGER_CONFIG.CRASH_RESTART_DELAY_MS}ms ` +
                    `(attempt ${this.crashCount}/${SERVER_MANAGER_CONFIG.MAX_CRASH_RESTARTS})`,
            );
            this.setState(SERVER_STATE.ERROR);
            this.restartTimer = window.setTimeout(() => {
                this.restartTimer = null;
                /* v8 ignore next -- stop() clears this timer before flipping desired, so the false branch is unreachable */
                if (this.desired === DESIRED.RUNNING) void this.startForRestart();
            }, SERVER_MANAGER_CONFIG.CRASH_RESTART_DELAY_MS);
            return;
        }
        this.journal(`server did not stay up after ${SERVER_MANAGER_CONFIG.MAX_CRASH_RESTARTS} restarts; giving up`);
        this.fatalStartError = new Error(
            `Server kept exiting and did not come back after ${SERVER_MANAGER_CONFIG.MAX_CRASH_RESTARTS} restarts`,
        );
        this.setState(SERVER_STATE.ERROR);
        this.opts.onRestartsExhausted?.(this.lastOutput);
    }

    /** Crash-loop restart: failures already surface via state + onRestartsExhausted, so don't rethrow. */
    private async startForRestart(): Promise<void> {
        try {
            await this.start();
        } catch {
            // already reported
        }
    }

    private spawnChild(): ChildProcess {
        // No --port: the server binds 0, the kernel picks a free port, and
        // the chosen value is written to data/server.port for us to read.
        const args = ["serve", "--host", "127.0.0.1", "--data-dir", this.opts.dataDir];
        const child = node.spawn(this.opts.binaryPath, args, {
            env: this.buildSpawnEnv(),
            stdio: ["ignore", "pipe", "pipe"],
            // POSIX: own process group so stop() can signal the server *and* its
            // worker forks as a unit. Windows uses taskkill /t for the tree.
            detached: process.platform !== PLATFORM.WIN32,
        });
        this.childExit = new Promise((resolve) => child.once("exit", () => resolve()));
        this.attachOutputCapture(child);
        this.attachLifecycleHandlers(child);
        return child;
    }

    async start(): Promise<void> {
        if (this.child || this.adopted) return;
        const generation = ++this.startGeneration;
        this.desired = DESIRED.RUNNING;
        this._actualPort = null;
        this.fatalStartError = null;
        this.setState(SERVER_STATE.STARTING);
        this._outputLines = [];

        // Adopt-first: a healthy server already serving this data dir is the
        // singleton, not garbage. A plugin reload re-attaches instead of
        // replacing it; a server whose Obsidian died exits on its own via the
        // parent monitor and simply fails this probe. One exception: a server
        // running a different version than the installed binary is asked to
        // exit, so a binary update takes effect on the next reload.
        if (await this.tryAdopt()) {
            this.crashCount = 0;
            this.setState(SERVER_STATE.READY);
            return;
        }

        // A leftover server.port from a previous run would be adopted as this
        // child's port, so it must be gone before the spawn. The probe above
        // already established nothing live is behind it.
        this.cleanupPortFile();

        this.child = this.spawnChild();
        this.journal(`spawned server pid ${this.child.pid}`);

        try {
            await this.waitForPortFile(generation);
            await this.waitForReady(generation);
            this.crashCount = 0;
            this.setState(SERVER_STATE.READY);
        } catch (err) {
            // A crash-restart superseded this attempt; the newer start owns the state.
            if (this.startGeneration !== generation) return;
            // A stop() mid-startup aborted the discovery on purpose; not a failure.
            if (this.stopRequested()) return;
            if (this.child) await this.stop();
            this.setState(SERVER_STATE.ERROR);
            throw err;
        }
    }

    private async tryAdopt(): Promise<boolean> {
        const session = readServerSession(this.opts.dataDir);
        if (session === null) return false;
        const health = await this.probeHealth(session.port);
        if (health === null) return false;
        if (this.versionDiffers(health.version) && (await this.replaceMismatched(health.version))) return false;
        this._actualPort = session.port;
        this.adopted = true;
        this.watchAdopted();
        this.journal(`adopted running server on port ${session.port}`);
        return true;
    }

    /** True when running and installed versions differ; "v"-prefixed and bare forms compare equal, unknown never differs. */
    private versionDiffers(running: string): boolean {
        const installed = this.opts.installedVersion.replace(/^v/, "");
        const current = running.replace(/^v/, "");
        return installed !== "" && current !== "" && installed !== current;
    }

    /** Ask a version-mismatched server to exit; false when it will not go (the caller then adopts it anyway). */
    private async replaceMismatched(running: string): Promise<boolean> {
        this.journal(
            `running server version ${running} differs from installed ${this.opts.installedVersion}; asking it to exit`,
        );
        const accepted = await requestServerShutdown(this.opts.dataDir);
        if (accepted && (await awaitServerGone(this.opts.dataDir, SERVER_MANAGER_CONFIG.STOP_GRACE_MS))) return true;
        this.journal("outdated server did not stop when asked; adopting it anyway");
        return false;
    }

    /** lilbee's health report, or null when the port is dead or answers with a foreign shape. */
    private async probeHealth(port: number): Promise<{ version: string } | null> {
        try {
            const res = await node.fetch(`http://127.0.0.1:${port}/api/health`, {
                signal: AbortSignal.timeout(SERVER_MANAGER_CONFIG.ADOPT_PROBE_TIMEOUT_MS),
            });
            if (!res.ok) return null;
            // The port file can outlive a SIGKILLed server, and the port can be
            // reused by anything. Only lilbee's health shape earns adoption.
            const body = (await res.json()) as { status?: unknown; version?: unknown };
            if (body.status !== "ok") return null;
            return { version: typeof body.version === "string" ? body.version : "" };
        } catch {
            return null;
        }
    }

    /** Health-poll an adopted server; there is no child process to emit exit events. */
    private watchAdopted(): void {
        this.adoptedWatch = window.setInterval(() => {
            void this.checkAdopted();
        }, SERVER_MANAGER_CONFIG.ADOPTED_WATCH_INTERVAL_MS);
    }

    private stopAdoptedWatch(): void {
        if (this.adoptedWatch !== null) {
            window.clearInterval(this.adoptedWatch);
            this.adoptedWatch = null;
        }
    }

    private async checkAdopted(): Promise<void> {
        if (!this.adopted || this._actualPort === null) return;
        if ((await this.probeHealth(this._actualPort)) !== null) return;
        if (!this.adopted || this.desired === DESIRED.STOPPED) return;
        this.stopAdoptedWatch();
        this.adopted = false;
        this._actualPort = null;
        const line = "adopted server became unreachable";
        this.journal(line);
        this.pushOutputLine(line);
        this.snapshotCrashOutput();
        this.scheduleCrashRestart();
    }

    private async waitForReady(generation: number): Promise<void> {
        for (let i = 0; i < SERVER_MANAGER_CONFIG.HEALTH_POLL_MAX_ATTEMPTS; i++) {
            this.assertStartupViable(generation);
            const url = this.serverUrl;
            /* v8 ignore next -- waitForReady runs only after waitForPortFile sets the port, so url is always non-empty */
            if (url) {
                try {
                    // Bootstrap probe via the injectable node abstraction: runs during
                    // spawn before any LilbeeClient exists, and stays test-swappable.
                    const res = await node.fetch(`${url}/api/health`);
                    if (res.ok) return;
                } catch {
                    // not ready yet
                }
            }
            await new Promise((r) => window.setTimeout(r, SERVER_MANAGER_CONFIG.HEALTH_POLL_INTERVAL_MS));
        }
        throw new Error("Server did not become ready within timeout");
    }

    /**
     * Signal the child's whole process group (server + worker forks). The child
     * leads its own group because it was spawned detached; fall back to the bare
     * child if the group send fails (e.g. it already exited).
     */
    private signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
        if (child.pid) {
            try {
                node.processKill(-child.pid, signal);
                return;
            } catch {
                // group gone; fall through to the direct kill
            }
        }
        child.kill(signal);
    }

    private cleanupPortFile(): void {
        if (!node.existsSync(this.portFilePath)) return;
        try {
            node.unlinkSync(this.portFilePath);
        } catch {
            // ignore cleanup errors
        }
    }

    /** Resolves true when the child's exit fires within *ms*; false on timeout. */
    private async exitedWithin(ms: number): Promise<boolean> {
        if (this.childExit === null) return true;
        return Promise.race([
            this.childExit.then(() => true),
            new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), ms)),
        ]);
    }

    /**
     * Stop the server and return only once its process is observably gone.
     *
     * Escalation: ask over the API, then SIGTERM the group, then SIGKILL it —
     * and await the exit event at the end regardless, so no exit can land
     * after stop() returns and be mistaken for a crash.
     */
    async stop(): Promise<void> {
        this.desired = DESIRED.STOPPED;
        if (this.restartTimer) {
            window.clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }

        if (this.adopted) {
            this.stopAdoptedWatch();
            await this.stopAdopted();
            this.adopted = false;
            this._actualPort = null;
            this.setState(SERVER_STATE.STOPPED);
            return;
        }

        const child = this.child;
        if (!child) {
            this.setState(SERVER_STATE.STOPPED);
            return;
        }

        await this.terminateChild(child);

        this.child = null;
        this.childExit = null;
        this._actualPort = null;
        this.setState(SERVER_STATE.STOPPED);
        this.cleanupPortFile();
    }

    /** Ask the child to exit, escalate on timeout, and await the observed exit. */
    private async terminateChild(child: ChildProcess): Promise<void> {
        const stopStartedAt = Date.now();
        const accepted = await requestServerShutdown(this.opts.dataDir);
        this.journal(`stopping server pid ${child.pid}: shutdown request ${accepted ? "accepted" : "not accepted"}`);
        if (!(await this.exitedWithin(SERVER_MANAGER_CONFIG.STOP_GRACE_MS))) {
            if (process.platform === PLATFORM.WIN32) {
                // taskkill /f /t is the tree kill; Windows has no group signal.
                this.journal(`sent taskkill /f /t to pid ${child.pid}`);
                try {
                    await node.execFile("taskkill", ["/pid", String(child.pid), "/f", "/t"]);
                } catch (err) {
                    this.opts.onShutdownFailure?.(err instanceof Error ? err : new Error(String(err)));
                }
            } else {
                this.journal(`sent SIGTERM to pid ${child.pid} group`);
                this.signalGroup(child, "SIGTERM");
                if (!(await this.exitedWithin(SERVER_MANAGER_CONFIG.KILL_GRACE_MS))) {
                    this.journal(`sent SIGKILL to pid ${child.pid} group`);
                    this.signalGroup(child, "SIGKILL");
                }
            }
            // SIGKILL (and taskkill /f) cannot be ignored; the exit event is
            // guaranteed, so this await is what makes "stopped" mean stopped.
            await this.childExit;
        }
        this.journal(`server pid ${child.pid} exit observed after ${Date.now() - stopStartedAt}ms`);
    }

    /** Ask an adopted server to exit; report when it will not go. */
    private async stopAdopted(): Promise<void> {
        const accepted = await requestServerShutdown(this.opts.dataDir);
        const gone = accepted && (await awaitServerGone(this.opts.dataDir, SERVER_MANAGER_CONFIG.STOP_GRACE_MS));
        if (gone) {
            this.journal("adopted server stopped when asked");
            this.cleanupPortFile();
            return;
        }
        // Not our child: there is no process handle to signal. Its own
        // supervisor (parent monitor, OS locks) bounds how long it lingers.
        this.journal("adopted server did not stop when asked");
        this.opts.onShutdownFailure?.(new Error("the running server did not stop when asked"));
    }

    async restart(): Promise<void> {
        await this.stop();
        this.crashCount = 0;
        await this.start();
    }
}
