import { MockElement } from "./__mocks__/obsidian";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Notice } from "obsidian";
import {
    StreamIdleError,
    _resetServerUnreachableDebounce,
    ensureUrlScheme,
    errorMessage,
    extractServerErrorDetail,
    extractSseErrorCode,
    extractSseErrorMessage,
    formatBytes,
    formatDiskSize,
    formatElapsed,
    formatRate,
    getRelevantSystemMemoryGB,
    isModelUnavailableError,
    isRoleMismatchDetail,
    isStreamInterruptedError,
    noticeForResultError,
    noticeServerUnreachableIfApplicable,
    percentFromSse,
    percentOfBytes,
    relativeTimeFromIso,
    sessionTokenInvalidMessage,
    setDeterminateProgress,
    streamInterruptedMessage,
    withIdleTimeout,
} from "../src/utils";
import { ServerStartingError, SessionTokenError } from "../src/api";
import { SERVER_MODE } from "../src/types";
import { MESSAGES } from "../src/locales/en";
import { ERROR_NAME } from "../src/types";

describe("ensureUrlScheme", () => {
    it("returns URL unchanged when it starts with https://", () => {
        expect(ensureUrlScheme("https://example.com")).toBe("https://example.com");
    });

    it("returns URL unchanged when it starts with http://", () => {
        expect(ensureUrlScheme("http://example.com")).toBe("http://example.com");
    });

    it("is case-insensitive for existing scheme", () => {
        expect(ensureUrlScheme("HTTP://example.com")).toBe("HTTP://example.com");
        expect(ensureUrlScheme("HTTPS://example.com")).toBe("HTTPS://example.com");
        expect(ensureUrlScheme("Https://example.com")).toBe("Https://example.com");
    });

    it("prepends https:// when no scheme is present", () => {
        expect(ensureUrlScheme("example.com")).toBe("https://example.com");
    });

    it("prepends https:// for URLs with paths but no scheme", () => {
        expect(ensureUrlScheme("example.com/page")).toBe("https://example.com/page");
    });

    it("prepends https:// for URLs with subdomains but no scheme", () => {
        expect(ensureUrlScheme("www.example.com")).toBe("https://www.example.com");
    });
});

describe("formatBytes", () => {
    it("returns 0 B for non-finite or negative inputs", () => {
        expect(formatBytes(NaN)).toBe("0 B");
        expect(formatBytes(Infinity)).toBe("0 B");
        expect(formatBytes(-1)).toBe("0 B");
    });

    it("formats sub-kilobyte values in bytes without decimals", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(1023)).toBe("1023 B");
    });

    it("formats kilobytes with one decimal until 100", () => {
        expect(formatBytes(1024)).toBe("1.0 KB");
        expect(formatBytes(1536)).toBe("1.5 KB");
    });

    it("formats megabytes and gigabytes", () => {
        expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
        expect(formatBytes(1.2 * 1024 * 1024 * 1024)).toBe("1.2 GB");
    });

    it("drops decimals once value >= 100 in its unit", () => {
        expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
    });

    it("caps at TB", () => {
        expect(formatBytes(2 * 1024 ** 4)).toBe("2.0 TB");
    });
});

describe("formatDiskSize", () => {
    it("renders 0 explicitly", () => {
        expect(formatDiskSize(0)).toBe("0 B");
    });

    it("renders bytes below a kilobyte", () => {
        expect(formatDiskSize(500)).toBe("500 B");
    });

    it("renders kilobytes", () => {
        expect(formatDiskSize(2_500)).toBe("2.50 KB");
    });

    it("renders megabytes", () => {
        expect(formatDiskSize(12_500_000)).toBe("12.5 MB");
    });

    it("renders gigabytes", () => {
        expect(formatDiskSize(2_500_000_000)).toBe("2.50 GB");
    });

    it("drops decimals once values exceed 100", () => {
        expect(formatDiskSize(123_000_000)).toBe("123 MB");
    });
});

describe("formatRate", () => {
    it("returns empty string for zero or negative rate", () => {
        expect(formatRate(0)).toBe("");
        expect(formatRate(-10)).toBe("");
        expect(formatRate(NaN)).toBe("");
    });

    it("appends /s to formatted bytes", () => {
        expect(formatRate(1_400_000)).toBe("1.3 MB/s");
    });
});

