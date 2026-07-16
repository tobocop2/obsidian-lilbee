import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { node } from "../src/binary-manager";
import {
    LOCK_REFUSAL_EXIT_CODE,
    ScopeHeldError,
    ServerManager,
    awaitServerGone,
    readScopeOwner,
    readServerSession,
    requestServerShutdown,
} from "../src/server-manager";
import type { ServerManagerOptions } from "../src/server-manager";

// ── Mock child process ──────────────────────────────────────────────

function mockStream() {
    const handlers: Record<string, Function[]> = {};
    return {
        on(event: string, handler: Function) {
            (handlers[event] ??= []).push(handler);
        },
        _emit(event: string, ...args: unknown[]) {
            for (const h of handlers[event] ?? []) h(...args);
        },
    };
}

function mockChild(pid = 1234) {
    const handlers: Record<string, Function[]> = {};
    const onceHandlers: Record<string, Function[]> = {};
    return {
        pid,
        stdout: mockStream(),
        stderr: mockStream(),
        on(event: string, handler: Function) {
            (handlers[event] ??= []).push(handler);
        },
        once(event: string, handler: Function) {
            (onceHandlers[event] ??= []).push(handler);
        },
        kill: vi.fn(),
        _emit(event: string, ...args: unknown[]) {
            for (const h of handlers[event] ?? []) h(...args);
            const once = onceHandlers[event] ?? [];
            onceHandlers[event] = [];
            for (const h of once) h(...args);
        },
    };
}

type MockChild = ReturnType<typeof mockChild>;

// ── Helpers ─────────────────────────────────────────────────────────

function defaultOpts(overrides?: Partial<ServerManagerOptions>): ServerManagerOptions {
    return {
        binaryPath: "/usr/local/bin/lilbee",
        dataDir: "/tmp/data",
        sharedRoot: "/tmp/shared",
        modelsDir: "/tmp/models",
        ragSystemPrompt: "",
        generalSystemPrompt: "",
        ...overrides,
    };
}

const SESSION_JSON = JSON.stringify({ token: "tok-1" });

/** readFileSync router: port file answers, server.json behaves per *session*. */
function fileRouter(session: "present" | "absent") {
    return (p: unknown) => {
        const path = String(p);
        if (path.endsWith("server.port")) return "9999";
        if (path.endsWith("server.json")) {
            if (session === "absent") throw new Error("ENOENT");
            return SESSION_JSON;
        }
        throw new Error(`unexpected read: ${path}`);
    };
}

