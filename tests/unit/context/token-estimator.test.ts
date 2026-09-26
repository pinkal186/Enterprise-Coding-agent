import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  SimpleTokenEstimator,
  defaultTokenEstimator,
} from "../../../src/context/token-estimator.js";
import type { Message } from "../../../src/llm/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Provider isolation (NFR-1 / FR-15)
// ---------------------------------------------------------------------------

describe("Token Estimator — Provider Isolation (NFR-1 / FR-15)", () => {
  it("has zero imports from @google/genai or any other provider SDK", () => {
    const filePath = resolve(__dirname, "../../../src/context/token-estimator.ts");
    const content = readFileSync(filePath, "utf-8");

    expect(content).not.toContain("@google/genai");
    expect(content).not.toContain("google");
    expect(content).not.toContain("openai");
    expect(content).not.toContain("anthropic");
  });
});

// ---------------------------------------------------------------------------
// Deterministic Token Estimation (FR-15)
// ---------------------------------------------------------------------------

describe("Token Estimator — Core Functionality (TASK-17 / FR-15)", () => {
  const estimator = new SimpleTokenEstimator();

  it("handles empty and whitespace strings", () => {
    expect(estimator.estimate("")).toBe(0);
    expect(defaultTokenEstimator.estimate("")).toBe(0);
    // 4 spaces = 1 token (Math.ceil(4 / 4))
    expect(estimator.estimate("    ")).toBe(1);
  });

  it("accurately estimates short text", () => {
    // 1 char -> 1 token
    expect(estimator.estimate("a")).toBe(1);
    // 4 chars -> 1 token
    expect(estimator.estimate("test")).toBe(1);
    // 5 chars -> 2 tokens
    expect(estimator.estimate("hello")).toBe(2);
    // 8 chars -> 2 tokens
    expect(estimator.estimate("12345678")).toBe(2);
    // 9 chars -> 3 tokens
    expect(estimator.estimate("123456789")).toBe(3);
  });

  it("accurately estimates long text", () => {
    const text1000 = "a".repeat(1000);
    expect(estimator.estimate(text1000)).toBe(250);

    const text4000 = "x".repeat(4000);
    expect(estimator.estimate(text4000)).toBe(1000);
  });

  it("produces deterministic output across multiple invocations", () => {
    const sample = "The quick brown fox jumps over the lazy dog. 12345!@#$%^&*()";
    const result1 = estimator.estimate(sample);
    const result2 = estimator.estimate(sample);
    const result3 = defaultTokenEstimator.estimate(sample);

    expect(result1).toBe(result2);
    expect(result1).toBe(result3);
    expect(result1).toBe(Math.ceil(sample.length / 4));
  });

  it("is monotonically increasing as text length increases", () => {
    let prevEstimate = 0;
    let accumulatedText = "";

    for (let i = 0; i <= 100; i++) {
      const currentEstimate = estimator.estimate(accumulatedText);
      expect(currentEstimate).toBeGreaterThanOrEqual(prevEstimate);
      prevEstimate = currentEstimate;
      accumulatedText += "x";
    }

    // Verify strict increase across 4-character boundaries
    expect(estimator.estimate("a")).toBeLessThan(estimator.estimate("aaaaa"));
    expect(estimator.estimate("12345678")).toBeLessThan(estimator.estimate("123456789012"));
  });

  it("validates constructor parameters", () => {
    expect(() => new SimpleTokenEstimator(0)).toThrow("charsPerToken must be positive");
    expect(() => new SimpleTokenEstimator(-1)).toThrow("charsPerToken must be positive");
  });
});

// ---------------------------------------------------------------------------
// Message and Tool Estimation
// ---------------------------------------------------------------------------

describe("Token Estimator — Message & Tool Estimation", () => {
  const estimator = defaultTokenEstimator;

  it("estimates simple user messages with framing overhead", () => {
    const message: Message = {
      role: "user",
      content: "Hello world!", // 12 chars -> 3 tokens + 3 framing = 6
    };

    expect(estimator.estimateMessage(message)).toBe(6);
  });

  it("accounts for tool call structure in assistant messages", () => {
    const plainMessage: Message = {
      role: "assistant",
      content: "",
    };

    const toolCallMessage: Message = {
      role: "assistant",
      content: "",
      toolCall: {
        id: "call-1",
        toolName: "read_file",
        arguments: { path: "src/index.ts" },
      },
    };

    const plainTokens = estimator.estimateMessage(plainMessage);
    const toolCallTokens = estimator.estimateMessage(toolCallMessage);

    expect(toolCallTokens).toBeGreaterThan(plainTokens);
  });

  it("accounts for tool result structure in tool messages", () => {
    const toolResultMessage: Message = {
      role: "tool",
      content: "file content here",
      toolResult: {
        toolCallId: "call-1",
        success: true,
        output: "file content here",
      },
    };

    expect(estimator.estimateMessage(toolResultMessage)).toBeGreaterThan(3);
  });
});
