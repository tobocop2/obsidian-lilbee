import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { node } from "../src/binary-manager";
import { ServerManager } from "../src/server-manager";
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

function mockChild() {
    const handlers: Record<string, Function[]> = {};
    return {
        pid: 1234,
        stdout: mockStream(),
        stderr: mockStream(),
        on(event: string, handler: Function) {
            (handlers[event] ??= []).push(handler);
        },
        kill: vi.fn(),
        _emit(event: string, ...args: unknown[]) {
            for (const h of handlers[event] ?? []) h(...args);
        },
    };
}

type MockChild = ReturnType<typeof mockChild>;

// ── Helpers ─────────────────────────────────────────────────────────

function defaultOpts(overrides?: Partial<ServerManagerOptions>): ServerManagerOptions {
    return {
        binaryPath: "/usr/local/bin/lilbee",
        dataDir: "/tmp/data",
        modelsDir: "/tmp/models",
        ragSystemPrompt: "",
        generalSystemPrompt: "",
        ...overrides,
    };
}

/** Returns a fetch mock that succeeds (ok: true) on health checks. */
function _healthyFetch() {
    return vi.fn().mockResolvedValue({ ok: true });
}

/** Returns a fetch mock that always rejects. */
function _failingFetch() {
    return vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
}

// ── Test suite ──────────────────────────────────────────────────────

