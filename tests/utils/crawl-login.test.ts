import { describe, it, expect } from "vitest";
import { buildCrawlLogin } from "../../src/utils/crawl-login";
import { MESSAGES } from "../../src/locales/en";

const EMPTY = { authorization: "", username: "", password: "", cookie: "" };

describe("buildCrawlLogin", () => {
    it("returns no login when every field is empty", () => {
        expect(buildCrawlLogin(EMPTY)).toEqual({ login: null, error: null });
        expect(buildCrawlLogin({ ...EMPTY, authorization: "   ", cookie: " " })).toEqual({ login: null, error: null });
    });

    it("sends an authorization header trimmed", () => {
        const result = buildCrawlLogin({ ...EMPTY, authorization: " Bearer abc " });
        expect(result.login).toEqual({ ...EMPTY, authorization: "Bearer abc" });
        expect(result.error).toBeNull();
    });

    it("sends a username with a password exactly as typed", () => {
        const result = buildCrawlLogin({ ...EMPTY, username: "ann", password: " p w " });
        expect(result.login).toEqual({ ...EMPTY, username: "ann", password: " p w " });
    });

    it("sends a username alone and a cookie alone", () => {
        expect(buildCrawlLogin({ ...EMPTY, username: "ann" }).login?.username).toBe("ann");
        expect(buildCrawlLogin({ ...EMPTY, cookie: " sid=1 " }).login?.cookie).toBe("sid=1");
    });

    it("allows a cookie with a username and password", () => {
        const result = buildCrawlLogin({ ...EMPTY, username: "ann", password: "x", cookie: "sid=1" });
        expect(result.error).toBeNull();
        expect(result.login).not.toBeNull();
    });

    it("refuses a password without a username", () => {
        const result = buildCrawlLogin({ ...EMPTY, password: "secret-pw" });
        expect(result).toEqual({ login: null, error: MESSAGES.ERROR_CRAWL_LOGIN_PASSWORD_NEEDS_USERNAME });
    });

    it("refuses an authorization header together with a username", () => {
        const result = buildCrawlLogin({ ...EMPTY, authorization: "Bearer t", username: "ann" });
        expect(result.error).toBe(MESSAGES.ERROR_CRAWL_LOGIN_AUTHORIZATION_AND_USERNAME);
    });

    it.each([
        ["authorization", MESSAGES.LABEL_CRAWL_LOGIN_AUTHORIZATION],
        ["username", MESSAGES.LABEL_CRAWL_LOGIN_USERNAME],
        ["password", MESSAGES.LABEL_CRAWL_LOGIN_PASSWORD],
        ["cookie", MESSAGES.LABEL_CRAWL_LOGIN_COOKIE],
    ] as const)("names the %s field and not its value for a control character", (field, label) => {
        const result = buildCrawlLogin({ ...EMPTY, username: "u", [field]: "top\nsecret" });
        expect(result.login).toBeNull();
        expect(result.error).toBe(MESSAGES.ERROR_CRAWL_LOGIN_CONTROL_CHARACTER(label));
        expect(result.error).not.toContain("secret");
    });

    it("refuses a DEL character", () => {
        expect(buildCrawlLogin({ ...EMPTY, username: "a\u007f" }).error).toBe(
            MESSAGES.ERROR_CRAWL_LOGIN_CONTROL_CHARACTER(MESSAGES.LABEL_CRAWL_LOGIN_USERNAME),
        );
    });

    it.each([
        ["authorization", MESSAGES.LABEL_CRAWL_LOGIN_AUTHORIZATION],
        ["cookie", MESSAGES.LABEL_CRAWL_LOGIN_COOKIE],
    ] as const)("names the %s field and not its value for a non-ASCII character", (field, label) => {
        const result = buildCrawlLogin({ ...EMPTY, [field]: "tökensecret" });
        expect(result.login).toBeNull();
        expect(result.error).toBe(MESSAGES.ERROR_CRAWL_LOGIN_NOT_ASCII(label));
        expect(result.error).not.toContain("secret");
    });

    it("accepts non-ASCII in the username and password", () => {
        const result = buildCrawlLogin({ ...EMPTY, username: "zoë", password: "pässwörd" });
        expect(result.error).toBeNull();
    });
});
