import { describe, it, expect, vi } from "vitest";
import { tryCatch } from "../src/result";

describe("tryCatch", () => {
    it("returns ok result when function succeeds", async () => {
        const result = await tryCatch(async () => "success");
        expect(result.ok).toBe(true);
        expect(result.value).toBe("success");
    });

    it("returns err result when function throws", async () => {
        const result = await tryCatch(async () => {
            throw new Error("fail");
        });
        expect(result.ok).toBe(false);
        expect(result.error.message).toBe("fail");
    });

    it("wraps non-Error throws", async () => {
        const result = await tryCatch(async () => {
            throw "string error";
        });
        expect(result.ok).toBe(false);
        expect(result.error.message).toBe("string error");
    });
});