describe("ServerManager", () => {
    let spawnSpy: ReturnType<typeof vi.spyOn>;
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    let execFileSpy: ReturnType<typeof vi.spyOn>;
    let existsSyncSpy: ReturnType<typeof vi.spyOn>;
    let readFileSyncSpy: ReturnType<typeof vi.spyOn>;
    let unlinkSyncSpy: ReturnType<typeof vi.spyOn>;
    let appendFileSyncSpy: ReturnType<typeof vi.spyOn>;
    let child: MockChild;

    beforeEach(() => {
        vi.useFakeTimers();
        child = mockChild();
        spawnSpy = vi.spyOn(node, "spawn").mockReturnValue(child as any);
        fetchSpy = vi.spyOn(node, "fetch").mockResolvedValue({ ok: true } as any);
        execFileSpy = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" } as any);
        existsSyncSpy = vi.spyOn(node, "existsSync").mockReturnValue(true);
        readFileSyncSpy = vi.spyOn(node, "readFileSync").mockReturnValue("9999");
        unlinkSyncSpy = vi.spyOn(node, "unlinkSync").mockImplementation(() => {});
        appendFileSyncSpy = vi.spyOn(node, "appendFileSync").mockImplementation(() => {});
        vi.spyOn(node, "statSync").mockReturnValue({ size: 0 } as any);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    // ── Constructor / getters ───────────────────────────────────────

    describe("constructor", () => {
        it("initial state is stopped", () => {
            const mgr = new ServerManager(defaultOpts());
            expect(mgr.state).toBe("stopped");
        });

        it("serverUrl is empty until start() reads the port file", () => {
            const mgr = new ServerManager(defaultOpts());
            expect(mgr.serverUrl).toBe("");
        });

        it("dataDir getter returns the configured data dir", () => {
            const mgr = new ServerManager(defaultOpts({ dataDir: "/var/lilbee" }));
            expect(mgr.dataDir).toBe("/var/lilbee");
        });
    });

    // ── start() ─────────────────────────────────────────────────────

    describe("start()", () => {
        it("spawns the binary with correct args and env, sets state to ready", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(defaultOpts({ onStateChange: (s) => stateChanges.push(s) }));

            const startPromise = mgr.start();
            // Health poll setTimeout — advance past it
            await vi.advanceTimersByTimeAsync(1000);
            await startPromise;

            expect(spawnSpy).toHaveBeenCalledOnce();
            const [bin, args, opts] = spawnSpy.mock.calls[0] as any[];
            expect(bin).toBe("/usr/local/bin/lilbee");
            expect(args).toEqual(["serve", "--host", "127.0.0.1", "--data-dir", "/tmp/data"]);
            expect(args).not.toContain("--port");
            expect(opts.env.LILBEE_CORS_ORIGINS).toBe("app://obsidian.md");
            expect(opts.env.LILBEE_PARENT_PID).toBe(String(process.pid));
            expect(opts.env.LILBEE_MODELS_DIR).toBe("/tmp/models");
            // UTF-8 locale so the server's Python doesn't fall back to ASCII
            // stdio and crash crawling pages with non-ASCII output (e.g. "→").
            expect(opts.env.LANG).toBe("en_US.UTF-8");
            expect(opts.env.LC_ALL).toBe("en_US.UTF-8");
            expect(opts.env.PYTHONIOENCODING).toBe("utf-8");
            expect(opts.env.PYTHONUTF8).toBe("1");
            expect(opts.env.LILBEE_RAG_SYSTEM_PROMPT).toBeUndefined();
            expect(opts.env.LILBEE_GENERAL_SYSTEM_PROMPT).toBeUndefined();
            expect(opts.stdio).toEqual(["ignore", "pipe", "pipe"]);
            expect(opts.detached).toBe(false);

            expect(mgr.state).toBe("ready");
            expect(stateChanges).toContain("starting");
            expect(stateChanges).toContain("ready");
        });

        it("passes LILBEE_RAG_SYSTEM_PROMPT env when ragSystemPrompt is set", async () => {
            const mgr = new ServerManager(defaultOpts({ ragSystemPrompt: "You are a pirate." }));

            const startPromise = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await startPromise;

            const [, , opts] = spawnSpy.mock.calls[0] as any[];
            expect(opts.env.LILBEE_RAG_SYSTEM_PROMPT).toBe("You are a pirate.");
            expect(opts.env.LILBEE_GENERAL_SYSTEM_PROMPT).toBeUndefined();
        });

        it("passes LILBEE_GENERAL_SYSTEM_PROMPT env when generalSystemPrompt is set", async () => {
            const mgr = new ServerManager(defaultOpts({ generalSystemPrompt: "You are a friendly tutor." }));

            const startPromise = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await startPromise;

            const [, , opts] = spawnSpy.mock.calls[0] as any[];
            expect(opts.env.LILBEE_GENERAL_SYSTEM_PROMPT).toBe("You are a friendly tutor.");
            expect(opts.env.LILBEE_RAG_SYSTEM_PROMPT).toBeUndefined();
        });

        it("reads the actual port from the port file written by the server", async () => {
            const mgr = new ServerManager(defaultOpts());

            const startPromise = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await startPromise;

            expect(existsSyncSpy).toHaveBeenCalled();
            expect(readFileSyncSpy).toHaveBeenCalled();
            expect(mgr.serverUrl).toBe("http://127.0.0.1:9999");
            expect(mgr.state).toBe("ready");
        });

        it("sets state to error and rejects when the port file never appears", async () => {
            existsSyncSpy.mockReturnValue(false);
            const mgr = new ServerManager(defaultOpts());

            const startPromise = mgr.start();
            const rejection = expect(startPromise).rejects.toThrow("Port file not found within timeout");
            await vi.advanceTimersByTimeAsync(120_000);
            // The failure path stops the child; advance past the stop grace period.
            await vi.advanceTimersByTimeAsync(6_000);
            await rejection;

            expect(mgr.state).toBe("error");
        });

        it("ignores a port file whose contents are not a valid port and times out", async () => {
            // The file exists but holds garbage (e.g. a partial write); the port
            // is never accepted, so start() falls through to the error state.
            readFileSyncSpy.mockReturnValue("not-a-port");
            const mgr = new ServerManager(defaultOpts());

            const startPromise = mgr.start();
            const rejection = expect(startPromise).rejects.toThrow("Port file not found within timeout");
            await vi.advanceTimersByTimeAsync(120_000);
            await vi.advanceTimersByTimeAsync(6_000);
            await rejection;

            expect(mgr.serverUrl).toBe("");
            expect(mgr.state).toBe("error");
        }, 15_000);

        it("no-ops when child already exists", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            // Second call should return immediately without spawning again
            await mgr.start();
            expect(spawnSpy).toHaveBeenCalledOnce();
        });

        it("sets state to error and rejects when health polling times out", async () => {
            fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
            const stateChanges: string[] = [];
            const mgr = new ServerManager(defaultOpts({ onStateChange: (s) => stateChanges.push(s) }));

            const startPromise = mgr.start();
            const rejection = expect(startPromise).rejects.toThrow("Server did not become ready within timeout");
            // 120 attempts * 1000ms each = 120000ms
            await vi.advanceTimersByTimeAsync(120_000);
            await vi.advanceTimersByTimeAsync(6_000);
            await rejection;

            expect(mgr.state).toBe("error");
        }, 15_000);

        it("sets state to error when health returns non-ok then eventually times out", async () => {
            fetchSpy.mockResolvedValue({ ok: false } as any);
            const mgr = new ServerManager(defaultOpts());

            const startPromise = mgr.start();
            const rejection = expect(startPromise).rejects.toThrow("Server did not become ready within timeout");
            await vi.advanceTimersByTimeAsync(120_000);
            await vi.advanceTimersByTimeAsync(6_000);
            await rejection;

            expect(mgr.state).toBe("error");
        }, 15_000);

        it("removes a stale port file before spawning so the old port is never adopted", async () => {
            const mgr = new ServerManager(defaultOpts());

            const startPromise = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await startPromise;

            expect(unlinkSyncSpy).toHaveBeenCalledWith("/tmp/data/data/server.port");
            // Cleanup happens before the child is spawned.
            expect(unlinkSyncSpy.mock.invocationCallOrder[0]).toBeLessThan(spawnSpy.mock.invocationCallOrder[0]);
        });

        it("kills the spawned child on discovery failure so a retry can start clean", async () => {
            existsSyncSpy.mockReturnValue(false);
            const mgr = new ServerManager(defaultOpts());

            const startPromise = mgr.start();
            const rejection = expect(startPromise).rejects.toThrow("Port file not found within timeout");
            await vi.advanceTimersByTimeAsync(126_000);
            await rejection;

            expect(mgr.state).toBe("error");
            expect(child.kill).toHaveBeenCalled();
            expect((mgr as any).child).toBeNull();

            // With the failed child gone, a retry spawns a fresh server.
            existsSyncSpy.mockReturnValue(true);
            const retryPromise = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await retryPromise;

            expect(spawnSpy).toHaveBeenCalledTimes(2);
            expect(mgr.state).toBe("ready");
        }, 15_000);
    });

    // ── stop() ──────────────────────────────────────────────────────

    describe("stop()", () => {
        it("with no child, sets state to stopped immediately", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(defaultOpts({ onStateChange: (s) => stateChanges.push(s) }));
            await mgr.stop();
            expect(mgr.state).toBe("stopped");
            expect(stateChanges).toContain("stopped");
        });

        it("sends SIGTERM and sets stopped after exit event (unix)", async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, "platform", { value: "linux" });

            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            // Make kill emit exit asynchronously
            child.kill = vi.fn(() => {
                setTimeout(() => child._emit("exit", 0, null), 10);
            });

            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            await stopPromise;

            expect(child.kill).toHaveBeenCalledWith("SIGTERM");
            expect(mgr.state).toBe("stopped");

            Object.defineProperty(process, "platform", { value: originalPlatform });
        });

        it("sends SIGKILL after grace period if process does not exit", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            const stopPromise = mgr.stop();
            // Don't emit exit — let the grace period expire
            await vi.advanceTimersByTimeAsync(5000);
            await stopPromise;

            expect(child.kill).toHaveBeenCalledWith("SIGTERM");
            expect(child.kill).toHaveBeenCalledWith("SIGKILL");
            expect(mgr.state).toBe("stopped");
        });

        it("clears pending restart timer", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            // Simulate crash to trigger restart timer
            child._emit("exit", 1, null);
            // Now a 3000ms restart timer is pending

            await mgr.stop();
            // Advance past restart delay — should NOT trigger another start
            await vi.advanceTimersByTimeAsync(3000);
            // spawn was called once for the original start, should not be called again
            expect(spawnSpy).toHaveBeenCalledOnce();
            expect(mgr.state).toBe("stopped");
        });

        it("uses taskkill on Windows", async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, "platform", { value: "win32" });

            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            // Let execFile resolve, then emit exit so stop() can finish
            execFileSpy.mockImplementation(async () => {
                // Schedule exit emission after taskkill "completes"
                setTimeout(() => child._emit("exit", 0, null), 10);
                return { stdout: "", stderr: "" };
            });

            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            await stopPromise;

            expect(execFileSpy).toHaveBeenCalledWith("taskkill", ["/pid", "1234", "/f", "/t"]);
            expect(mgr.state).toBe("stopped");

            Object.defineProperty(process, "platform", { value: originalPlatform });
        });

        it("surfaces taskkill failures on Windows via onShutdownFailure callback", async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, "platform", { value: "win32" });
            execFileSpy.mockImplementation(async () => {
                setTimeout(() => child._emit("exit", 0, null), 10);
                throw new Error("process not found");
            });

            const failures: Error[] = [];
            const mgr = new ServerManager(defaultOpts({ onShutdownFailure: (err) => failures.push(err) }));
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            await stopPromise;

            // State still reaches stopped — but the failure is surfaced, not swallowed.
            expect(mgr.state).toBe("stopped");
            expect(failures).toHaveLength(1);
            expect(failures[0].message).toBe("process not found");

            Object.defineProperty(process, "platform", { value: originalPlatform });
        });

        it("does not invoke onShutdownFailure when no callback is registered", async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, "platform", { value: "win32" });
            execFileSpy.mockImplementation(async () => {
                setTimeout(() => child._emit("exit", 0, null), 10);
                throw new Error("process not found");
            });

            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            // Should not throw despite no callback.
            await stopPromise;

            expect(mgr.state).toBe("stopped");
            Object.defineProperty(process, "platform", { value: originalPlatform });
        });

        it("wraps a non-Error thrown value when surfacing a shutdown failure", async () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, "platform", { value: "win32" });
            execFileSpy.mockImplementation(async () => {
                setTimeout(() => child._emit("exit", 0, null), 10);
                throw "some string failure";
            });

            const failures: Error[] = [];
            const mgr = new ServerManager(defaultOpts({ onShutdownFailure: (err) => failures.push(err) }));
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            await stopPromise;

            expect(failures).toHaveLength(1);
            expect(failures[0]).toBeInstanceOf(Error);
            expect(failures[0].message).toBe("some string failure");
            Object.defineProperty(process, "platform", { value: originalPlatform });
        });

        it("cleans up port file on stop", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            child.kill = vi.fn(() => {
                setTimeout(() => child._emit("exit", 0, null), 10);
            });

            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            await stopPromise;

            expect(unlinkSyncSpy).toHaveBeenCalled();
        });

        it("handles port file cleanup failure gracefully on stop", async () => {
            unlinkSyncSpy.mockImplementation(() => {
                throw new Error("permission denied");
            });

            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            child.kill = vi.fn(() => {
                setTimeout(() => child._emit("exit", 0, null), 10);
            });

            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            await stopPromise;

            expect(mgr.state).toBe("stopped");
        });

        it("skips port file cleanup when the file is already gone", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            child.kill = vi.fn(() => {
                setTimeout(() => child._emit("exit", 0, null), 10);
            });
            // Port file vanished between start and stop — e.g. the server
            // unlinked it on shutdown before our stop() ran the check.
            existsSyncSpy.mockReturnValue(false);
            // Only stop()'s cleanup is under test, not start()'s pre-spawn unlink.
            unlinkSyncSpy.mockClear();

            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            await stopPromise;

            expect(unlinkSyncSpy).not.toHaveBeenCalled();
            expect(mgr.state).toBe("stopped");
        });
    });

    // ── restart() ───────────────────────────────────────────────────

    describe("restart()", () => {
        it("calls stop then start and resets crash count", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            // Simulate a crash to increment crashCount
            child._emit("exit", 1, null);

            // Prepare a fresh child for the restart
            const child2 = mockChild();
            spawnSpy.mockReturnValue(child2 as any);

            const restartPromise = mgr.restart();
            await vi.advanceTimersByTimeAsync(1000);
            await restartPromise;

            expect(mgr.state).toBe("ready");
            // spawn was called twice: original + restart
            expect(spawnSpy).toHaveBeenCalledTimes(2);
        });
    });

    // ── Crash recovery ──────────────────────────────────────────────

    describe("crash recovery", () => {
        it("increments crashCount, sets error, and schedules restart on exit", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(defaultOpts({ onStateChange: (s) => stateChanges.push(s) }));

            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            // Prepare a new child for the restart
            const child2 = mockChild();
            spawnSpy.mockReturnValue(child2 as any);

            // Simulate crash
            child._emit("exit", 1, null);
            expect(mgr.state).toBe("error");

            // Advance past restart delay (3000ms) + health poll (500ms)
            await vi.advanceTimersByTimeAsync(3500);

            expect(spawnSpy).toHaveBeenCalledTimes(2);
        });

        it("stops restarting after MAX_CRASH_RESTARTS (3)", async () => {
            const mgr = new ServerManager(defaultOpts());

            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;
            // spawn call #1 done, crashCount = 0

            // Make health checks fail from now on so crashCount never resets
            fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

            for (let i = 0; i < 3; i++) {
                const nextChild = mockChild();
                spawnSpy.mockReturnValue(nextChild as any);

                // Crash the current child
                child._emit("exit", 1, null);
                // crashCount is now i+1, restart timer scheduled (3000ms)

                // Advance past restart delay so start() is called
                await vi.advanceTimersByTimeAsync(3000);
                // start() spawns nextChild and enters waitForReady (30 * 500ms = 15000ms)
                // Advance past all health poll attempts
                await vi.advanceTimersByTimeAsync(15_000);

                child = nextChild;
            }

            // Now crashCount = 3. Crash once more — should NOT schedule restart
            child._emit("exit", 1, null);
            expect(mgr.state).toBe("error");

            await vi.advanceTimersByTimeAsync(10_000);
            // 1 initial + 3 restarts = 4 spawn calls total
            expect(spawnSpy).toHaveBeenCalledTimes(4);
        });

        it("calls onRestartsExhausted with the captured output when max restarts exceeded", async () => {
            const onExhausted = vi.fn();
            const mgr = new ServerManager(defaultOpts({ onRestartsExhausted: onExhausted }));

            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

            for (let i = 0; i < 3; i++) {
                const nextChild = mockChild();
                spawnSpy.mockReturnValue(nextChild as any);
                child._emit("exit", 1, null);
                await vi.advanceTimersByTimeAsync(3000);
                await vi.advanceTimersByTimeAsync(15_000);
                child = nextChild;
            }

            // Write some stderr before final crash
            child.stderr._emit("data", Buffer.from("bind: address already in use\n"));

            // Final crash — max restarts exhausted
            child._emit("exit", 1, null);
            expect(onExhausted).toHaveBeenCalledTimes(1);
            expect(onExhausted).toHaveBeenCalledWith(expect.stringContaining("address already in use"));
            // The exit detail rides along in the same output buffer.
            expect(onExhausted).toHaveBeenCalledWith(expect.stringContaining("server exited (exit code 1)"));
        });

        it("aborts a pending start as soon as restarts are exhausted", async () => {
            existsSyncSpy.mockReturnValue(false);
            const onExhausted = vi.fn();
            const mgr = new ServerManager(defaultOpts({ onRestartsExhausted: onExhausted }));

            const startPromise = mgr.start();
            const rejection = expect(startPromise).rejects.toThrow(
                "Server exited (signal SIGKILL) and did not come back after 3 restarts",
            );

            for (let i = 0; i < 3; i++) {
                const nextChild = mockChild();
                spawnSpy.mockReturnValue(nextChild as any);
                child._emit("exit", 1, null);
                await vi.advanceTimersByTimeAsync(3_000);
                child = nextChild;
            }

            // Final crash exhausts the budget; the pending start aborts on its next poll tick
            // (~500ms) instead of burning the rest of the 120s port-file window.
            child._emit("exit", null, "SIGKILL");
            await vi.advanceTimersByTimeAsync(1_000);
            await rejection;

            expect(onExhausted).toHaveBeenCalledTimes(1);
            expect(mgr.state).toBe("error");
        });

        it("stop() during restart delay cancels the pending restart", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            // Crash triggers restart timer
            child._emit("exit", 1, null);

            // Stop before the restart timer fires
            await mgr.stop();

            // Advance past what would have been the restart
            await vi.advanceTimersByTimeAsync(5000);
            expect(spawnSpy).toHaveBeenCalledOnce();
            expect(mgr.state).toBe("stopped");
        });
    });

    // ── crash output snapshot ───────────────────────────────────────

    describe("crash output snapshot", () => {
        function crashLogCalls() {
            return appendFileSyncSpy.mock.calls.filter(([path]) => String(path).includes("logs/spawn-crash.log"));
        }

        it("appends the captured output and exit detail to logs/spawn-crash.log on crash exit", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            child.stderr._emit("data", Buffer.from("fatal: bind failed\n"));
            child._emit("exit", 1, null);

            const calls = crashLogCalls();
            expect(calls).toHaveLength(1);
            const [path, chunk] = calls[0] as unknown as [string, string];
            expect(path).toBe("/tmp/data/logs/spawn-crash.log");
            expect(chunk).toMatch(/^=== crash \d{4}-\d{2}-\d{2}T/);
            expect(chunk).toContain("fatal: bind failed");
            expect(chunk).toContain("server exited (exit code 1)");
        });

        it("describes an exit with neither code nor signal as unknown cause", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            child._emit("exit", null, null);

            const [, chunk] = crashLogCalls()[0] as unknown as [string, string];
            expect(chunk).toContain("server exited (unknown cause)");
        });

        it("does not snapshot on clean stop", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            child.kill = vi.fn(() => {
                setTimeout(() => child._emit("exit", 0, null), 10);
            });
            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            await stopPromise;

            expect(crashLogCalls()).toHaveLength(0);
        });

        it("snapshot failures do not break crash handling", async () => {
            appendFileSyncSpy.mockImplementation(() => {
                throw new Error("ENOSPC");
            });
            const mgr = new ServerManager(defaultOpts());
            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            const child2 = mockChild();
            spawnSpy.mockReturnValue(child2 as any);
            child._emit("exit", 1, null);

            expect(mgr.state).toBe("error");
            // Restart timer still fires and respawns the server.
            await vi.advanceTimersByTimeAsync(3500);
            expect(spawnSpy).toHaveBeenCalledTimes(2);
        });
    });

    // ── error event ─────────────────────────────────────────────────

    describe("error event", () => {
        it("rejects the pending start with the launch error instead of polling out the timeout", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(defaultOpts({ onStateChange: (s) => stateChanges.push(s) }));

            const p1 = mgr.start();
            const rejection = expect(p1).rejects.toThrow("Failed to launch server: spawn ENOENT");
            // Fire error before health check completes
            child._emit("error", new Error("spawn ENOENT"));
            await vi.advanceTimersByTimeAsync(1_000);
            await rejection;

            expect(stateChanges).toContain("error");
            expect((mgr as any).child).toBeNull();
            expect(mgr.lastOutput).toContain("failed to launch server: spawn ENOENT");
        });

        it("snapshots the launch failure to the crash log", async () => {
            const mgr = new ServerManager(defaultOpts());

            const p1 = mgr.start();
            const rejection = expect(p1).rejects.toThrow("Failed to launch server: spawn EACCES");
            child._emit("error", new Error("spawn EACCES"));
            await vi.advanceTimersByTimeAsync(1_000);
            await rejection;

            const calls = appendFileSyncSpy.mock.calls.filter(([path]) =>
                String(path).includes("logs/spawn-crash.log"),
            );
            expect(calls).toHaveLength(1);
            expect(String(calls[0][1])).toContain("failed to launch server: spawn EACCES");
        });

        it("ignores an error event during a deliberate stop", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            appendFileSyncSpy.mockClear();
            const stopPromise = mgr.stop();
            child._emit("error", new Error("kill EPERM"));
            await vi.advanceTimersByTimeAsync(6_000);
            await stopPromise;

            expect(mgr.state).toBe("stopped");
            expect(mgr.lastOutput).not.toContain("failed to launch server");
            expect(appendFileSyncSpy).not.toHaveBeenCalled();
        });

        it("aborts health polling when the child reports a launch error", async () => {
            fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
            const mgr = new ServerManager(defaultOpts());

            const startPromise = mgr.start();
            const rejection = expect(startPromise).rejects.toThrow("Failed to launch server: EACCES");
            await vi.advanceTimersByTimeAsync(2_000);
            child._emit("error", new Error("EACCES"));
            await vi.advanceTimersByTimeAsync(2_000);
            await rejection;

            expect(mgr.state).toBe("error");
        });
    });

    // ── stop during startup ─────────────────────────────────────────

    describe("stop() during startup", () => {
        it("resolves the pending start quietly instead of erroring", async () => {
            existsSyncSpy.mockReturnValue(false);
            const mgr = new ServerManager(defaultOpts());

            const startPromise = mgr.start();
            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(6_000);
            await stopPromise;
            await startPromise;

            expect(mgr.state).toBe("stopped");
        });
    });

    // ── stderr capture ────────────────────────────────────────────────

    describe("lastOutput", () => {
        it("returns empty string initially", () => {
            const mgr = new ServerManager(defaultOpts());
            expect(mgr.lastOutput).toBe("");
        });

        it("collects stderr lines from the spawned process", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            child.stderr._emit("data", Buffer.from("line one\nline two\n"));
            expect(mgr.lastOutput).toBe("line one\nline two");
        });

        it("collects stdout lines alongside stderr", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            child.stdout._emit("data", Buffer.from("Listening on http://127.0.0.1:9999\n"));
            child.stderr._emit("data", Buffer.from("warning: slow disk\n"));
            expect(mgr.lastOutput).toBe("Listening on http://127.0.0.1:9999\nwarning: slow disk");
        });

        it("skips empty lines emitted by the server", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            child.stderr._emit("data", Buffer.from("line one\n\nline two\n"));
            expect(mgr.lastOutput).toBe("line one\nline two");
        });

        it("no-ops when the spawned child has no stdio streams", async () => {
            const childNoStreams = { ...mockChild(), stdout: null, stderr: null };
            spawnSpy.mockReturnValue(childNoStreams as any);

            const mgr = new ServerManager(defaultOpts());
            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            expect(mgr.lastOutput).toBe("");
            expect(mgr.state).toBe("ready");
        });

        it("limits to MAX_OUTPUT_LINES", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            const lines = Array.from({ length: 25 }, (_, i) => `line ${i}`).join("\n") + "\n";
            child.stderr._emit("data", Buffer.from(lines));
            const collected = mgr.lastOutput.split("\n");
            expect(collected.length).toBe(20);
            expect(collected[0]).toBe("line 5");
            expect(collected[19]).toBe("line 24");
        });

        it("resets captured output on new start", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            child.stderr._emit("data", Buffer.from("old error\n"));
            expect(mgr.lastOutput).toBe("old error");

            // Stop and restart
            child.kill = vi.fn(() => {
                setTimeout(() => child._emit("exit", 0, null), 10);
            });
            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            await stopPromise;

            const child2 = mockChild();
            spawnSpy.mockReturnValue(child2 as any);
            const p2 = mgr.restart();
            await vi.advanceTimersByTimeAsync(1000);
            await p2;

            expect(mgr.lastOutput).toBe("");
        });
    });

    // ── onStateChange callback ──────────────────────────────────────

    describe("onStateChange", () => {
        it("fires for each state transition during start", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(defaultOpts({ onStateChange: (s) => stateChanges.push(s) }));

            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            expect(stateChanges).toEqual(["starting", "ready"]);
        });

        it("fires for state transitions during stop", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(defaultOpts({ onStateChange: (s) => stateChanges.push(s) }));

            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            stateChanges.length = 0;

            // Override kill to emit exit asynchronously
            child.kill = vi.fn(() => {
                setTimeout(() => child._emit("exit", 0, null), 10);
            });

            const stopPromise = mgr.stop();
            await vi.advanceTimersByTimeAsync(50);
            await stopPromise;

            expect(stateChanges).toEqual(["stopped"]);
        });

        it("works when no callback is provided", async () => {
            const mgr = new ServerManager(defaultOpts());
            // Should not throw when setState is called without a callback
            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;
            expect(mgr.state).toBe("ready");
        });
    });
});
