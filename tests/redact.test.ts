import { describe, expect, it } from "vitest";
import { redactSecrets, redactSettings } from "../src/redact";
import { DEFAULT_SETTINGS, DEFAULT_SHARED_CONFIG } from "../src/types";

describe("redactSecrets", () => {
    it.each([
        ['token = "abc123"', 'token = "[redacted]"'],
        ['api_key = "sk-foo.bar"', 'api_key = "[redacted]"'],
        ["apiKey: deadbeef", "apiKey: [redacted]"],
        ["Authorization: Bearer abc.def", "Authorization: [redacted]"],
        ["hf_token=hf_abcDEF123", "hf_token=[redacted]"],
        ["secret: 's3cr3t'", "secret: '[redacted]'"],
    ])("redacts %s", (input, expected) => {
        expect(redactSecrets(input)).toBe(expected);
    });

    it("keeps non-secret lines untouched", () => {
        const line = 'data_dir = "/Users/alice/notes"';
        expect(redactSecrets(line)).toBe(line);
    });

    it("redacts every occurrence in multi-line text", () => {
        const text = 'a_token = "one"\npath = "/x"\napi_key = "two"';
        const out = redactSecrets(text);
        expect(out).not.toContain("one");
        expect(out).not.toContain("two");
        expect(out).toContain('path = "/x"');
    });
});

describe("redactSettings", () => {
    it("blanks secret fields and keeps the rest", () => {
        const settings = {
            ...DEFAULT_SETTINGS,
            manualToken: "tok123",
            hfToken: "hf_x",
            serverUrl: "http://127.0.0.1:7433",
        };
        const out = redactSettings(settings);
        expect(out.manualToken).toBe("[redacted]");
        expect(out.hfToken).toBe("[redacted]");
        expect(out.serverUrl).toBe("http://127.0.0.1:7433");
    });

    it("leaves empty secret fields empty", () => {
        const out = redactSettings({ ...DEFAULT_SETTINGS, ...DEFAULT_SHARED_CONFIG });
        expect(out.manualToken).toBe("");
        expect(out.hfToken).toBe("");
    });

    it("ignores secret fields that are absent", () => {
        const out = redactSettings({ ...DEFAULT_SETTINGS });
        expect(out.hfToken).toBeUndefined();
    });
});
