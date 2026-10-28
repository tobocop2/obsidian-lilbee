import { describe, it, expect } from "vitest";
import configSchema from "../fixtures/config-schema.json";
import {
    CURATED_CONFIG_KEYS,
    genericFields,
    HTTP_REFUSED_KEYS,
    MANAGED_ELSEWHERE_KEYS,
} from "../../src/utils/config-fields";
import type { ConfigFieldSchema } from "../../src/types";

function field(key: string, type: string, extra: Partial<ConfigFieldSchema> = {}): ConfigFieldSchema {
    return {
        key,
        type,
        nullable: type.endsWith("|null"),
        writable: true,
        reindex_required: false,
        group: "Retrieval",
        help: "",
        choices: null,
        ...extra,
    };
}

describe("genericFields", () => {
    it.each([
        ["bool", "toggle"],
        ["bool|null", "toggle"],
        ["int", "number"],
        ["float|null", "number"],
        ["list", "list"],
        ["dict", "json"],
        ["str", "text"],
        ["str|null", "text"],
        ["something-new", "text"],
    ])("reads the type %s as a %s control", (type, kind) => {
        expect(genericFields([field("zz_setting", type)])[0].kind).toBe(kind);
    });

    it("uses a picker whenever the server lists choices", () => {
        const [row] = genericFields([field("zz_mode", "int", { choices: ["1", "2"] })]);
        expect(row.kind).toBe("choice");
        expect(row.numeric).toBe(true);
        expect(row.choices).toEqual(["1", "2"]);
        expect(genericFields([field("zz_open", "str")])[0].choices).toEqual([]);
    });

    it("records integer, numeric, nullable and re-index flags", () => {
        const [a] = genericFields([field("zz_a", "int|null", { reindex_required: true })]);
        expect(a).toMatchObject({ integer: true, numeric: true, nullable: true, reindexRequired: true });
        const [b] = genericFields([field("zz_b", "float")]);
        expect(b).toMatchObject({ integer: false, numeric: true, nullable: false });
        const [c] = genericFields([field("zz_c", "str", { nullable: true })]);
        expect(c.nullable).toBe(true);
    });

    it("drops read-only, curated and refused settings", () => {
        const kept = genericFields([
            field("zz_keep", "int"),
            field("zz_readonly", "int", { writable: false }),
            field("chunk_size", "int"),
            field("llm_provider", "str"),
        ]);
        expect(kept.map((f) => f.key)).toEqual(["zz_keep"]);
        expect(CURATED_CONFIG_KEYS.has("chunk_size")).toBe(true);
        expect(HTTP_REFUSED_KEYS.has("llm_provider")).toBe(true);
    });

    it("sorts by group, then key", () => {
        const keys = genericFields([
            field("zz_b", "int", { group: "B" }),
            field("zz_z", "int", { group: "A" }),
            field("zz_a", "int", { group: "B" }),
        ]).map((f) => f.key);
        expect(keys).toEqual(["zz_z", "zz_a", "zz_b"]);
    });

    it("keeps token-named settings, since the server omits write-only secrets itself", () => {
        const [row] = genericFields([field("zz_max_tokens", "int")]);
        expect(row.key).toBe("zz_max_tokens");
        expect(row.kind).toBe("number");
    });

    it("leaves out the settings the plugin manages through its own flows", () => {
        for (const key of ["documents_dir", "vault_base", "linked_roots", "placement", "num_ctx"]) {
            expect(MANAGED_ELSEWHERE_KEYS.has(key)).toBe(true);
            expect(genericFields([field(key, "str")])).toEqual([]);
        }
    });

    it("lists every writable setting in the recorded server schema that has no curated row", () => {
        const writable = configSchema.fields.filter((f) => f.writable);
        const rows = genericFields(configSchema.fields as ConfigFieldSchema[]);
        const expected = writable.filter(
            (f) =>
                !CURATED_CONFIG_KEYS.has(f.key) && !HTTP_REFUSED_KEYS.has(f.key) && !MANAGED_ELSEWHERE_KEYS.has(f.key),
        );
        expect(rows).toHaveLength(expected.length);
        expect(rows.length).toBeGreaterThan(60);
        expect(rows.map((r) => r.key)).not.toContain("llm_provider");
        expect(rows.map((r) => r.key)).not.toContain("chunk_size");
    });
});
