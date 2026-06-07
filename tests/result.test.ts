import { describe, it, expect } from "vitest";
import { ok, err, type Result } from "../src/result";

describe("result", () => {
    it("ok produces a Result that narrows to its value", () => {
        const result: Result<number, Error> = ok(42);
        expect(result.isOk()).toBe(true);
        expect(result.isErr()).toBe(false);
        if (result.isOk()) expect(result.value).toBe(42);
    });

    it("err produces a Result that narrows to its error", () => {
        const failure = new Error("boom");
        const result: Result<number, Error> = err(failure);
        expect(result.isOk()).toBe(false);
        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error).toBe(failure);
    });

    it("_unsafeUnwrap returns the value on Ok and throws on Err", () => {
        expect(ok(7)._unsafeUnwrap()).toBe(7);
        expect(() => err(new Error("boom"))._unsafeUnwrap()).toThrow("Called _unsafeUnwrap on an Err value");
    });

    it("_unsafeUnwrapErr returns the error on Err and throws on Ok", () => {
        const failure = new Error("boom");
        expect(err(failure)._unsafeUnwrapErr()).toBe(failure);
        expect(() => ok(7)._unsafeUnwrapErr()).toThrow("Called _unsafeUnwrapErr on an Ok value");
    });
});
