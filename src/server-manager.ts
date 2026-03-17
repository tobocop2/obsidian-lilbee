import type { ChildProcess } from "child_process";
import type { ServerState } from "./types";
import { SERVER_STATE } from "./types";
import { node } from "./binary-manager";

const HEALTH_POLL_INTERVAL_MS = 500;
const HEALTH_POLL_MAX_ATTEMPTS = 30;
const STOP_GRACE_MS = 5000;
const CRASH_RESTART_DELAY_MS = 3000;
const MAX_CRASH_RESTARTS = 3;

export interface ServerManagerOptions {
    binaryPath: string;
    dataDir: string;
    port: number;
    ollamaUrl: string;
    onStateChange?: (state: ServerState) => void;
}

export class ServerManager {
    private opts: ServerManagerOptions;
    private child: ChildProcess | null = null;
    private _state: ServerState = SERVER_STATE.STOPPED;
    private crashCount = 0;
    private stopping = false;
    private restartTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(opts: ServerManagerOptions) {
        this.opts = opts;
    }

    get state(): ServerState {
        return this._state;
    }

    get serverUrl(): string {
        return `http://127.0.0.1:${this.opts.port}`;
    }

    private setState(s: ServerState): void {
        this._state = s;
        this.opts.onStateChange?.(s);
    }

    async start(): Promise<void> {
        if (this.child) return;
        this.stopping = false;
        this.setState(SERVER_STATE.STARTING);

        const args = [
            "serve",
            "--host", "127.0.0.1",
            "--port", String(this.opts.port),
            "--data-dir", this.opts.dataDir,
        ];

        const env = { ...process.env, OLLAMA_HOST: this.opts.ollamaUrl };

        this.child = node.spawn(this.opts.binaryPath, args, {
            env,
            stdio: "ignore",
            detached: false,
        });

        this.child.on("exit", (_code, _signal) => {
            this.child = null;
            if (!this.stopping && this.crashCount < MAX_CRASH_RESTARTS) {
                this.crashCount++;
                this.setState(SERVER_STATE.ERROR);
                this.restartTimer = setTimeout(() => {
                    this.restartTimer = null;
                    if (!this.stopping) void this.start();
                }, CRASH_RESTART_DELAY_MS);
            } else if (!this.stopping) {
                this.setState(SERVER_STATE.ERROR);
            }
        });

        this.child.on("error", () => {
            this.child = null;
            this.setState(SERVER_STATE.ERROR);
        });

        try {
            await this.waitForReady();
            this.crashCount = 0;
            this.setState(SERVER_STATE.READY);
        } catch {
            this.setState(SERVER_STATE.ERROR);
        }
    }

    private async waitForReady(): Promise<void> {
        for (let i = 0; i < HEALTH_POLL_MAX_ATTEMPTS; i++) {
            try {
                const res = await node.fetch(`${this.serverUrl}/api/health`);
                if (res.ok) return;
            } catch {
                // not ready yet
            }
            await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
        }
        throw new Error("Server did not become ready within timeout");
    }

    async stop(): Promise<void> {
        this.stopping = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        if (!this.child) {
            this.setState(SERVER_STATE.STOPPED);
            return;
        }

        const child = this.child;

        if (process.platform === "win32") {
            try {
                await node.execFile("taskkill", ["/pid", String(child.pid), "/f", "/t"]);
            } catch {
                // process may already be gone
            }
        } else {
            child.kill("SIGTERM");
        }

        const exited = await Promise.race([
            new Promise<boolean>((resolve) => {
                child.on("exit", () => resolve(true));
            }),
            new Promise<boolean>((resolve) => {
                setTimeout(() => resolve(false), STOP_GRACE_MS);
            }),
        ]);

        if (!exited && this.child) {
            this.child.kill("SIGKILL");
        }

        this.child = null;
        this.setState(SERVER_STATE.STOPPED);
    }

    async restart(): Promise<void> {
        await this.stop();
        this.crashCount = 0;
        await this.start();
    }

    updateOllamaUrl(url: string): void {
        this.opts.ollamaUrl = url;
    }

    updatePort(port: number): void {
        this.opts.port = port;
    }
}
