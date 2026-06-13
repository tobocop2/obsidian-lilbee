import { describe, expect, it } from "vitest";
import {
    cleanDisplayName,
    displayLabelForRef,
    extractHfRepo,
    matchModelOption,
    nativeModelRef,
} from "../../src/utils/model-ref";

describe("nativeModelRef", () => {
    it("builds the full file ref when a concrete .gguf filename is present", () => {
        expect(nativeModelRef("bartowski/SmolLM2-360M-Instruct-GGUF", "SmolLM2-360M-Instruct-Q4_K_M.gguf")).toBe(
            "bartowski/SmolLM2-360M-Instruct-GGUF/SmolLM2-360M-Instruct-Q4_K_M.gguf",
        );
    });

    it("falls back to the bare repo for a glob filename", () => {
        expect(nativeModelRef("Qwen/Qwen3-8B-GGUF", "*Q4_K_M.gguf")).toBe("Qwen/Qwen3-8B-GGUF");
    });

    it("falls back to the bare repo when the filename is missing", () => {
        expect(nativeModelRef("Qwen/Qwen3-8B-GGUF", "")).toBe("Qwen/Qwen3-8B-GGUF");
        expect(nativeModelRef("Qwen/Qwen3-8B-GGUF", null)).toBe("Qwen/Qwen3-8B-GGUF");
        expect(nativeModelRef("Qwen/Qwen3-8B-GGUF", undefined)).toBe("Qwen/Qwen3-8B-GGUF");
    });
});

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

    it("returns the segment after lm_studio/", () => {
        expect(displayLabelForRef("lm_studio/qwen2.5-7b-instruct")).toBe("qwen2.5-7b-instruct");
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

describe("matchModelOption", () => {
    it("matches a full native ref to its bare-repo option key", () => {
        const options = ["Qwen/Qwen3-0.6B-GGUF", "gemini/gemini-2.5-flash"];
        expect(matchModelOption("Qwen/Qwen3-0.6B-GGUF/Qwen3-0.6B-Q8_0.gguf", options)).toBe("Qwen/Qwen3-0.6B-GGUF");
    });

    it("prefers an exact option match over the bare repo (other-installed full refs)", () => {
        const ref = "user/custom-GGUF/custom-Q4_K_M.gguf";
        const options = ["user/custom-GGUF", ref];
        expect(matchModelOption(ref, options)).toBe(ref);
    });

    it("returns hosted/provider refs unchanged when present", () => {
        const options = ["gemini/gemini-2.5-flash", "Qwen/Qwen3-0.6B-GGUF"];
        expect(matchModelOption("gemini/gemini-2.5-flash", options)).toBe("gemini/gemini-2.5-flash");
    });

    it("matches the empty disabled-sentinel option", () => {
        expect(matchModelOption("", ["", "Qwen/Qwen3-0.6B-GGUF"])).toBe("");
    });

    it("falls back to the active ref when nothing matches", () => {
        expect(matchModelOption("ollama/llama3", ["gemini/gemini-2.5-flash"])).toBe("ollama/llama3");
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
