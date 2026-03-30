import type { ChildProcess } from "child_process";
import type { ServerState } from "./types";
import { SERVER_STATE } from "./types";
import { node } from "./binary-manager";

const HEALTH_POLL_INTERVAL_MS = 1000;
const HEALTH_POLL_MAX_ATTEMPTS = 120;
const STOP_GRACE_MS = 5000;
const CRASH_RESTART_DELAY_MS = 3000;
const MAX_CRASH_RESTARTS = 3;
const PORT_FILE_POLL_INTERVAL_MS = 500;
const PORT_FILE_MAX_ATTEMPTS = 240;

export interface ServerManagerOptions {
    binaryPath: string;
    dataDir: string;
    port: number | null;
    systemPrompt: string;
    onStateChange?: (state: ServerState) => void;
    onRestartsExhausted?: (stderr: string) => void;
}

export class ServerManager {
    private opts: ServerManagerOptions;
    private child: ChildProcess | null = null;
    private _state: ServerState = SERVER_STATE.STOPPED;
    private crashCount = 0;
    private stopping = false;
    private restartTimer: ReturnType<typeof setTimeout> | null = null;
    private _actualPort: number | null = null;
    private _stderrLines: string[] = [];
    private static readonly MAX_STDERR_LINES = 20;

    constructor(opts: ServerManagerOptions) {
        this.opts = opts;
    }

    get lastStderr(): string {
        return this._stderrLines.join("\n");
    }

    get state(): ServerState {
        return this._state;
    }

    get serverUrl(): string {
        const port = this._actualPort ?? this.opts.port;
        return `http://127.0.0.1:${port}`;
    }

    private get portFilePath(): string {
        return `${this.opts.dataDir}/data/server.port`;
    }

    private async waitForPortFile(): Promise<void> {
        for (let i = 0; i < PORT_FILE_MAX_ATTEMPTS; i++) {
            if (node.existsSync(this.portFilePath)) {
                const content = node.readFileSync(this.portFilePath, "utf-8").trim();
                const port = parseInt(content, 10);
                if (!isNaN(port) && port > 0 && port <= 65535) {
                    this._actualPort = port;
                    return;
                }
            }
            await new Promise((r) => setTimeout(r, PORT_FILE_POLL_INTERVAL_MS));
        }
        throw new Error("Port file not found within timeout");
    }

    private setState(s: ServerState): void {
        this._state = s;
        this.opts.onStateChange?.(s);
    }

    async start(): Promise<void> {
        if (this.child) return;
        this.stopping = false;
        this._actualPort = null;
        this.setState(SERVER_STATE.STARTING);

        const args = [
            "serve",
            "--host", "127.0.0.1",
        ];

        if (this.opts.port !== null) {
            args.push("--port", String(this.opts.port));
        }

        args.push("--data-dir", this.opts.dataDir);

        const env: Record<string, string | undefined> = {
            ...process.env,
            LILBEE_CORS_ORIGINS: "app://obsidian.md",
        };
        if (this.opts.systemPrompt) {
            env.LILBEE_SYSTEM_PROMPT = this.opts.systemPrompt;
        }

        this._stderrLines = [];

        this.child = node.spawn(this.opts.binaryPath, args, {
            env,
            stdio: ["ignore", "ignore", "pipe"],
            detached: false,
        });

        if (this.child.stderr) {
            let partial = "";
            this.child.stderr.on("data", (chunk: Buffer) => {
                partial += chunk.toString();
                const lines = partial.split("\n");
                partial = lines.pop()!;
                for (const line of lines) {
                    if (line.length > 0) {
                        this._stderrLines.push(line);
                        if (this._stderrLines.length > ServerManager.MAX_STDERR_LINES) {
                            this._stderrLines.shift();
                        }
                    }
                }
            });
        }

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
                this.opts.onRestartsExhausted?.(this.lastStderr);
            }
        });

        this.child.on("error", () => {
            this.child = null;
            this.setState(SERVER_STATE.ERROR);
        });

        try {
            if (this.opts.port === null) {
                await this.waitForPortFile();
            } else {
                this._actualPort = this.opts.port;
            }
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

        if (node.existsSync(this.portFilePath)) {
            try {
                node.unlinkSync(this.portFilePath);
            } catch {
                // ignore cleanup errors
            }
        }
    }

    async restart(): Promise<void> {
        await this.stop();
        this.crashCount = 0;
        await this.start();
    }

    updatePort(port: number | null): void {
        this.opts.port = port;
        if (port !== null) {
            this._actualPort = port;
        }
    }
}
