import { describe, expect, it } from "vitest";
import { cleanDisplayName, displayLabelForRef, extractHfRepo } from "../../src/utils/model-ref";

describe("displayLabelForRef", () => {
    it("returns empty string for empty input", () => {
        expect(displayLabelForRef("")).toBe("");
    });

    it("cleans a full native HF ref", () => {
        expect(displayLabelForRef("Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf")).toBe("Qwen3 0.6B");
    });

    it("cleans a Meta-prefixed Llama ref", () => {
        expect(
            displayLabelForRef("meta-llama/Meta-Llama-3-8B-Instruct-GGUF/Meta-Llama-3-8B-Instruct.Q4_K_M.gguf"),
        ).toBe("Llama 3 8B");
    });

    it("cleans a Mistral ref with vendor versioning", () => {
        expect(displayLabelForRef("bartowski/Mistral-7B-Instruct-v0.3-GGUF/Mistral-7B-Instruct-v0.3.Q4_K_M.gguf")).toBe(
            "Mistral 7B",
        );
    });

    it("returns the segment after ollama/", () => {
        expect(displayLabelForRef("ollama/qwen3:8b")).toBe("qwen3:8b");
    });

    it("returns the segment after openai/", () => {
        expect(displayLabelForRef("openai/gpt-4o")).toBe("gpt-4o");
    });

    it("returns the segment after anthropic/", () => {
        expect(displayLabelForRef("anthropic/claude-opus-4-7")).toBe("claude-opus-4-7");
    });

    it("returns the segment after gemini/", () => {
        expect(displayLabelForRef("gemini/gemini-2.5-flash")).toBe("gemini-2.5-flash");
    });

    it("returns the segment after cohere/", () => {
        expect(displayLabelForRef("cohere/rerank-english-v3.0")).toBe("rerank-english-v3.0");
    });

    it("passes through unrecognised refs unchanged", () => {
        expect(displayLabelForRef("weird-thing")).toBe("weird-thing");
    });

    it("cleans a bare HF repo (set-then-fetchActiveModel transient state)", () => {
        expect(displayLabelForRef("Qwen/Qwen3-0.6B-GGUF")).toBe("Qwen3 0.6B");
    });

    it("cleans a Meta-prefixed bare repo", () => {
        expect(displayLabelForRef("meta-llama/Meta-Llama-3-8B-Instruct-GGUF")).toBe("Llama 3 8B");
    });
});

describe("extractHfRepo", () => {
    it("strips the trailing /<filename>.gguf segment", () => {
        expect(extractHfRepo("Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q4_K_M.gguf")).toBe("Qwen/Qwen3-0.6B-GGUF");
    });

    it("returns provider refs unchanged", () => {
        expect(extractHfRepo("ollama/qwen3:8b")).toBe("ollama/qwen3:8b");
    });

    it("returns bare repos unchanged", () => {
        expect(extractHfRepo("Qwen/Qwen3-0.6B-GGUF")).toBe("Qwen/Qwen3-0.6B-GGUF");
    });

    it("returns empty string unchanged", () => {
        expect(extractHfRepo("")).toBe("");
    });

    it("returns a .gguf ref with no slash unchanged", () => {
        expect(extractHfRepo("loose.gguf")).toBe("loose.gguf");
    });
});

describe("cleanDisplayName", () => {
    it("handles bare repo names", () => {
        expect(cleanDisplayName("Qwen3-0.6B-GGUF")).toBe("Qwen3 0.6B");
    });

    it("strips org prefix when present", () => {
        expect(cleanDisplayName("Qwen/Qwen3-8B-GGUF")).toBe("Qwen3 8B");
    });

    it("drops Meta- prefix", () => {
        expect(cleanDisplayName("meta-llama/Meta-Llama-3-8B-Instruct-GGUF")).toBe("Llama 3 8B");
    });

    it("drops version and date suffixes iteratively", () => {
        expect(cleanDisplayName("bartowski/Mistral-7B-Instruct-v0.3-GGUF")).toBe("Mistral 7B");
        expect(cleanDisplayName("Qwen/Qwen2.5-7B-Instruct-GGUF")).toBe("Qwen2.5 7B");
        expect(cleanDisplayName("Qwen/Qwen3-Coder-30B-A3B-Instruct-GGUF")).toBe("Qwen3 Coder 30B A3B");
        expect(cleanDisplayName("anthropic/foo-2507")).toBe("foo");
    });

    it("collapses multiple internal spaces", () => {
        expect(cleanDisplayName("foo--bar---baz")).toBe("foo bar baz");
    });
});