describe("formatElapsed", () => {
    it("returns 00:00 for non-finite or negative input", () => {
        expect(formatElapsed(NaN)).toBe("00:00");
        expect(formatElapsed(-1)).toBe("00:00");
    });

    it("formats mm:ss under an hour", () => {
        expect(formatElapsed(0)).toBe("00:00");
        expect(formatElapsed(5_000)).toBe("00:05");
        expect(formatElapsed(65_000)).toBe("01:05");
        expect(formatElapsed(59 * 60 * 1000 + 59_000)).toBe("59:59");
    });

    it("formats h:mm:ss over an hour", () => {
        expect(formatElapsed(3600_000)).toBe("1:00:00");
        expect(formatElapsed(3725_000)).toBe("1:02:05");
    });
});

describe("relativeTimeFromIso", () => {
    it("returns empty string for empty input", () => {
        expect(relativeTimeFromIso("")).toBe("");
    });

    it("returns the raw string when parsing fails", () => {
        expect(relativeTimeFromIso("not a date")).toBe("not a date");
    });

    it("parses an ISO timestamp into a relative-time string", () => {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        expect(relativeTimeFromIso(fiveMinAgo)).toBe("5m ago");
    });
});

describe("percentFromSse", () => {
    it("returns percent field when present", () => {
        expect(percentFromSse({ percent: 42 })).toBe(42);
    });

    it("derives from current/total when percent is missing", () => {
        expect(percentFromSse({ current: 50, total: 100 })).toBe(50);
    });

    it("prefers percent over current/total", () => {
        expect(percentFromSse({ percent: 10, current: 500, total: 1000 })).toBe(10);
    });

    it("returns undefined when total is zero", () => {
        expect(percentFromSse({ current: 5, total: 0 })).toBeUndefined();
    });

    it("returns undefined when current is missing", () => {
        expect(percentFromSse({ total: 100 })).toBeUndefined();
    });

    it("returns undefined when nothing is usable", () => {
        expect(percentFromSse({})).toBeUndefined();
    });
});

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

describe("extractSseErrorMessage", () => {
    it("returns a bare-string payload verbatim", () => {
        expect(extractSseErrorMessage("boom", "fallback")).toBe("boom");
    });

    it("returns the message field from an object payload", () => {
        expect(extractSseErrorMessage({ message: "from object" }, "fallback")).toBe("from object");
    });

    it("falls back when the message field is not a string", () => {
        expect(extractSseErrorMessage({ message: 42 }, "fallback")).toBe("fallback");
    });

    it("falls back for a payload with no message field", () => {
        expect(extractSseErrorMessage({ other: "x" }, "fallback")).toBe("fallback");
    });
});

describe("isStreamInterruptedError", () => {
    it("matches Chromium's mid-read stream TypeError", () => {
        expect(isStreamInterruptedError(new TypeError("network error"))).toBe(true);
    });

    it("ignores other TypeErrors and non-TypeErrors", () => {
        expect(isStreamInterruptedError(new TypeError("Failed to fetch"))).toBe(false);
        expect(isStreamInterruptedError(new Error("network error"))).toBe(false);
        expect(isStreamInterruptedError("network error")).toBe(false);
    });
});

describe("streamInterruptedMessage", () => {
    it("points managed mode at the data-directory logs", () => {
        expect(streamInterruptedMessage(SERVER_MODE.MANAGED)).toBe(MESSAGES.ERROR_STREAM_INTERRUPTED_MANAGED);
    });

    it("points external mode at the lilbee serve output", () => {
        expect(streamInterruptedMessage(SERVER_MODE.EXTERNAL)).toBe(MESSAGES.ERROR_STREAM_INTERRUPTED_EXTERNAL);
    });
});

describe("errorMessage", () => {
    it("returns the Error.message for generic errors", () => {
        expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
    });

    it("falls back to the provided string for non-Error values", () => {
        expect(errorMessage("raw-string", "fallback")).toBe("fallback");
        expect(errorMessage(null, "fallback")).toBe("fallback");
    });

    it("returns an actionable, user-facing message for SessionTokenError", () => {
        const out = errorMessage(new SessionTokenError(401, "stale"), "fallback");
        expect(out).toBe(MESSAGES.NOTICE_SESSION_TOKEN_INVALID);
    });

    it("falls back for undefined", () => {
        expect(errorMessage(undefined, "fallback")).toBe("fallback");
    });

    it("uses ERROR_NAME.SESSION_TOKEN constant for the thrown error name", () => {
        const e = new SessionTokenError(403, "bad");
        expect(e.name).toBe(ERROR_NAME.SESSION_TOKEN);
    });

    it("returns the managed-mode message when serverMode=managed", () => {
        const out = errorMessage(new SessionTokenError(401, "stale"), "fallback", SERVER_MODE.MANAGED);
        expect(out).toBe(MESSAGES.NOTICE_SESSION_TOKEN_INVALID_MANAGED);
    });

    it("returns the external-mode message when serverMode=external", () => {
        const out = errorMessage(new SessionTokenError(401, "stale"), "fallback", SERVER_MODE.EXTERNAL);
        expect(out).toBe(MESSAGES.NOTICE_SESSION_TOKEN_INVALID);
    });
});

