import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  StandardContextBuilder,
  defaultContextBuilder,
} from "../../../src/context/context-builder.js";
import type {
  BuildContextInput,
  ContextBudget,
  ContextItem,
  ContextState,
  ImportantFact,
} from "../../../src/context/types.js";
import { DEFAULT_CONTEXT_BUDGET } from "../../../src/context/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Provider isolation (NFR-1 / FR-20)
// ---------------------------------------------------------------------------

describe("Context Builder — Provider Isolation (NFR-1)", () => {
  it("has zero imports from @google/genai or any other provider SDK", () => {
    const filePath = resolve(__dirname, "../../../src/context/context-builder.ts");
    const content = readFileSync(filePath, "utf-8");

    expect(content).not.toContain("@google/genai");
    expect(content).not.toContain("google");
    expect(content).not.toContain("openai");
    expect(content).not.toContain("anthropic");
  });
});

// ---------------------------------------------------------------------------
// Core Context Builder Specifications (TASK-20 / FR-20)
// ---------------------------------------------------------------------------

describe("Context Builder — Ordering & Construction (TASK-20 / FR-20)", () => {
  const builder = defaultContextBuilder;

  it("orders messages correctly: system -> task -> facts -> recent-tools -> recent-interaction -> older -> summaries", () => {
    const contextState: ContextState = {
      items: [
        {
          id: "summary-1",
          type: "summary",
          content: "Previous turns summarized: files inspected.",
          importance: "high",
          createdAt: 50,
        },
        {
          id: "tool-old",
          type: "tool_result",
          content: "Old search result",
          importance: "normal",
          createdAt: 100,
        },
        {
          id: "tool-recent",
          type: "tool_result",
          content: "Recent read_file output for calculator.ts",
          importance: "high",
          createdAt: 900,
        },
        {
          id: "assistant-recent",
          type: "assistant",
          content: "I will now edit calculator.ts to fix the issue.",
          importance: "normal",
          createdAt: 950,
        },
      ],
      maxContextTokens: 32000,
      reservedOutputTokens: 4096,
      estimatedInputTokens: 0,
      compactionCount: 1,
      truncatedItemCount: 0,
    };

    const importantFacts: ImportantFact[] = [
      {
        id: "fact-1",
        content: "Bug is inside multiply()",
        importance: "critical",
      },
    ];

    const input: BuildContextInput = {
      task: "Fix the bug in calculator.ts",
      contextState,
      tools: [],
      budget: DEFAULT_CONTEXT_BUDGET,
      importantFacts,
    };

    const result = builder.build(input);

    expect(result.messages.length).toBeGreaterThanOrEqual(5);

    // Verify ordering sequence:
    // 0: system instruction
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toContain("expert autonomous software engineering agent");

    // 1: current user task
    expect(result.messages[1].role).toBe("user");
    expect(result.messages[1].content).toBe("Fix the bug in calculator.ts");

    // 2: important fact
    expect(result.messages[2].role).toBe("system");
    expect(result.messages[2].content).toContain("Important Fact: Bug is inside multiply()");

    // Check that recent tool and interaction appear before older items and summaries
    const contents = result.messages.map((m) => m.content);
    const recentToolIdx = contents.findIndex((c) => c.includes("Recent read_file output"));
    const recentAssistantIdx = contents.findIndex((c) =>
      c.includes("I will now edit calculator.ts")
    );
    const olderIdx = contents.findIndex((c) => c.includes("Old search result"));
    const summaryIdx = contents.findIndex((c) => c.includes("Compacted History Summary"));

    expect(recentToolIdx).toBeGreaterThan(2); // after facts
    expect(recentAssistantIdx).toBeGreaterThan(recentToolIdx);
    expect(summaryIdx).toBeGreaterThan(recentAssistantIdx);
  });

  it("enforces context budget and computes utilization accurately", () => {
    const budget: ContextBudget = {
      maxContextTokens: 1000,
      reservedOutputTokens: 200, // usable budget = 800 tokens
      compactionThreshold: 0.8,
      maxToolOutputTokens: 400,
      maxFileReadTokens: 400,
      maxSearchResultTokens: 200,
      maxCommandOutputTokens: 300,
    };

    const contextState: ContextState = {
      items: [
        {
          id: "item-1",
          type: "tool_result",
          content: "Some normal output line",
          importance: "normal",
          createdAt: 500,
        },
      ],
      maxContextTokens: 1000,
      reservedOutputTokens: 200,
      estimatedInputTokens: 0,
      compactionCount: 0,
      truncatedItemCount: 0,
    };

    const input: BuildContextInput = {
      task: "Run tests",
      contextState,
      tools: [],
      budget,
    };

    const result = builder.build(input);

    expect(result.estimatedTokens).toBeLessThanOrEqual(800);
    expect(result.utilization).toBeGreaterThan(0);
    expect(result.utilization).toBeLessThan(1.0);
    expect(result.metrics.contextUtilization).toBe(result.utilization);
  });

  it("sets truncated flag when an oversized item is truncated", () => {
    const hugeToolOutput = "line of search output\n".repeat(200); // well over 200 tokens
    const contextState: ContextState = {
      items: [
        {
          id: "large-search",
          type: "tool_result",
          content: hugeToolOutput,
          importance: "normal",
          createdAt: 1000,
          source: { toolName: "search_files" },
        },
      ],
      maxContextTokens: 32000,
      reservedOutputTokens: 4096,
      estimatedInputTokens: 0,
      compactionCount: 0,
      truncatedItemCount: 0,
    };

    const budget: ContextBudget = {
      ...DEFAULT_CONTEXT_BUDGET,
      maxSearchResultTokens: 50,
    };

    const input: BuildContextInput = {
      task: "Search project",
      contextState,
      tools: [],
      budget,
    };

    const result = builder.build(input);

    expect(result.truncated).toBe(true);
    expect(result.metrics.truncatedItemsCount).toBeGreaterThan(0);
  });

  it("sets compacted flag when compactionCount > 0 or summaries exist", () => {
    const contextState: ContextState = {
      items: [
        {
          id: "summary-1",
          type: "summary",
          content: "Compacted findings",
          importance: "high",
          createdAt: 100,
        },
      ],
      maxContextTokens: 32000,
      reservedOutputTokens: 4096,
      estimatedInputTokens: 0,
      compactionCount: 1,
      truncatedItemCount: 0,
    };

    const input: BuildContextInput = {
      task: "Continue task",
      contextState,
      tools: [],
      budget: DEFAULT_CONTEXT_BUDGET,
    };

    const result = builder.build(input);

    expect(result.compacted).toBe(true);
    expect(result.metrics.compactionsCount).toBe(1);
  });
});