describe("server-manager helpers", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("readScopeOwner", () => {
        it("parses the sidecar the server writes", () => {
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            vi.spyOn(node, "readFileSync").mockReturnValue(JSON.stringify({ data_dir: "/tmp/other", pid: 42 }));
            expect(readScopeOwner("/tmp/shared")).toEqual({ dataDir: "/tmp/other", pid: 42 });
        });

        it("is null when the sidecar is absent", () => {
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            expect(readScopeOwner("/tmp/shared")).toBeNull();
        });

        it("is null on unreadable or corrupt sidecars", () => {
            vi.spyOn(node, "existsSync").mockReturnValue(true);
            const read = vi.spyOn(node, "readFileSync").mockReturnValue("not json{{{");
            expect(readScopeOwner("/tmp/shared")).toBeNull();
            read.mockReturnValue(JSON.stringify({ data_dir: 7, pid: "nope" }));
            expect(readScopeOwner("/tmp/shared")).toBeNull();
        });
    });

    describe("readServerSession", () => {
        it("returns port and token from the session files", () => {
            vi.spyOn(node, "readFileSync").mockImplementation(fileRouter("present"));
            expect(readServerSession("/tmp/data")).toEqual({ port: 9999, token: "tok-1" });
        });

        it("is null when either file is missing", () => {
            vi.spyOn(node, "readFileSync").mockImplementation(fileRouter("absent"));
            expect(readServerSession("/tmp/data")).toBeNull();
        });

        it("is null on a garbage port", () => {
            vi.spyOn(node, "readFileSync").mockImplementation((p: unknown) =>
                String(p).endsWith("server.port") ? "not-a-port" : SESSION_JSON,
            );
            expect(readServerSession("/tmp/data")).toBeNull();
        });

        it("is null on an out-of-range port", () => {
            vi.spyOn(node, "readFileSync").mockImplementation((p: unknown) =>
                String(p).endsWith("server.port") ? "70000" : SESSION_JSON,
            );
            expect(readServerSession("/tmp/data")).toBeNull();
        });

        it("is null when the session file has no token", () => {
            vi.spyOn(node, "readFileSync").mockImplementation((p: unknown) =>
                String(p).endsWith("server.port") ? "9999" : JSON.stringify({ nope: 1 }),
            );
            expect(readServerSession("/tmp/data")).toBeNull();
        });
    });

    describe("requestServerShutdown", () => {
        it("POSTs the shutdown with the server's own bearer token", async () => {
            vi.spyOn(node, "readFileSync").mockImplementation(fileRouter("present"));
            const fetchSpy = vi.spyOn(node, "fetch").mockResolvedValue({ ok: true } as Response);
            await expect(requestServerShutdown("/tmp/data")).resolves.toBe(true);
            expect(fetchSpy).toHaveBeenCalledWith(
                "http://127.0.0.1:9999/api/shutdown",
                expect.objectContaining({
                    method: "POST",
                    headers: { Authorization: "Bearer tok-1" },
                }),
            );
        });

        it("is false without a session to talk to", async () => {
            vi.spyOn(node, "readFileSync").mockImplementation(fileRouter("absent"));
            const fetchSpy = vi.spyOn(node, "fetch");
            await expect(requestServerShutdown("/tmp/data")).resolves.toBe(false);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

        it("is false when the request fails or is rejected", async () => {
            vi.spyOn(node, "readFileSync").mockImplementation(fileRouter("present"));
            const fetchSpy = vi.spyOn(node, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));
            await expect(requestServerShutdown("/tmp/data")).resolves.toBe(false);
            fetchSpy.mockResolvedValueOnce({ ok: false } as Response);
            await expect(requestServerShutdown("/tmp/data")).resolves.toBe(false);
        });
    });

    describe("awaitServerGone", () => {
        it("is immediately true when there is no session", async () => {
            vi.spyOn(node, "readFileSync").mockImplementation(fileRouter("absent"));
            await expect(awaitServerGone("/tmp/data", 1000)).resolves.toBe(true);
        });

        it("is true once the health endpoint stops answering", async () => {
            vi.spyOn(node, "readFileSync").mockImplementation(fileRouter("present"));
            vi.spyOn(node, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
            await expect(awaitServerGone("/tmp/data", 1000)).resolves.toBe(true);
        });

        it("is false while the server keeps answering past the deadline", async () => {
            vi.useFakeTimers();
            try {
                vi.spyOn(node, "readFileSync").mockImplementation(fileRouter("present"));
                vi.spyOn(node, "fetch").mockResolvedValue({ ok: true } as Response);
                const gone = awaitServerGone("/tmp/data", 1000);
                await vi.advanceTimersByTimeAsync(1600);
                await expect(gone).resolves.toBe(false);
            } finally {
                vi.useRealTimers();
            }
        });
    });
});

// ── ServerManager ───────────────────────────────────────────────────

describe("ServerManager", () => {
    let spawnSpy: ReturnType<typeof vi.spyOn>;
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    let processKillSpy: ReturnType<typeof vi.spyOn>;
    let readFileSyncSpy: ReturnType<typeof vi.spyOn>;
    let unlinkSyncSpy: ReturnType<typeof vi.spyOn>;
    let appendFileSyncSpy: ReturnType<typeof vi.spyOn>;
    let children: MockChild[];

    /** The most recently spawned mock child. */
    function child(): MockChild {
        return children[children.length - 1];
    }

    beforeEach(() => {
        vi.useFakeTimers();
        children = [];
        spawnSpy = vi.spyOn(node, "spawn").mockImplementation(() => {
            const c = mockChild(1000 + children.length);
            children.push(c);
            return c as any;
        });
        fetchSpy = vi.spyOn(node, "fetch").mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) } as any);
        vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" } as any);
        vi.spyOn(node, "existsSync").mockReturnValue(true);
        // Never signal a real process group from tests. Default to "no such
        // group" so signalGroup falls back to child.kill (a mock); the group
        // path is covered explicitly where needed.
        processKillSpy = vi.spyOn(node, "processKill").mockImplementation(() => {
            throw new Error("ESRCH");
        });
        // Default: a port file exists but no adoptable session (server.json absent).
        readFileSyncSpy = vi.spyOn(node, "readFileSync").mockImplementation(fileRouter("absent"));
        unlinkSyncSpy = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});
        appendFileSyncSpy = vi.spyOn(node, "appendFileSync").mockImplementation(() => {});
        vi.spyOn(node, "statSync").mockReturnValue({ size: 0 } as any);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /** start() with the default mocks: no adoptable session, instant health. */
    async function startFresh(opts?: Partial<ServerManagerOptions>): Promise<ServerManager> {
        const mgr = new ServerManager(defaultOpts(opts));
        await mgr.start();
        return mgr;
    }

    /** Wait out tryAdopt's async tick so the spawned mock child exists. */
    async function spawnedChild(): Promise<MockChild> {
        await vi.advanceTimersByTimeAsync(0);
        return child();
    }

    /** Make stop()'s escalation terminal: the child exits when SIGKILLed. */
    function exitOnSigkill(c: MockChild): void {
        c.kill.mockImplementation((sig: string) => {
            if (sig === "SIGKILL") queueMicrotask(() => c._emit("exit", null, "SIGKILL"));
        });
    }

    // ── Constructor / getters ───────────────────────────────────────

    describe("constructor", () => {
        it("initial state is stopped with no URL", () => {
            const mgr = new ServerManager(defaultOpts());
            expect(mgr.state).toBe("stopped");
            expect(mgr.serverUrl).toBe("");
            expect(mgr.dataDir).toBe("/tmp/data");
            expect(mgr.lastOutput).toBe("");
        });
    });

    // ── start: spawn path ───────────────────────────────────────────

    describe("start (spawn)", () => {
        it("spawns serve with the data dir and reaches ready via the port file", async () => {
            const states: string[] = [];
            const mgr = new ServerManager(defaultOpts({ onStateChange: (s) => states.push(s) }));
            await mgr.start();
            expect(spawnSpy).toHaveBeenCalledWith(
                "/usr/local/bin/lilbee",
                ["serve", "--host", "127.0.0.1", "--data-dir", "/tmp/data"],
                expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
            );
            expect(mgr.state).toBe("ready");
            expect(mgr.serverUrl).toBe("http://127.0.0.1:9999");
            expect(states).toEqual(["starting", "ready"]);
        });

        it("passes the scope, models dir, and parent pid in the environment", async () => {
            await startFresh({ ragSystemPrompt: "rag!", generalSystemPrompt: "gen!" });
            const env = (spawnSpy.mock.calls[0][2] as { env: Record<string, string> }).env;
            expect(env.LILBEE_EXCLUSIVE_SCOPE).toBe("/tmp/shared");
            expect(env.LILBEE_MODELS_DIR).toBe("/tmp/models");
            expect(env.LILBEE_PARENT_PID).toBe(String(process.pid));
            expect(env.LILBEE_RAG_SYSTEM_PROMPT).toBe("rag!");
            expect(env.LILBEE_GENERAL_SYSTEM_PROMPT).toBe("gen!");
        });

        it("omits the prompt env vars when the prompts are empty", async () => {
            await startFresh();
            const env = (spawnSpy.mock.calls[0][2] as { env: Record<string, string> }).env;
            expect(env).not.toHaveProperty("LILBEE_RAG_SYSTEM_PROMPT");
            expect(env).not.toHaveProperty("LILBEE_GENERAL_SYSTEM_PROMPT");
        });

        it("removes a leftover port file before spawning", async () => {
            await startFresh();
            expect(unlinkSyncSpy).toHaveBeenCalledWith("/tmp/data/data/server.port");
        });

        it("swallows a port-file cleanup failure", async () => {
            unlinkSyncSpy.mockImplementation(() => {
                throw new Error("EACCES");
            });
            const mgr = await startFresh();
            expect(mgr.state).toBe("ready");
        });

        it("is a no-op when already running", async () => {
            const mgr = await startFresh();
            await mgr.start();
            expect(spawnSpy).toHaveBeenCalledTimes(1);
        });

        it("waits for the port file to appear", async () => {
            const existsSpy = vi.spyOn(node, "existsSync").mockReturnValue(false);
            const mgr = new ServerManager(defaultOpts());
            const startP = mgr.start();
            await vi.advanceTimersByTimeAsync(600);
            existsSpy.mockReturnValue(true);
            await vi.advanceTimersByTimeAsync(600);
            await startP;
            expect(mgr.state).toBe("ready");
        });

        it("ignores garbage port file contents until a real port arrives", async () => {
            readFileSyncSpy.mockImplementation((p: unknown) => {
                if (String(p).endsWith("server.port")) return "garbage";
                throw new Error("ENOENT");
            });
            const mgr = new ServerManager(defaultOpts());
            const startP = mgr.start();
            await vi.advanceTimersByTimeAsync(600);
            readFileSyncSpy.mockImplementation((p: unknown) => {
                if (String(p).endsWith("server.port")) return "8888";
                throw new Error("ENOENT");
            });
            await vi.advanceTimersByTimeAsync(600);
            await startP;
            expect(mgr.serverUrl).toBe("http://127.0.0.1:8888");
        });

        it("fails when the port file never appears", async () => {
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            const mgr = new ServerManager(defaultOpts());
            const startP = mgr.start();
            startP.catch(() => {});
            exitOnSigkill(await spawnedChild());
            await vi.advanceTimersByTimeAsync(240 * 500 + 20_000);
            await expect(startP).rejects.toThrow("Port file not found");
            expect(mgr.state).toBe("error");
        });

        it("polls health until the server answers", async () => {
            fetchSpy
                .mockRejectedValueOnce(new Error("ECONNREFUSED"))
                .mockResolvedValueOnce({ ok: false })
                .mockResolvedValue({ ok: true });
            const mgr = new ServerManager(defaultOpts());
            const startP = mgr.start();
            await vi.advanceTimersByTimeAsync(3000);
            await startP;
            expect(mgr.state).toBe("ready");
        });

        it("fails when health never turns ok", async () => {
            fetchSpy.mockResolvedValue({ ok: false });
            const mgr = new ServerManager(defaultOpts());
            const startP = mgr.start();
            startP.catch(() => {});
            exitOnSigkill(await spawnedChild());
            await vi.advanceTimersByTimeAsync(120 * 1000 + 20_000);
            await expect(startP).rejects.toThrow("did not become ready");
            expect(mgr.state).toBe("error");
        });

        it("aborts startup quietly when stop() arrives mid-discovery", async () => {
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            const mgr = new ServerManager(defaultOpts());
            const startP = mgr.start();
            exitOnSigkill(await spawnedChild());
            const stopP = mgr.stop();
            await vi.advanceTimersByTimeAsync(20_000);
            await stopP;
            await startP; // resolves without throwing: the stop was on purpose
            expect(mgr.state).toBe("stopped");
        });
    });

    // ── start: adopt path ───────────────────────────────────────────

    describe("start (adopt)", () => {
        beforeEach(() => {
            readFileSyncSpy.mockImplementation(fileRouter("present"));
        });

        it("adopts a healthy server instead of spawning", async () => {
            const mgr = new ServerManager(defaultOpts());
            await mgr.start();
            expect(mgr.state).toBe("ready");
            expect(mgr.serverUrl).toBe("http://127.0.0.1:9999");
            expect(spawnSpy).not.toHaveBeenCalled();
        });

        it("does not adopt a port that answers non-ok", async () => {
            fetchSpy.mockResolvedValueOnce({ ok: false } as any);
            const mgr = new ServerManager(defaultOpts());
            await mgr.start();
            expect(spawnSpy).toHaveBeenCalledTimes(1);
            expect(mgr.state).toBe("ready");
        });

        it("does not adopt a port that answers with a foreign shape", async () => {
            fetchSpy.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ hello: "world" }),
            } as any); // something else squats the recycled port
            const mgr = new ServerManager(defaultOpts());
            await mgr.start();
            expect(spawnSpy).toHaveBeenCalledTimes(1); // spawned, not adopted
            expect(mgr.state).toBe("ready");
        });

        it("spawns when the recorded session does not answer", async () => {
            fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED")); // adopt probe fails
            const mgr = new ServerManager(defaultOpts());
            await mgr.start();
            expect(spawnSpy).toHaveBeenCalledTimes(1);
            expect(mgr.state).toBe("ready");
        });

        it("watches an adopted server and crash-restarts when it goes away", async () => {
            const mgr = new ServerManager(defaultOpts());
            await mgr.start();
            expect(spawnSpy).not.toHaveBeenCalled();
            // The adopted server dies: health fails, session files are gone.
            fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
            readFileSyncSpy.mockImplementation(fileRouter("absent"));
            await vi.advanceTimersByTimeAsync(5000); // watch tick notices
            expect(mgr.state).toBe("error");
            expect(mgr.lastOutput).toContain("adopted server became unreachable");
            expect(appendFileSyncSpy).toHaveBeenCalled(); // crash snapshot
            fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) } as any);
            await vi.advanceTimersByTimeAsync(3000); // crash-restart delay
            expect(spawnSpy).toHaveBeenCalledTimes(1); // respawned
            expect(mgr.state).toBe("ready");
        });

        it("a healthy adopted server keeps its watch quiet", async () => {
            const mgr = new ServerManager(defaultOpts());
            await mgr.start();
            await vi.advanceTimersByTimeAsync(30_000);
            expect(mgr.state).toBe("ready");
            expect(appendFileSyncSpy).not.toHaveBeenCalled();
        });

        it("adopted stop asks the server to exit over its API", async () => {
            const mgr = new ServerManager(defaultOpts());
            await mgr.start();
            // Shutdown accepted; the follow-up health probe finds it gone.
            fetchSpy.mockImplementation((url: unknown) => {
                if (String(url).endsWith("/api/shutdown")) return Promise.resolve({ ok: true });
                return Promise.reject(new Error("ECONNREFUSED"));
            });
            await mgr.stop();
            expect(mgr.state).toBe("stopped");
            expect(mgr.serverUrl).toBe("");
            expect(appendFileSyncSpy).not.toHaveBeenCalled(); // not a crash
            expect(fetchSpy.mock.calls.some((c) => String(c[0]).endsWith("/api/shutdown"))).toBe(true);
        });

        it("reports when an adopted server will not stop", async () => {
            const failures: Error[] = [];
            const mgr = new ServerManager(defaultOpts({ onShutdownFailure: (e) => failures.push(e) }));
            await mgr.start();
            fetchSpy.mockRejectedValue(new Error("ECONNREFUSED")); // shutdown request fails
            await mgr.stop();
            expect(mgr.state).toBe("stopped");
            expect(failures).toHaveLength(1);
            expect(failures[0].message).toContain("did not stop");
        });
    });

    // ── stop ────────────────────────────────────────────────────────

    describe("stop", () => {
        it("is a no-op when nothing is running", async () => {
            const mgr = new ServerManager(defaultOpts());
            await mgr.stop();
            expect(mgr.state).toBe("stopped");
        });

        it("returns once the child exits and consumes the exit event", async () => {
            const mgr = await startFresh();
            const c = child();
            const stopP = mgr.stop();
            c._emit("exit", 0, null); // graceful exit inside the grace window
            await stopP;
            expect(mgr.state).toBe("stopped");
            expect(mgr.serverUrl).toBe("");
            expect(c.kill).not.toHaveBeenCalled(); // never needed a signal
            expect(appendFileSyncSpy).not.toHaveBeenCalled(); // no phantom crash
        });

        it("escalates SIGTERM then SIGKILL when the child lingers, and still awaits the exit", async () => {
            const mgr = await startFresh();
            const c = child();
            exitOnSigkill(c);
            const stopP = mgr.stop();
            await vi.advanceTimersByTimeAsync(12_000); // STOP_GRACE: no exit
            expect(c.kill).toHaveBeenCalledWith("SIGTERM");
            await vi.advanceTimersByTimeAsync(5000); // KILL_GRACE: still no exit
            expect(c.kill).toHaveBeenCalledWith("SIGKILL");
            await stopP;
            expect(mgr.state).toBe("stopped");
            expect(appendFileSyncSpy).not.toHaveBeenCalled(); // own kill is not a crash
        });

        it("signals the process group when the group exists", async () => {
            processKillSpy.mockImplementation(() => true);
            const mgr = await startFresh();
            const c = child();
            const stopP = mgr.stop();
            await vi.advanceTimersByTimeAsync(12_000);
            expect(processKillSpy).toHaveBeenCalledWith(-c.pid, "SIGTERM");
            c._emit("exit", null, "SIGTERM");
            await stopP;
            expect(mgr.state).toBe("stopped");
        });

        it("asks the server to stop over its API before any signal", async () => {
            const mgr = await startFresh();
            // The session appears once the server is up; stop() can use it.
            readFileSyncSpy.mockImplementation(fileRouter("present"));
            const c = child();
            const stopP = mgr.stop();
            c._emit("exit", 0, null);
            await stopP;
            expect(fetchSpy.mock.calls.some((call) => String(call[0]).endsWith("/api/shutdown"))).toBe(true);
            expect(c.kill).not.toHaveBeenCalled();
        });

        it("uses taskkill on Windows and reports a taskkill failure", async () => {
            const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
            const execSpy = vi.spyOn(node, "execFile").mockRejectedValue(new Error("Access is denied."));
            const failures: Error[] = [];
            try {
                const mgr = await startFresh({ onShutdownFailure: (e) => failures.push(e) });
                const c = child();
                const stopP = mgr.stop();
                await vi.advanceTimersByTimeAsync(12_000); // STOP_GRACE expires
                // taskkill was attempted (and failed); the child then exits anyway.
                c._emit("exit", 1, null);
                await stopP;
                expect(execSpy).toHaveBeenCalledWith("taskkill", ["/pid", String(c.pid), "/f", "/t"]);
                expect(failures).toHaveLength(1);
                expect(mgr.state).toBe("stopped");
            } finally {
                platformSpy.mockRestore();
            }
        });
    });

    // ── restart: the phantom-crash regression ───────────────────────

    describe("restart", () => {
        it("replaces the server without recording a phantom crash", async () => {
            const mgr = await startFresh();
            const first = child();
            const restartP = mgr.restart();
            first._emit("exit", 0, null); // old server exits inside stop()
            await vi.advanceTimersByTimeAsync(1000);
            await restartP;
            expect(mgr.state).toBe("ready");
            expect(spawnSpy).toHaveBeenCalledTimes(2);
            expect(appendFileSyncSpy).not.toHaveBeenCalled();
        });

        it("a stale exit event from the replaced child cannot untrack the new one", async () => {
            const mgr = await startFresh();
            const first = child();
            const restartP = mgr.restart();
            first._emit("exit", 0, null);
            await vi.advanceTimersByTimeAsync(1000);
            await restartP;
            const second = child();
            expect(second).not.toBe(first);
            // A duplicate/late event from the dead predecessor: fully inert.
            first._emit("exit", null, "SIGKILL");
            await vi.advanceTimersByTimeAsync(10_000);
            expect(mgr.state).toBe("ready");
            expect(appendFileSyncSpy).not.toHaveBeenCalled();
            expect(spawnSpy).toHaveBeenCalledTimes(2); // no phantom crash-restart
        });
    });

    // ── crashes ─────────────────────────────────────────────────────

    describe("crash handling", () => {
        it("an unexpected exit snapshots the crash and restarts", async () => {
            const mgr = await startFresh();
            child()._emit("exit", 1, null);
            expect(mgr.state).toBe("error");
            expect(mgr.lastOutput).toContain("server exited (exit code 1)");
            expect(appendFileSyncSpy).toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(3000);
            expect(spawnSpy).toHaveBeenCalledTimes(2);
            expect(mgr.state).toBe("ready");
        });

        it("a signal exit is described by its signal", async () => {
            const mgr = await startFresh();
            child()._emit("exit", null, "SIGSEGV");
            expect(mgr.lastOutput).toContain("server exited (signal SIGSEGV)");
        });

        it("an exit with neither code nor signal is still described", async () => {
            const mgr = await startFresh();
            child()._emit("exit", null, null);
            expect(mgr.lastOutput).toContain("server exited (unknown cause)");
        });

        it("gives up after the restart budget and reports the output", async () => {
            let exhausted = "";
            const mgr = await startFresh({ onRestartsExhausted: (out) => (exhausted = out) });
            // After the crash, every respawn hangs before ready (no port file),
            // so the budget is never reset by a recovery.
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            child()._emit("exit", 1, null); // crash 1
            for (let i = 0; i < 3; i++) {
                await vi.advanceTimersByTimeAsync(3000); // restart delay -> respawn
                child()._emit("exit", 1, null); // crashes 2..4
            }
            expect(exhausted).toContain("server exited (exit code 1)");
            expect(mgr.state).toBe("error");
            await vi.advanceTimersByTimeAsync(10_000);
            expect(spawnSpy).toHaveBeenCalledTimes(4); // no further restarts
        });

        it("a ready start resets the crash budget", async () => {
            const mgr = await startFresh();
            for (let round = 0; round < 5; round++) {
                child()._emit("exit", 1, null);
                await vi.advanceTimersByTimeAsync(3000); // restart -> ready again
            }
            // Five crash/recover rounds and it is still willing to restart:
            expect(mgr.state).toBe("ready");
            expect(spawnSpy).toHaveBeenCalledTimes(6);
        });

        it("stop() cancels a pending crash-restart", async () => {
            const mgr = await startFresh();
            child()._emit("exit", 1, null);
            await mgr.stop();
            await vi.advanceTimersByTimeAsync(10_000);
            expect(spawnSpy).toHaveBeenCalledTimes(1);
            expect(mgr.state).toBe("stopped");
        });

        it("a spawn error is fatal and does not loop", async () => {
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            const mgr = new ServerManager(defaultOpts());
            const startP = mgr.start();
            startP.catch(() => {});
            (await spawnedChild())._emit("error", new Error("ENOENT: no such binary"));
            await vi.advanceTimersByTimeAsync(1000);
            await expect(startP).rejects.toThrow("Failed to launch server");
            expect(mgr.state).toBe("error");
            expect(mgr.lastOutput).toContain("failed to launch server: ENOENT");
            await vi.advanceTimersByTimeAsync(10_000);
            expect(spawnSpy).toHaveBeenCalledTimes(1);
        });

        it("a stale error event from a replaced child is inert", async () => {
            const mgr = await startFresh();
            const first = child();
            const restartP = mgr.restart();
            first._emit("exit", 0, null);
            await vi.advanceTimersByTimeAsync(1000);
            await restartP;
            first._emit("error", new Error("late failure"));
            expect(mgr.state).toBe("ready");
        });

        it("an exit after stop() stays quiet", async () => {
            const mgr = await startFresh();
            const c = child();
            const stopP = mgr.stop();
            c._emit("exit", 0, null);
            await stopP;
            expect(appendFileSyncSpy).not.toHaveBeenCalled();
            expect(mgr.state).toBe("stopped");
        });
    });

    // ── scope refusal ───────────────────────────────────────────────

    describe("scope refusal", () => {
        it("a lock-refusal exit surfaces as ScopeHeldError, not a crash loop", async () => {
            vi.spyOn(node, "existsSync").mockReturnValue(false); // port never appears
            const mgr = new ServerManager(defaultOpts());
            const startP = mgr.start();
            startP.catch(() => {});
            (await spawnedChild()).stdout._emit(
                "data",
                Buffer.from("Another lilbee server is already running for this installation.\n"),
            );
            child()._emit("exit", LOCK_REFUSAL_EXIT_CODE, null);
            await vi.advanceTimersByTimeAsync(1000);
            await expect(startP).rejects.toBeInstanceOf(ScopeHeldError);
            await expect(startP).rejects.toThrow("already running");
            expect(mgr.state).toBe("error");
            expect(appendFileSyncSpy).not.toHaveBeenCalled(); // a refusal is not a crash
            await vi.advanceTimersByTimeAsync(10_000);
            expect(spawnSpy).toHaveBeenCalledTimes(1); // and never restarts
        });

        it("a refusal with no captured output still explains itself", () => {
            expect(new ScopeHeldError("").message).toContain("owns the shared root");
        });
    });

    // ── lifecycle journal ───────────────────────────────────────────

    describe("journal", () => {
        let lines: string[];

        beforeEach(() => {
            lines = [];
        });

        function journalOpts(overrides?: Partial<ServerManagerOptions>): Partial<ServerManagerOptions> {
            return { onJournal: (m) => lines.push(m), ...overrides };
        }

        it("journals a spawn with its pid", async () => {
            await startFresh(journalOpts());
            expect(lines).toContain(`spawned server pid ${child().pid}`);
        });

        it("journals an adoption with its port", async () => {
            readFileSyncSpy.mockImplementation(fileRouter("present"));
            const mgr = new ServerManager(defaultOpts(journalOpts()));
            await mgr.start();
            expect(lines).toContain("adopted running server on port 9999");
        });

        it("journals the stop: shutdown request, escalation, and the observed exit time", async () => {
            const mgr = await startFresh(journalOpts());
            const c = child();
            exitOnSigkill(c);
            const stopP = mgr.stop();
            await vi.advanceTimersByTimeAsync(12_000);
            await vi.advanceTimersByTimeAsync(5000);
            await stopP;
            expect(lines).toContain(`stopping server pid ${c.pid}: shutdown request not accepted`);
            expect(lines).toContain(`sent SIGTERM to pid ${c.pid} group`);
            expect(lines).toContain(`sent SIGKILL to pid ${c.pid} group`);
            expect(lines.some((l) => new RegExp(`server pid ${c.pid} exit observed after \\d+ms`).test(l))).toBe(true);
        });

        it("journals an accepted shutdown request", async () => {
            const mgr = await startFresh(journalOpts());
            readFileSyncSpy.mockImplementation(fileRouter("present"));
            const c = child();
            const stopP = mgr.stop();
            c._emit("exit", 0, null);
            await stopP;
            expect(lines).toContain(`stopping server pid ${c.pid}: shutdown request accepted`);
        });

        it("journals the taskkill escalation on Windows", async () => {
            const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
            try {
                const mgr = await startFresh(journalOpts());
                const c = child();
                const stopP = mgr.stop();
                await vi.advanceTimersByTimeAsync(12_000);
                c._emit("exit", 1, null);
                await stopP;
                expect(lines).toContain(`sent taskkill /f /t to pid ${c.pid}`);
            } finally {
                platformSpy.mockRestore();
            }
        });

        it("journals each crash with its cause, the restart schedule, and the give-up", async () => {
            await startFresh(journalOpts());
            vi.spyOn(node, "existsSync").mockReturnValue(false); // respawns hang before ready
            const firstPid = child().pid;
            child()._emit("exit", null, "SIGSEGV"); // crash 1
            expect(lines).toContain(`server pid ${firstPid} exited (signal SIGSEGV)`);
            expect(lines).toContain("restarting in 3000ms (attempt 1/3)");
            for (let i = 0; i < 3; i++) {
                await vi.advanceTimersByTimeAsync(3000);
                child()._emit("exit", 1, null); // crashes 2..4
            }
            expect(lines).toContain("server did not stay up after 3 restarts; giving up");
        });

        it("journals a refused spawn", async () => {
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            const mgr = new ServerManager(defaultOpts(journalOpts()));
            const startP = mgr.start();
            startP.catch(() => {});
            const c = await spawnedChild();
            c._emit("exit", LOCK_REFUSAL_EXIT_CODE, null);
            await vi.advanceTimersByTimeAsync(1000);
            await expect(startP).rejects.toBeInstanceOf(ScopeHeldError);
            expect(lines).toContain(
                `spawned server pid ${c.pid} refused to start: another server owns the shared root`,
            );
        });

        it("journals a launch failure", async () => {
            vi.spyOn(node, "existsSync").mockReturnValue(false);
            const mgr = new ServerManager(defaultOpts(journalOpts()));
            const startP = mgr.start();
            startP.catch(() => {});
            (await spawnedChild())._emit("error", new Error("ENOENT: no such binary"));
            await vi.advanceTimersByTimeAsync(1000);
            await expect(startP).rejects.toThrow("Failed to launch server");
            expect(lines).toContain("failed to launch server: ENOENT: no such binary");
        });

        it("journals an adopted server that became unreachable", async () => {
            readFileSyncSpy.mockImplementation(fileRouter("present"));
            const mgr = new ServerManager(defaultOpts(journalOpts()));
            await mgr.start();
            fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
            readFileSyncSpy.mockImplementation(fileRouter("absent"));
            await vi.advanceTimersByTimeAsync(5000);
            expect(lines).toContain("adopted server became unreachable");
        });

        it("journals both outcomes of asking an adopted server to exit", async () => {
            readFileSyncSpy.mockImplementation(fileRouter("present"));
            const mgr = new ServerManager(defaultOpts(journalOpts()));
            await mgr.start();
            fetchSpy.mockImplementation((url: unknown) => {
                if (String(url).endsWith("/api/shutdown")) return Promise.resolve({ ok: true });
                return Promise.reject(new Error("ECONNREFUSED"));
            });
            await mgr.stop();
            expect(lines).toContain("adopted server stopped when asked");

            lines = [];
            const stubborn = new ServerManager(defaultOpts(journalOpts()));
            fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) } as any);
            await stubborn.start();
            fetchSpy.mockRejectedValue(new Error("ECONNREFUSED")); // shutdown request fails
            await stubborn.stop();
            expect(lines).toContain("adopted server did not stop when asked");
        });
    });

    // ── edge coverage ───────────────────────────────────────────────

    describe("edges", () => {
        it("tolerates a child with no output streams", async () => {
            spawnSpy.mockImplementationOnce(() => {
                const c = mockChild();
                (c as any).stdout = null;
                (c as any).stderr = null;
                children.push(c);
                return c as any;
            });
            const mgr = await startFresh();
            expect(mgr.state).toBe("ready");
            expect(mgr.lastOutput).toBe("");
        });

        it("skips empty output lines", async () => {
            const mgr = await startFresh();
            child().stdout._emit("data", Buffer.from("\n\nreal\n"));
            expect(mgr.lastOutput).toBe("real");
        });

        it("an error event after stop() stays quiet", async () => {
            const mgr = await startFresh();
            const c = child();
            const stopP = mgr.stop();
            c._emit("exit", 0, null);
            await stopP;
            c._emit("error", new Error("post-stop failure"));
            expect(mgr.state).toBe("stopped");
            expect(appendFileSyncSpy).not.toHaveBeenCalled();
        });

        it("an error event racing stop() stays quiet", async () => {
            const mgr = await startFresh();
            const c = child();
            const stopP = mgr.stop(); // desired flips before the event lands
            c._emit("error", new Error("mid-stop failure"));
            c._emit("exit", 0, null);
            await stopP;
            expect(mgr.state).toBe("stopped");
            expect(appendFileSyncSpy).not.toHaveBeenCalled();
        });

        it("a watch tick after the adoption ended is inert", async () => {
            readFileSyncSpy.mockImplementation(fileRouter("present"));
            const mgr = new ServerManager(defaultOpts());
            await mgr.start();
            fetchSpy.mockImplementation((url: unknown) => {
                if (String(url).endsWith("/api/shutdown")) return Promise.resolve({ ok: true });
                return Promise.reject(new Error("ECONNREFUSED"));
            });
            await mgr.stop();
            await (mgr as any).checkAdopted(); // a stray tick that lost the race
            expect(mgr.state).toBe("stopped");
            expect(appendFileSyncSpy).not.toHaveBeenCalled();
        });

        it("a failing health probe racing stop() does not report a crash", async () => {
            readFileSyncSpy.mockImplementation(fileRouter("present"));
            const mgr = new ServerManager(defaultOpts());
            await mgr.start();
            fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
            (mgr as any).desired = "stopped"; // stop() won the race mid-probe
            await (mgr as any).checkAdopted();
            expect(appendFileSyncSpy).not.toHaveBeenCalled();
            expect(mgr.state).toBe("ready"); // stop(), not the tick, drives state
        });

        it("stopping the adopted watch twice is safe", async () => {
            const mgr = new ServerManager(defaultOpts());
            (mgr as any).stopAdoptedWatch();
            expect((mgr as any).adoptedWatch).toBeNull();
        });

        it("falls back to a direct kill when the child has no pid", async () => {
            spawnSpy.mockImplementationOnce(() => {
                const c = mockChild();
                (c as any).pid = undefined;
                children.push(c);
                return c as any;
            });
            const mgr = await startFresh();
            const c = child();
            exitOnSigkill(c);
            const stopP = mgr.stop();
            await vi.advanceTimersByTimeAsync(20_000);
            await stopP;
            expect(c.kill).toHaveBeenCalledWith("SIGTERM");
            expect(processKillSpy).not.toHaveBeenCalled();
        });

        it("exitedWithin is immediately true when no child was ever spawned", async () => {
            const mgr = new ServerManager(defaultOpts());
            await expect((mgr as any).exitedWithin(5)).resolves.toBe(true);
        });

        it("wraps a non-Error taskkill rejection for the failure callback", async () => {
            const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
            vi.spyOn(node, "execFile").mockRejectedValue("denied");
            const failures: Error[] = [];
            try {
                const mgr = await startFresh({ onShutdownFailure: (e) => failures.push(e) });
                const c = child();
                const stopP = mgr.stop();
                await vi.advanceTimersByTimeAsync(12_000);
                c._emit("exit", 1, null);
                await stopP;
                expect(failures[0].message).toContain("denied");
            } finally {
                platformSpy.mockRestore();
            }
        });

        it("reports an adopted server that accepts the shutdown but never exits", async () => {
            readFileSyncSpy.mockImplementation(fileRouter("present"));
            const failures: Error[] = [];
            const mgr = new ServerManager(defaultOpts({ onShutdownFailure: (e) => failures.push(e) }));
            await mgr.start();
            fetchSpy.mockResolvedValue({
                ok: true,
                json: async () => ({ status: "ok" }),
            } as any); // shutdown accepted, health keeps answering
            const stopP = mgr.stop();
            await vi.advanceTimersByTimeAsync(30_000); // ride out awaitServerGone's deadline
            await stopP;
            expect(mgr.state).toBe("stopped");
            expect(failures).toHaveLength(1);
        });
    });

    // ── output capture ──────────────────────────────────────────────

    describe("output capture", () => {
        it("captures stdout and stderr lines across chunk boundaries", async () => {
            const mgr = await startFresh();
            child().stdout._emit("data", Buffer.from("hello "));
            child().stdout._emit("data", Buffer.from("world\npartial"));
            child().stderr._emit("data", Buffer.from("warn: low disk\n"));
            expect(mgr.lastOutput).toContain("hello world");
            expect(mgr.lastOutput).toContain("warn: low disk");
            expect(mgr.lastOutput).not.toContain("partial");
        });

        it("keeps only the newest lines", async () => {
            const mgr = await startFresh();
            for (let i = 0; i < 30; i++) {
                child().stdout._emit("data", Buffer.from(`line-${i}\n`));
            }
            expect(mgr.lastOutput).not.toContain("line-0\n");
            expect(mgr.lastOutput).toContain("line-29");
        });
    });
});
