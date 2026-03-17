import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { node } from "../src/binary-manager";
import { ServerManager } from "../src/server-manager";
import type { ServerManagerOptions } from "../src/server-manager";

// ── Mock child process ──────────────────────────────────────────────

function mockChild() {
    const handlers: Record<string, Function[]> = {};
    return {
        pid: 1234,
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
        port: 7433,
        ollamaUrl: "http://localhost:11434",
        ...overrides,
    };
}

/** Returns a fetch mock that succeeds (ok: true) on health checks. */
function healthyFetch() {
    return vi.fn().mockResolvedValue({ ok: true });
}

/** Returns a fetch mock that always rejects. */
function failingFetch() {
    return vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
}

// ── Test suite ──────────────────────────────────────────────────────

describe("ServerManager", () => {
    let spawnSpy: ReturnType<typeof vi.spyOn>;
    let fetchSpy: ReturnType<typeof vi.spyOn>;
    let execFileSpy: ReturnType<typeof vi.spyOn>;
    let child: MockChild;

    beforeEach(() => {
        vi.useFakeTimers();
        child = mockChild();
        spawnSpy = vi.spyOn(node, "spawn").mockReturnValue(child as any);
        fetchSpy = vi.spyOn(node, "fetch").mockResolvedValue({ ok: true } as any);
        execFileSpy = vi.spyOn(node, "execFile").mockResolvedValue({ stdout: "", stderr: "" } as any);
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

        it("serverUrl reflects the configured port", () => {
            const mgr = new ServerManager(defaultOpts({ port: 9999 }));
            expect(mgr.serverUrl).toBe("http://127.0.0.1:9999");
        });
    });

    // ── start() ─────────────────────────────────────────────────────

    describe("start()", () => {
        it("spawns the binary with correct args and env, sets state to ready", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(
                defaultOpts({ onStateChange: (s) => stateChanges.push(s) }),
            );

            const startPromise = mgr.start();
            // Health poll setTimeout — advance past it
            await vi.advanceTimersByTimeAsync(1000);
            await startPromise;

            expect(spawnSpy).toHaveBeenCalledOnce();
            const [bin, args, opts] = spawnSpy.mock.calls[0] as any[];
            expect(bin).toBe("/usr/local/bin/lilbee");
            expect(args).toEqual([
                "serve",
                "--host", "127.0.0.1",
                "--port", "7433",
                "--data-dir", "/tmp/data",
            ]);
            expect(opts.env.OLLAMA_HOST).toBe("http://localhost:11434");
            expect(opts.stdio).toBe("ignore");
            expect(opts.detached).toBe(false);

            expect(mgr.state).toBe("ready");
            expect(stateChanges).toContain("starting");
            expect(stateChanges).toContain("ready");
        });

        it("no-ops when child already exists", async () => {
            const mgr = new ServerManager(defaultOpts());
            const p1 = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p1;

            // Second call should return immediately without spawning again
            await mgr.start();
            expect(spawnSpy).toHaveBeenCalledOnce();
        });

        it("sets state to error when health polling times out", async () => {
            fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));
            const stateChanges: string[] = [];
            const mgr = new ServerManager(
                defaultOpts({ onStateChange: (s) => stateChanges.push(s) }),
            );

            const startPromise = mgr.start();
            // 60 attempts * 1000ms each = 60000ms
            await vi.advanceTimersByTimeAsync(60_000);
            await startPromise;

            expect(mgr.state).toBe("error");
        });

        it("sets state to error when health returns non-ok then eventually times out", async () => {
            fetchSpy.mockResolvedValue({ ok: false } as any);
            const mgr = new ServerManager(defaultOpts());

            const startPromise = mgr.start();
            await vi.advanceTimersByTimeAsync(60_000);
            await startPromise;

            expect(mgr.state).toBe("error");
        });
    });

    // ── stop() ──────────────────────────────────────────────────────

    describe("stop()", () => {
        it("with no child, sets state to stopped immediately", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(
                defaultOpts({ onStateChange: (s) => stateChanges.push(s) }),
            );
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

            expect(execFileSpy).toHaveBeenCalledWith(
                "taskkill",
                ["/pid", "1234", "/f", "/t"],
            );
            expect(mgr.state).toBe("stopped");

            Object.defineProperty(process, "platform", { value: originalPlatform });
        });

        it("handles taskkill failure gracefully on Windows", async () => {
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
            await stopPromise;

            // Should not throw — error is swallowed
            expect(mgr.state).toBe("stopped");

            Object.defineProperty(process, "platform", { value: originalPlatform });
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
            const mgr = new ServerManager(
                defaultOpts({ onStateChange: (s) => stateChanges.push(s) }),
            );

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

    // ── error event ─────────────────────────────────────────────────

    describe("error event", () => {
        it("sets state to error and nullifies child", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(
                defaultOpts({ onStateChange: (s) => stateChanges.push(s) }),
            );

            const p1 = mgr.start();
            // Fire error before health check completes
            child._emit("error", new Error("spawn ENOENT"));
            await vi.advanceTimersByTimeAsync(15_000);
            await p1;

            expect(stateChanges).toContain("error");
        });
    });

    // ── updateOllamaUrl / updatePort ────────────────────────────────

    describe("updateOllamaUrl", () => {
        it("updates the Ollama URL in options", () => {
            const mgr = new ServerManager(defaultOpts());
            mgr.updateOllamaUrl("http://remote:11434");

            // Start to verify the new URL is used
            mgr.start();
            const env = (spawnSpy.mock.calls[0] as any[])[2].env;
            expect(env.OLLAMA_HOST).toBe("http://remote:11434");
        });
    });

    describe("updatePort", () => {
        it("updates the port in options", () => {
            const mgr = new ServerManager(defaultOpts());
            mgr.updatePort(8080);
            expect(mgr.serverUrl).toBe("http://127.0.0.1:8080");
        });
    });

    // ── onStateChange callback ──────────────────────────────────────

    describe("onStateChange", () => {
        it("fires for each state transition during start", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(
                defaultOpts({ onStateChange: (s) => stateChanges.push(s) }),
            );

            const p = mgr.start();
            await vi.advanceTimersByTimeAsync(1000);
            await p;

            expect(stateChanges).toEqual(["starting", "ready"]);
        });

        it("fires for state transitions during stop", async () => {
            const stateChanges: string[] = [];
            const mgr = new ServerManager(
                defaultOpts({ onStateChange: (s) => stateChanges.push(s) }),
            );

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
