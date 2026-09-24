import { describe, it, expect, vi } from "vitest";
import { StreamIdleError, withIdleTimeout } from "../../src/utils/idle";

describe("withIdleTimeout", () => {
    it("yields events when they arrive before the idle timeout", async () => {
        async function* gen() {
            yield "a";
            yield "b";
        }
        const abort = vi.fn();
        const out: string[] = [];
        for await (const v of withIdleTimeout(gen(), 1000, abort)) out.push(v);
        expect(out).toEqual(["a", "b"]);
        expect(abort).not.toHaveBeenCalled();
    });

    it("throws StreamIdleError and calls abort when no event arrives in timeout", async () => {
        async function* gen(): AsyncGenerator<string> {
            await new Promise(() => {});
        }
        const abort = vi.fn();
        let caught: unknown = null;
        try {
            for await (const _ of withIdleTimeout(gen(), 10, abort)) void _;
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(StreamIdleError);
        expect(abort).toHaveBeenCalledTimes(1);
    });

    it("stops cleanly when source generator completes", async () => {
        async function* gen() {
            yield 1;
        }
        const out: number[] = [];
        for await (const v of withIdleTimeout(gen(), 1000, vi.fn())) out.push(v);
        expect(out).toEqual([1]);
    });

    it("skips the clearTimeout call when clearTimeout is not a function", async () => {
        // Mirrors vitest's fake-timer lifecycle leaving clearTimeout undefined
        // across test-file boundaries — the generator must still yield cleanly.
        const original = globalThis.clearTimeout;
        // @ts-expect-error intentionally removing clearTimeout to exercise the guard
        globalThis.clearTimeout = undefined;
        try {
            async function* gen() {
                yield "x";
            }
            const out: string[] = [];
            for await (const v of withIdleTimeout(gen(), 1000, vi.fn())) out.push(v);
            expect(out).toEqual(["x"]);
        } finally {
            globalThis.clearTimeout = original;
        }
    });
});