describe("sessionTokenInvalidMessage", () => {
    it("picks the managed variant for SERVER_MODE.MANAGED", () => {
        expect(sessionTokenInvalidMessage(SERVER_MODE.MANAGED)).toBe(MESSAGES.NOTICE_SESSION_TOKEN_INVALID_MANAGED);
    });

    it("picks the external variant for SERVER_MODE.EXTERNAL", () => {
        expect(sessionTokenInvalidMessage(SERVER_MODE.EXTERNAL)).toBe(MESSAGES.NOTICE_SESSION_TOKEN_INVALID);
    });
});

describe("noticeForResultError with serverMode", () => {
    it("returns the managed-mode token message for SessionTokenError under managed mode", () => {
        const out = noticeForResultError(new SessionTokenError(401, "stale"), "fallback", SERVER_MODE.MANAGED);
        expect(out).toBe(MESSAGES.NOTICE_SESSION_TOKEN_INVALID_MANAGED);
    });
});

describe("noticeForResultError", () => {
    it("returns the dedicated session-token notice for SessionTokenError", () => {
        const err = new SessionTokenError(401, "stale");
        expect(noticeForResultError(err, "generic fallback")).toBe(MESSAGES.NOTICE_SESSION_TOKEN_INVALID);
    });

    it("returns the operation-specific fallback for other errors", () => {
        expect(noticeForResultError(new Error("boom"), "generic fallback")).toBe("generic fallback");
    });

    it("returns the fallback for non-Error values", () => {
        expect(noticeForResultError("raw", "generic fallback")).toBe("generic fallback");
        expect(noticeForResultError(null, "generic fallback")).toBe("generic fallback");
        expect(noticeForResultError(undefined, "generic fallback")).toBe("generic fallback");
    });
});

describe("extractServerErrorDetail", () => {
    it("returns the detail string from a JSON-body server error", () => {
        const msg =
            'Server responded 422: {"detail": "Model \'lightonocr:2-1b\' is a vision model, not chat. Set it via PUT /api/models/vision instead."}';
        expect(extractServerErrorDetail(msg)).toBe(
            "Model 'lightonocr:2-1b' is a vision model, not chat. Set it via PUT /api/models/vision instead.",
        );
    });

    it("returns null when the body is not valid JSON", () => {
        expect(extractServerErrorDetail("Server responded 422: not-json")).toBeNull();
    });

    it("returns null when the message has no colon separator", () => {
        expect(extractServerErrorDetail("bare error without colon")).toBeNull();
    });

    it("returns null when the body is empty", () => {
        expect(extractServerErrorDetail("Server responded 422: ")).toBeNull();
    });

    it("returns null when the JSON body has no detail field", () => {
        expect(extractServerErrorDetail('Server responded 422: {"other": "value"}')).toBeNull();
    });

    it("returns null when detail is not a string", () => {
        expect(extractServerErrorDetail('Server responded 422: {"detail": 42}')).toBeNull();
    });
});

describe("isRoleMismatchDetail", () => {
    it("recognizes the server's role-mismatch remedy phrase", () => {
        expect(
            isRoleMismatchDetail("Model 'foo' is a vision model, not chat. Set it via PUT /api/models/vision instead."),
        ).toBe(true);
    });

    it("returns false for an auth-shaped detail without the remedy phrase", () => {
        expect(isRoleMismatchDetail("Missing LiteLLM API key for this provider.")).toBe(false);
    });

    it("returns false when the endpoint is mentioned outside the role-mismatch remedy phrase", () => {
        // A future 422 that mentions the endpoint for non-role reasons (e.g. a docs link,
        // a generic "see PUT /api/models/ for options") must NOT be misclassified as a
        // role-mismatch. The sentinel is the `Set it via PUT /api/models/` prefix.
        expect(isRoleMismatchDetail("Auth failed — see PUT /api/models/ docs for the right endpoint.")).toBe(false);
    });
});

describe("extractSseErrorCode", () => {
    it("returns the string code from a structured error payload", () => {
        expect(extractSseErrorCode({ message: "down", code: "connection" })).toBe("connection");
    });

    it("returns null when the payload has no code", () => {
        expect(extractSseErrorCode({ message: "down" })).toBeNull();
    });

    it("returns null when code is not a string", () => {
        expect(extractSseErrorCode({ message: "down", code: 503 })).toBeNull();
    });

    it("returns null for a bare-string payload", () => {
        expect(extractSseErrorCode("something went wrong")).toBeNull();
    });

    it("returns null for a non-object payload", () => {
        expect(extractSseErrorCode(null)).toBeNull();
    });
});

