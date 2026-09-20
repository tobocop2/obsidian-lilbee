import { describe, it, expect } from "vitest";
import { modelShowRows } from "../../src/utils/model-show-rows";
import { MESSAGES } from "../../src/locales/en";

describe("modelShowRows", () => {
    it("returns no rows when the server answers with nothing", () => {
        expect(modelShowRows({})).toEqual([]);
    });

    it("gives the multi-line blobs and the raw file-type code no rows", () => {
        expect(modelShowRows({ chat_template: "{{ prompt }}", parameters: "num_ctx 4096", file_type: "15" })).toEqual(
            [],
        );
    });

    it("labels the embedding length", () => {
        expect(modelShowRows({ embedding_length: "1024" })).toEqual([
            { label: MESSAGES.LABEL_STATUS_EMBEDDING_LENGTH, value: "1024" },
        ]);
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

    it("orders the rows the same whatever order the server answers in", () => {
        const rows = modelShowRows({
            embedding_length: "1024",
            context_length: "32768",
            architecture: "qwen3",
        });
        expect(rows.map((r) => r.label)).toEqual([
            MESSAGES.LABEL_STATUS_ARCHITECTURE,
            MESSAGES.LABEL_STATUS_CONTEXT_LENGTH,
            MESSAGES.LABEL_STATUS_EMBEDDING_LENGTH,
        ]);
    });
});
