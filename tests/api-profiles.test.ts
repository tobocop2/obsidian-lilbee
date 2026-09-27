/**
 * The profile client methods, replayed against bodies the real server answered with.
 * `tests/fixtures/profile-responses.json` comes from `scripts/dump-profile-responses.py`.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { LilbeeClient, isHttpStatus } from "../src/api";
import { HTTP_STATUS, PROFILE_FOLDER } from "../src/types";
import { profileErrorText } from "../src/profiles";
import { served } from "./profile-fixtures";

const BASE_URL = "http://localhost:7433";

let fetchMock: ReturnType<typeof vi.fn>;
let client: LilbeeClient;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new LilbeeClient(BASE_URL);
});

/** The one request the client made: its URL, method and parsed body. */
function sent(): { url: string; method: string; body: unknown } {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return {
        url,
        method: init.method ?? "GET",
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
}

describe("profile client methods", () => {
    it("listProfiles reads every profile with its folder, credit and shadowed state", async () => {
        fetchMock.mockResolvedValue(served("list"));
        const list = await client.listProfiles();
        expect(sent()).toEqual({ url: `${BASE_URL}/api/profiles`, method: "GET", body: undefined });
        const shadowed = list!.profiles.find((p) => p.shadowed_by !== null)!;
        expect(shadowed).toMatchObject({ name: "Court filings", folder: "global", shadowed_by: "project" });
        expect(list!.profiles.find((p) => !p.valid)?.error).toBe("Profiles cannot set chat_model");
        expect(list!.profiles[0].credit).toBe("by Jane Doe (@janedoe)");
    });

    it("listProfiles answers null against a server without profiles", async () => {
        fetchMock.mockResolvedValue(served("error_no_route"));
        await expect(client.listProfiles()).resolves.toBeNull();
    });

    it("activeProfile reads the applied profile and its entry", async () => {
        fetchMock.mockResolvedValue(served("active_default"));
        const active = await client.activeProfile();
        expect(sent().url).toBe(`${BASE_URL}/api/profiles/active`);
        expect(active).toMatchObject({ name: "Default", status: "current" });
        expect(active.profile?.folder).toBe("builtin");
    });

    it("getProfile escapes the name into one path segment", async () => {
        fetchMock.mockResolvedValue(served("show"));
        const entry = await client.getProfile("Court filings");
        expect(sent().url).toBe(`${BASE_URL}/api/profiles/Court%20filings`);
        expect(entry.tested_on).toBe("4,000 scanned county court filings, 1990-2010");
    });

    it("profileDiff reads the changes, their effect, and the kept values", async () => {
        fetchMock.mockResolvedValue(served("diff"));
        const diff = await client.profileDiff("Notes and markdown");
        expect(sent().url).toBe(`${BASE_URL}/api/profiles/Notes%20and%20markdown/diff`);
        expect(diff.kept).toEqual(["chunk_size"]);
        expect(diff.changes.map((row) => [row.key, row.effect])).toEqual([
            ["chunk_overlap", "reindex"],
            ["enable_ocr", "new_files_only"],
        ]);
    });

    it("applyProfile POSTs to the apply route and reads reindex_required", async () => {
        fetchMock.mockResolvedValue(served("apply"));
        const result = await client.applyProfile("Notes and markdown");
        expect(sent()).toMatchObject({ url: `${BASE_URL}/api/profiles/Notes%20and%20markdown/apply`, method: "POST" });
        expect(result.reindex_required).toBe(true);
    });

    it("saveProfile POSTs the name and target", async () => {
        fetchMock.mockResolvedValue(served("save_as"));
        const saved = await client.saveProfile("My notes", PROFILE_FOLDER.PROJECT);
        expect(sent()).toEqual({
            url: `${BASE_URL}/api/profiles`,
            method: "POST",
            body: { name: "My notes", target: "project" },
        });
        expect(saved.absorbed).toEqual(["chunk_size"]);
    });

    it("updateProfile PUTs the profile's own route", async () => {
        fetchMock.mockResolvedValue(served("update"));
        const saved = await client.updateProfile("My notes");
        expect(sent()).toMatchObject({ url: `${BASE_URL}/api/profiles/My%20notes`, method: "PUT" });
        expect(saved.folder).toBe("project");
    });

    it("discardProfileChanges POSTs to the discard route", async () => {
        fetchMock.mockResolvedValue(served("discard"));
        const result = await client.discardProfileChanges();
        expect(sent()).toMatchObject({ url: `${BASE_URL}/api/profiles/discard`, method: "POST" });
        expect(result.dropped).toEqual(["chunk_overlap"]);
    });

    it("duplicateProfile POSTs the new name and target", async () => {
        fetchMock.mockResolvedValue(served("duplicate"));
        await client.duplicateProfile("Scanned archive", "Scans", PROFILE_FOLDER.GLOBAL);
        expect(sent()).toEqual({
            url: `${BASE_URL}/api/profiles/Scanned%20archive/duplicate`,
            method: "POST",
            body: { new_name: "Scans", target: "global" },
        });
    });

    it("renameProfile PATCHes the new name", async () => {
        fetchMock.mockResolvedValue(served("rename"));
        const renamed = await client.renameProfile("Scans", "Old scans");
        expect(sent()).toEqual({
            url: `${BASE_URL}/api/profiles/Scans`,
            method: "PATCH",
            body: { new_name: "Old scans" },
        });
        expect(renamed.name).toBe("Old scans");
    });

    it("deleteProfile DELETEs the profile's route", async () => {
        fetchMock.mockResolvedValue(served("delete"));
        await client.deleteProfile("Old scans");
        expect(sent()).toMatchObject({ url: `${BASE_URL}/api/profiles/Old%20scans`, method: "DELETE" });
    });

    it("exportProfile returns the file text and the server's file name", async () => {
        fetchMock.mockResolvedValue(served("export"));
        const exported = await client.exportProfile("Old scans");
        expect(sent().url).toBe(`${BASE_URL}/api/profiles/Old%20scans/export`);
        expect(exported.filename).toBe("old-scans.toml");
        expect(exported.content).toContain('name = "Old scans"');
    });

    it("exportProfile has no file name when the server sends none", async () => {
        fetchMock.mockResolvedValue(new Response("[values]\n", { status: 200 }));
        await expect(client.exportProfile("x")).resolves.toEqual({ filename: null, content: "[values]\n" });
    });

    it("importProfile POSTs the text, file name and target", async () => {
        fetchMock.mockResolvedValue(served("import"));
        await client.importProfile("[values]\n", "old-scans.toml", PROFILE_FOLDER.GLOBAL);
        expect(sent()).toEqual({
            url: `${BASE_URL}/api/profiles/import`,
            method: "POST",
            body: { content: "[values]\n", filename: "old-scans.toml", target: "global" },
        });
    });

    it("validateProfile reads every problem", async () => {
        fetchMock.mockResolvedValue(served("validate_bad"));
        const check = await client.validateProfile("x", "bad.toml", PROFILE_FOLDER.GLOBAL);
        expect(sent().body).toEqual({ content: "x", filename: "bad.toml", folder: "global" });
        expect(check).toEqual({ name: "bad", valid: false, problems: ["Profiles cannot set chat_model"] });
    });
});

describe("profile error shapes", () => {
    it.each([
        ["error_missing", HTTP_STATUS.NOT_FOUND, "No profile named 'No such profile'"],
        ["error_clash", HTTP_STATUS.CONFLICT, "A profile named Old scans already exists"],
        ["error_builtin", 400, "Default ships with lilbee and cannot be changed; duplicate it instead"],
        ["error_reserved", 400, "Reserved name: active cannot name a profile"],
        ["error_too_large", 400, "The file is over 256 KB, too large for a profile file"],
    ] as const)("%s throws with its status and the server's detail", async (label, status, detail) => {
        fetchMock.mockResolvedValue(served(label));
        const error = await client.profileDiff("x").catch((e: unknown) => e as Error);
        expect(isHttpStatus(error as Error, status)).toBe(true);
        expect(profileErrorText(error)).toContain(detail);
    });

    it("a missing profile's 404 is an error, never the older-server null", async () => {
        fetchMock.mockResolvedValue(served("error_missing"));
        await expect(client.getProfile("No such profile")).rejects.toThrow(/404/);
    });
});
