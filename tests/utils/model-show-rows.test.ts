import { describe, it, expect } from "vitest";
import { modelShowRows } from "../../src/utils/model-show-rows";
import { MESSAGES } from "../../src/locales/en";

describe("modelShowRows", () => {
    it("returns no rows when the server answers with nothing", () => {
        expect(modelShowRows({})).toEqual([]);
    });

    it("returns no rows when the server answers with fields that carry no label", () => {
        expect(modelShowRows({ chat_template: "{{ prompt }}", file_type: "Q4_K_M" })).toEqual([]);
    });

    it("labels the architecture", () => {
        expect(modelShowRows({ architecture: "qwen3" })).toEqual([
            { label: MESSAGES.LABEL_STATUS_ARCHITECTURE, value: "qwen3" },
        ]);
    });

    it("labels the context length", () => {
        expect(modelShowRows({ context_length: "32768" })).toEqual([
            { label: MESSAGES.LABEL_STATUS_CONTEXT_LENGTH, value: "32768" },
        ]);
    });

    it("keeps architecture before context length", () => {
        const rows = modelShowRows({ context_length: "32768", architecture: "qwen3" });
        expect(rows.map((r) => r.label)).toEqual([
            MESSAGES.LABEL_STATUS_ARCHITECTURE,
            MESSAGES.LABEL_STATUS_CONTEXT_LENGTH,
        ]);
    });
});