describe("isModelUnavailableError", () => {
    it.each(["connection", "server", "not_found"])("treats the %s code as model-unavailable", (code) => {
        expect(isModelUnavailableError(code, "")).toBe(true);
    });

    it("treats the litellm-missing message as model-unavailable even without a code", () => {
        expect(isModelUnavailableError(null, "Remote and API models need the lilbee[litellm] extra.")).toBe(true);
    });

    it("does not route auth errors to setup (API key is a settings problem)", () => {
        expect(isModelUnavailableError("auth", "missing key")).toBe(false);
    });

    it("returns false for an unrelated error with no marker", () => {
        expect(isModelUnavailableError(null, "the model produced no output")).toBe(false);
    });
});

describe("getRelevantSystemMemoryGB()", () => {
    it("returns the local system RAM in managed mode", () => {
        const result = getRelevantSystemMemoryGB(SERVER_MODE.MANAGED);
        expect(typeof result).toBe("number");
        expect(result).toBeGreaterThan(0);
    });

    it("returns null in external mode (the server's RAM is on a remote host)", () => {
        expect(getRelevantSystemMemoryGB(SERVER_MODE.EXTERNAL)).toBeNull();
    });
});

describe("noticeServerUnreachableIfApplicable()", () => {
    beforeEach(() => {
        Notice.clear();
        _resetServerUnreachableDebounce();
    });

    it("returns true and emits one notice for ECONNREFUSED", () => {
        const handled = noticeServerUnreachableIfApplicable(new Error("connect ECONNREFUSED 127.0.0.1"));
        expect(handled).toBe(true);
        expect(Notice.instances).toHaveLength(1);
        expect(Notice.instances[0].message).toContain("server unreachable");
    });

    it("returns true and emits one notice for 'Failed to fetch'", () => {
        const handled = noticeServerUnreachableIfApplicable(new TypeError("Failed to fetch"));
        expect(handled).toBe(true);
        expect(Notice.instances).toHaveLength(1);
    });

    it("treats ServerStartingError as handled but emits no notice", () => {
        const handled = noticeServerUnreachableIfApplicable(new ServerStartingError());
        expect(handled).toBe(true);
        expect(Notice.instances).toHaveLength(0);
    });

    it("returns false for unrelated errors", () => {
        const handled = noticeServerUnreachableIfApplicable(new Error("Server responded 500"));
        expect(handled).toBe(false);
        expect(Notice.instances).toHaveLength(0);
    });

    it("returns false for non-Error values", () => {
        expect(noticeServerUnreachableIfApplicable("oops")).toBe(false);
        expect(noticeServerUnreachableIfApplicable(null)).toBe(false);
    });

    it("debounces follow-up notices within the window", () => {
        noticeServerUnreachableIfApplicable(new Error("ECONNREFUSED"));
        noticeServerUnreachableIfApplicable(new Error("ECONNREFUSED"));
        noticeServerUnreachableIfApplicable(new Error("ECONNREFUSED"));
        expect(Notice.instances).toHaveLength(1);
    });

    it("re-emits after the debounce window expires", () => {
        const realDateNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            noticeServerUnreachableIfApplicable(new Error("ECONNREFUSED"));
            now += 6_000;
            noticeServerUnreachableIfApplicable(new Error("ECONNREFUSED"));
        } finally {
            Date.now = realDateNow;
        }
        expect(Notice.instances).toHaveLength(2);
    });
});

describe("percentOfBytes", () => {
    it("rounds to a whole percent", () => {
        expect(percentOfBytes(1, 3)).toBe(33);
        expect(percentOfBytes(2, 4)).toBe(50);
    });

    it("has no answer without a total", () => {
        expect(percentOfBytes(10, null)).toBeUndefined();
        expect(percentOfBytes(10, 0)).toBeUndefined();
    });

    it("never exceeds 100 when the server undercounts the length", () => {
        expect(percentOfBytes(120, 100)).toBe(100);
    });
});

describe("setDeterminateProgress", () => {
    it("drops the indeterminate animation and sets the width", () => {
        const fill = new MockElement() as unknown as HTMLElement;
        fill.classList.add("lilbee-wizard-progress-indeterminate");

        setDeterminateProgress(fill, 42);

        expect(fill.classList.contains("lilbee-wizard-progress-indeterminate")).toBe(false);
        expect(fill.style.width).toBe("42%");
    });
});
