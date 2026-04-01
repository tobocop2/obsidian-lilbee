import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ok,
  err,
  isOk,
  isErr,
  tryCatch,
  tryCatchSync,
  map,
  mapErr,
  getOrElse,
  unwrap,
  ifErr,
  type Result,
  type ResultOk,
  type ResultErr,
} from "../src/result";

describe("ok()", () => {
  it("creates ResultOk with correct structure", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    expect((result as ResultOk<number, Error>).value).toBe(42);
  });

  it("works with different types", () => {
    const result = ok("hello");
    expect(result.ok).toBe(true);
    expect((result as ResultOk<string, Error>).value).toBe("hello");
  });

  it("works with objects", () => {
    const obj = { foo: "bar" };
    const result = ok(obj);
    expect(result.ok).toBe(true);
    expect((result as ResultOk<{ foo: string }, Error>).value).toBe(obj);
  });
});

describe("err()", () => {
  it("creates ResultErr with correct structure", () => {
    const error = new Error("test error");
    const result = err(error);
    expect(result.ok).toBe(false);
    expect((result as ResultErr<unknown, Error>).error).toBe(error);
  });

  it("works with string errors", () => {
    const result = err<string, string>("something went wrong");
    expect(result.ok).toBe(false);
    expect((result as ResultErr<string, string>).error).toBe("something went wrong");
  });
});

describe("isOk()", () => {
  it("returns true for ResultOk", () => {
    const result: Result<number> = ok(42);
    expect(isOk(result)).toBe(true);
  });

  it("returns false for ResultErr", () => {
    const result: Result<number> = err(new Error("fail"));
    expect(isOk(result)).toBe(false);
  });
});

describe("isErr()", () => {
  it("returns false for ResultOk", () => {
    const result: Result<number> = ok(42);
    expect(isErr(result)).toBe(false);
  });

  it("returns true for ResultErr", () => {
    const result: Result<number> = err(new Error("fail"));
    expect(isErr(result)).toBe(true);
  });
});

describe("tryCatch()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("captures success and returns ResultOk", async () => {
    const result = await tryCatch(async () => 42);
    expect(result.ok).toBe(true);
    expect((result as ResultOk<number, Error>).value).toBe(42);
  });

  it("catches error and returns ResultErr", async () => {
    const result = await tryCatch(async () => {
      throw new Error("async error");
    });
    expect(result.ok).toBe(false);
    expect((result as ResultErr<number, Error>).error.message).toBe("async error");
  });

  it("wraps non-Error thrown values", async () => {
    const result = await tryCatch(async () => {
      throw "string error";
    });
    expect(result.ok).toBe(false);
    expect((result as ResultErr<number, Error>).error.message).toBe("string error");
  });

  it("works with Promise resolve", async () => {
    const result = await tryCatch(async () => Promise.resolve("success"));
    expect(result.ok).toBe(true);
    expect((result as ResultOk<string, Error>).value).toBe("success");
  });
});

describe("tryCatchSync()", () => {
  it("captures success and returns ResultOk", () => {
    const result = tryCatchSync(() => 42);
    expect(result.ok).toBe(true);
    expect((result as ResultOk<number, Error>).value).toBe(42);
  });

  it("catches error and returns ResultErr", () => {
    const result = tryCatchSync(() => {
      throw new Error("sync error");
    });
    expect(result.ok).toBe(false);
    expect((result as ResultErr<number, Error>).error.message).toBe("sync error");
  });

  it("wraps non-Error thrown values", () => {
    const result = tryCatchSync(() => {
      throw 123;
    });
    expect(result.ok).toBe(false);
    expect((result as ResultErr<number, Error>).error.message).toBe("123");
  });

  it("works with function returning object", () => {
    const result = tryCatchSync(() => ({ status: "ok" }));
    expect(result.ok).toBe(true);
    expect((result as ResultOk<{ status: string }, Error>).value).toEqual({ status: "ok" });
  });
});

describe("map()", () => {
  it("transforms value on success", () => {
    const result: Result<number> = ok(2);
    const mapped = map(result, (x) => x * 3);
    expect(mapped.ok).toBe(true);
    expect((mapped as ResultOk<number, Error>).value).toBe(6);
  });

  it("passes through error unchanged", () => {
    const error = new Error("fail");
    const result: Result<number> = err(error);
    const mapped = map(result, (x) => x * 3);
    expect(mapped.ok).toBe(false);
    expect((mapped as ResultErr<number, Error>).error).toBe(error);
  });

  it("can change the type", () => {
    const result: Result<number> = ok(5);
    const mapped = map(result, (x) => x.toString());
    expect(mapped.ok).toBe(true);
    expect((mapped as ResultOk<string, Error>).value).toBe("5");
  });
});

describe("mapErr()", () => {
  it("passes through success unchanged", () => {
    const result: Result<number> = ok(42);
    const mapped = mapErr(result, (e) => new Error(`wrapped: ${e.message}`));
    expect(mapped.ok).toBe(true);
    expect((mapped as ResultOk<number, Error>).value).toBe(42);
  });

  it("transforms error on failure", () => {
    const result: Result<number> = err(new Error("original"));
    const mapped = mapErr(result, (e) => new Error(`wrapped: ${e.message}`));
    expect(mapped.ok).toBe(false);
    expect((mapped as ResultErr<number, Error>).error.message).toBe("wrapped: original");
  });

  it("can change error type", () => {
    const result: Result<number, string> = err("error string");
    const mapped = mapErr(result, (e) => new Error(e));
    expect(mapped.ok).toBe(false);
    expect((mapped as ResultErr<number, Error>).error.message).toBe("error string");
  });
});

describe("getOrElse()", () => {
  it("returns value on success", () => {
    const result: Result<number> = ok(42);
    expect(getOrElse(result, 0)).toBe(42);
  });

  it("returns default on error", () => {
    const result: Result<number> = err(new Error("fail"));
    expect(getOrElse(result, 0)).toBe(0);
  });

  it("works with different default types", () => {
    const result: Result<string> = err(new Error("fail"));
    expect(getOrElse(result, "default")).toBe("default");
  });
});

describe("unwrap()", () => {
  it("returns value on success", () => {
    const result: Result<number> = ok(42);
    expect(unwrap(result)).toBe(42);
  });

  it("throws on error", () => {
    const error = new Error("unwrap failed");
    const result: Result<number> = err(error);
    expect(() => unwrap(result)).toThrow(error);
  });
});

describe("ifErr()", () => {
  it("does not call callback on success", () => {
    const fn = vi.fn();
    const result: Result<number> = ok(42);
    ifErr(result, fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("calls callback on error", () => {
    const fn = vi.fn();
    const error = new Error("test error");
    const result: Result<number> = err(error);
    ifErr(result, fn);
    expect(fn).toHaveBeenCalledWith(error);
  });

  it("passes error to callback", () => {
    const fn = vi.fn();
    const result: Result<number, string> = err("error string");
    ifErr(result, fn);
    expect(fn).toHaveBeenCalledWith("error string");
  });
});
