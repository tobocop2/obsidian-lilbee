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
    STOP_GRACE_MS: 5000,
    CRASH_RESTART_DELAY_MS: 3000,
    MAX_CRASH_RESTARTS: 3,
    PORT_FILE_POLL_INTERVAL_MS: 500,
    PORT_FILE_MAX_ATTEMPTS: 240,
    SPAWN_CRASH_LOG_MAX_BYTES: 262_144,
} as const;

export interface ServerManagerOptions {
    binaryPath: string;
    dataDir: string;
    /**
     * HuggingFace cache and GGUF storage. Set via `LILBEE_MODELS_DIR` so the
     * server uses the same path across all vaults — without it, lilbee would
     * scope models to each per-vault data-dir and re-download per vault.
     */
    modelsDir: string;
    ragSystemPrompt: string;
    generalSystemPrompt: string;
    onStateChange?: (state: ServerState) => void;
    onRestartsExhausted?: (output: string) => void;
    onShutdownFailure?: (error: Error) => void;
}

export class ServerManager {
    private opts: ServerManagerOptions;
    private child: ChildProcess | null = null;
    private _state: ServerState = SERVER_STATE.STOPPED;
    private crashCount = 0;
    private stopping = false;
    private restartTimer: number | null = null;
    private _actualPort: number | null = null;
    private _outputLines: string[] = [];
    /** Set when the child can no longer come up (spawn error, restarts exhausted); aborts discovery. */
    private fatalStartError: Error | null = null;
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

    /** Throws when waiting any longer is pointless: the child is unrecoverable or the user stopped us. */
    private assertStartupViable(): void {
        if (this.fatalStartError) throw this.fatalStartError;
        if (this.stopping) throw new Error("Server was stopped during startup");
    }

    private async waitForPortFile(): Promise<void> {
        for (let i = 0; i < SERVER_MANAGER_CONFIG.PORT_FILE_MAX_ATTEMPTS; i++) {
            this.assertStartupViable();
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
            this.child = null;
            if (this.stopping) return;
            this.pushOutputLine(`server exited (${describeExit(code, signal)})`);
            this.snapshotCrashOutput();
            if (this.crashCount < SERVER_MANAGER_CONFIG.MAX_CRASH_RESTARTS) {
                this.crashCount++;
                this.setState(SERVER_STATE.ERROR);
                this.restartTimer = window.setTimeout(() => {
                    this.restartTimer = null;
                    /* v8 ignore next -- stop() clears this timer before setting stopping, so the false branch is unreachable */
                    if (!this.stopping) void this.startForRestart();
                }, SERVER_MANAGER_CONFIG.CRASH_RESTART_DELAY_MS);
                return;
            }
            this.fatalStartError = new Error(
                `Server exited (${describeExit(code, signal)}) and did not come back after ${SERVER_MANAGER_CONFIG.MAX_CRASH_RESTARTS} restarts`,
            );
            this.setState(SERVER_STATE.ERROR);
            this.opts.onRestartsExhausted?.(this.lastOutput);
        });
        child.on("error", (err: Error) => {
            this.child = null;
            if (this.stopping) return;
            this.pushOutputLine(`failed to launch server: ${err.message}`);
            this.snapshotCrashOutput();
            this.fatalStartError = new Error(`Failed to launch server: ${err.message}`);
            this.setState(SERVER_STATE.ERROR);
        });
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
            detached: false,
        });
        this.attachOutputCapture(child);
        this.attachLifecycleHandlers(child);
        return child;
    }

    async start(): Promise<void> {
        if (this.child) return;
        this.stopping = false;
        this._actualPort = null;
        this.fatalStartError = null;
        this.setState(SERVER_STATE.STARTING);
        this._outputLines = [];

        // A leftover server.port from a previous run would be adopted as this
        // child's port, so it must be gone before the spawn.
        this.cleanupPortFile();

        this.child = this.spawnChild();

        try {
            await this.waitForPortFile();
            await this.waitForReady();
            this.crashCount = 0;
            this.setState(SERVER_STATE.READY);
        } catch (err) {
            // A stop() mid-startup aborted the discovery on purpose; not a failure.
            if (this.stopping) return;
            // Kill the child we spawned so it doesn't outlive the failure and block retries.
            if (this.child) await this.stop();
            this.setState(SERVER_STATE.ERROR);
            throw err;
        }
    }

    private async waitForReady(): Promise<void> {
        for (let i = 0; i < SERVER_MANAGER_CONFIG.HEALTH_POLL_MAX_ATTEMPTS; i++) {
            this.assertStartupViable();
            const url = this.serverUrl;
            /* v8 ignore next -- waitForReady runs only after waitForPortFile sets the port, so url is always non-empty */
            if (url) {
                try {
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

    private async terminateChild(child: ChildProcess): Promise<void> {
        if (process.platform === PLATFORM.WIN32) {
            try {
                await node.execFile("taskkill", ["/pid", String(child.pid), "/f", "/t"]);
            } catch (err) {
                this.opts.onShutdownFailure?.(err instanceof Error ? err : new Error(String(err)));
            }
            return;
        }
        child.kill("SIGTERM");
    }

    private cleanupPortFile(): void {
        if (!node.existsSync(this.portFilePath)) return;
        try {
            node.unlinkSync(this.portFilePath);
        } catch {
            // ignore cleanup errors
        }
    }

    async stop(): Promise<void> {
        this.stopping = true;
        if (this.restartTimer) {
            window.clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        if (!this.child) {
            this.setState(SERVER_STATE.STOPPED);
            return;
        }

        const child = this.child;
        await this.terminateChild(child);

        const exited = await Promise.race([
            new Promise<boolean>((resolve) => child.on("exit", () => resolve(true))),
            new Promise<boolean>((resolve) =>
                window.setTimeout(() => resolve(false), SERVER_MANAGER_CONFIG.STOP_GRACE_MS),
            ),
        ]);

        if (!exited && this.child) {
            this.child.kill("SIGKILL");
        }

        this.child = null;
        this.setState(SERVER_STATE.STOPPED);
        this.cleanupPortFile();
    }

    async restart(): Promise<void> {
        await this.stop();
        this.crashCount = 0;
        await this.start();
    }
}
