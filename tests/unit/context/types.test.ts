import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type {
  ContextItem,
  ContextItemType,
  ContextImportance,
  ContextState,
  ContextBudget,
  ContextMetrics,
  ContextStats,
  ImportantFact,
  CompactionEvent,
  BuildContextInput,
  BuildContextResult,
  TokenEstimator,
  Truncator,
  Compactor,
  ContextBuilder,
} from "../../../src/context/types.js";
import { DEFAULT_CONTEXT_BUDGET } from "../../../src/context/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Provider isolation (NFR-1 / NFR-3)
// ---------------------------------------------------------------------------

describe("Context Types — Provider Isolation (NFR-1)", () => {
  it("src/context/types.ts has zero imports from @google/genai or any provider SDK", () => {
    const filePath = resolve(__dirname, "../../../src/context/types.ts");
    const content = readFileSync(filePath, "utf-8");

    expect(content).not.toContain("@google/genai");
    expect(content).not.toContain("google");
    expect(content).not.toContain("openai");
    expect(content).not.toContain("anthropic");
  });
});

// ---------------------------------------------------------------------------
// ContextItem & Importance (FR-14)
// ---------------------------------------------------------------------------

describe("ContextItem (FR-14)", () => {
  it("allows constructing valid ContextItem objects across all types", () => {
    const types: ContextItemType[] = [
      "system",
      "user",
      "assistant",
      "tool_call",
      "tool_result",
      "task_state",
      "important_fact",
      "summary",
    ];

    const importances: ContextImportance[] = ["critical", "high", "normal", "low"];

    types.forEach((type, index) => {
      const item: ContextItem = {
        id: `item-${index}`,
        type,
        content: `Sample content for ${type}`,
        importance: importances[index % importances.length],
        createdAt: Date.now(),
        tokenEstimate: 42,
        removable: type !== "system",
      };

      expect(item.id).toBe(`item-${index}`);
      expect(item.type).toBe(type);
      expect(item.content).toContain(type);
      expect(item.tokenEstimate).toBe(42);
    });
  });

  it("supports source metadata and truncation fields", () => {
    const item: ContextItem = {
      id: "tool-1",
      type: "tool_result",
      content: "File contents truncated...",
      importance: "normal",
      createdAt: 1000,
      tokenEstimate: 500,
      source: {
        toolName: "read_file",
        filePath: "src/calculator.ts",
        command: undefined,
      },
      truncated: true,
      originalTokenEstimate: 3500,
      finalTokenEstimate: 500,
      removable: true,
    };

    expect(item.source?.toolName).toBe("read_file");
    expect(item.source?.filePath).toBe("src/calculator.ts");
    expect(item.truncated).toBe(true);
    expect(item.originalTokenEstimate).toBe(3500);
    expect(item.finalTokenEstimate).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// ContextState (FR-14)
// ---------------------------------------------------------------------------

describe("ContextState (FR-14)", () => {
  it("represents the full context state accurately", () => {
    const state: ContextState = {
      items: [
        {
          id: "item-1",
          type: "user",
          content: "Fix bug in calculator",
          importance: "critical",
          createdAt: 100,
          tokenEstimate: 10,
        },
      ],
      maxContextTokens: 32000,
      reservedOutputTokens: 4096,
      estimatedInputTokens: 10,
      compactionCount: 0,
      truncatedItemCount: 0,
    };

    expect(state.items).toHaveLength(1);
    expect(state.maxContextTokens).toBe(32000);
    expect(state.reservedOutputTokens).toBe(4096);
    expect(state.estimatedInputTokens).toBe(10);
    expect(state.compactionCount).toBe(0);
    expect(state.truncatedItemCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ContextBudget (FR-14, FR-16)
// ---------------------------------------------------------------------------

describe("ContextBudget (FR-14, FR-16)", () => {
  it("provides valid default budget configuration", () => {
    expect(DEFAULT_CONTEXT_BUDGET.maxContextTokens).toBe(32000);
    expect(DEFAULT_CONTEXT_BUDGET.reservedOutputTokens).toBe(4096);
    expect(DEFAULT_CONTEXT_BUDGET.compactionThreshold).toBe(0.8);
    expect(DEFAULT_CONTEXT_BUDGET.maxToolOutputTokens).toBe(4000);
    expect(DEFAULT_CONTEXT_BUDGET.maxFileReadTokens).toBe(6000);
    expect(DEFAULT_CONTEXT_BUDGET.maxSearchResultTokens).toBe(2000);
    expect(DEFAULT_CONTEXT_BUDGET.maxCommandOutputTokens).toBe(4000);
  });

  it("supports custom budget instances", () => {
    const customBudget: ContextBudget = {
      maxContextTokens: 16000,
      reservedOutputTokens: 2048,
      compactionThreshold: 0.75,
      maxToolOutputTokens: 2000,
      maxFileReadTokens: 3000,
      maxSearchResultTokens: 1000,
      maxCommandOutputTokens: 2000,
    };

    const usableInputBudget = customBudget.maxContextTokens - customBudget.reservedOutputTokens;
    expect(usableInputBudget).toBe(13952);
  });
});

// ---------------------------------------------------------------------------
// ContextMetrics & ContextStats (FR-14, FR-26)
// ---------------------------------------------------------------------------

describe("ContextMetrics & ContextStats (FR-14, FR-26)", () => {
  it("conforms to ContextMetrics structure", () => {
    const metrics: ContextMetrics = {
      iteration: 3,
      estimatedInputTokens: 5200,
      estimatedOutputTokens: 350,
      contextUtilization: 0.65,
      totalItems: 8,
      toolResultsCount: 3,
      truncatedItemsCount: 1,
      droppedItemsCount: 0,
      compactionsCount: 0,
    };

    expect(metrics.iteration).toBe(3);
    expect(metrics.estimatedInputTokens).toBe(5200);
    expect(metrics.contextUtilization).toBe(0.65);
    expect(metrics.totalItems).toBe(8);
  });

  it("conforms to ContextStats structure", () => {
    const stats: ContextStats = {
      totalItems: 12,
      estimatedTokens: 9500,
      utilization: 0.34,
      truncations: 2,
      compactions: 1,
      droppedItems: 4,
    };

    expect(stats.totalItems).toBe(12);
    expect(stats.truncations).toBe(2);
    expect(stats.compactions).toBe(1);
    expect(stats.droppedItems).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// ImportantFact (FR-14, FR-23)
// ---------------------------------------------------------------------------

describe("ImportantFact (FR-14, FR-23)", () => {
  it("creates structured fact items correctly", () => {
    const fact: ImportantFact = {
      id: "fact-1",
      content: "Bug is located in src/calculator.ts:15",
      importance: "critical",
      source: "read_file:src/calculator.ts",
      createdAt: 1700000000,
    };

    expect(fact.id).toBe("fact-1");
    expect(fact.content).toBe("Bug is located in src/calculator.ts:15");
    expect(fact.importance).toBe("critical");
    expect(fact.source).toBe("read_file:src/calculator.ts");
  });
});

// ---------------------------------------------------------------------------
// CompactionEvent (FR-14, FR-21)
// ---------------------------------------------------------------------------

describe("CompactionEvent (FR-14, FR-21)", () => {
  it("records compaction events with before/after delta metrics", () => {
    const event: CompactionEvent = {
      timestamp: Date.now(),
      itemsBefore: 25,
      itemsAfter: 10,
      estimatedTokensBefore: 28500,
      estimatedTokensAfter: 7200,
      itemsRemoved: 15,
      summaryCreated: true,
    };

    expect(event.itemsBefore).toBe(25);
    expect(event.itemsAfter).toBe(10);
    expect(event.estimatedTokensBefore).toBe(28500);
    expect(event.estimatedTokensAfter).toBe(7200);
    expect(event.itemsRemoved).toBe(15);
    expect(event.summaryCreated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BuildContextInput & BuildContextResult (FR-14, FR-20)
// ---------------------------------------------------------------------------

describe("BuildContextInput & BuildContextResult (FR-14, FR-20)", () => {
  it("structures builder inputs and outputs properly", () => {
    const input: BuildContextInput = {
      task: "Fix calculator bug",
      contextState: {
        items: [],
        maxContextTokens: 32000,
        reservedOutputTokens: 4096,
        estimatedInputTokens: 0,
        compactionCount: 0,
        truncatedItemCount: 0,
      },
      tools: [
        {
          name: "search_files",
          description: "Search workspace files",
          parameters: {
            type: "object",
            properties: { query: { type: "string", description: "Search query" } },
            required: ["query"],
          },
        },
      ],
      budget: DEFAULT_CONTEXT_BUDGET,
      importantFacts: [
        {
          id: "fact-1",
          content: "Failing test is calculator.test.ts",
          importance: "critical",
        },
      ],
    };

    const result: BuildContextResult = {
      messages: [
        { role: "system", content: "You are an agent." },
        { role: "user", content: "Fix calculator bug" },
      ],
      estimatedTokens: 350,
      utilization: 0.0125,
      truncated: false,
      compacted: false,
      metrics: {
        estimatedInputTokens: 350,
        contextUtilization: 0.0125,
        totalItems: 2,
        toolResultsCount: 0,
        truncatedItemsCount: 0,
        droppedItemsCount: 0,
        compactionsCount: 0,
      },
    };

    expect(input.tools).toHaveLength(1);
    expect(input.importantFacts).toHaveLength(1);
    expect(result.messages).toHaveLength(2);
    expect(result.compacted).toBe(false);
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Subsystem Component Contracts
// ---------------------------------------------------------------------------

describe("Subsystem Component Contracts", () => {
  it("allows mock implementations of TokenEstimator, Truncator, Compactor, and ContextBuilder", () => {
    const mockEstimator: TokenEstimator = {
      estimate: (text: string) => Math.ceil(text.length / 4),
    };

    const mockTruncator: Truncator = {
      truncate: (item: ContextItem, maxTokens: number) => {
        return {
          ...item,
          truncated: true,
          originalTokenEstimate: item.tokenEstimate || 100,
          finalTokenEstimate: maxTokens,
        };
      },
    };

    const mockCompactor: Compactor = {
      compact: (state: ContextState, budget: ContextBudget) => {
        return {
          state: {
            ...state,
            compactionCount: state.compactionCount + 1,
          },
          event: {
            timestamp: Date.now(),
            itemsBefore: state.items.length,
            itemsAfter: state.items.length,
            estimatedTokensBefore: state.estimatedInputTokens,
            estimatedTokensAfter: Math.floor(state.estimatedInputTokens / 2),
            itemsRemoved: 0,
            summaryCreated: true,
          },
        };
      },
    };

    const mockBuilder: ContextBuilder = {
      build: (input: BuildContextInput) => {
        return {
          messages: [{ role: "user", content: input.task }],
          estimatedTokens: mockEstimator.estimate(input.task),
          utilization: 0.1,
          truncated: false,
          compacted: false,
          metrics: {
            estimatedInputTokens: 50,
            contextUtilization: 0.1,
            totalItems: 1,
            toolResultsCount: 0,
            truncatedItemsCount: 0,
            droppedItemsCount: 0,
            compactionsCount: 0,
          },
        };
      },
    };

    expect(mockEstimator.estimate("12345678")).toBe(2);
    const item: ContextItem = {
      id: "1",
      type: "user",
      content: "test",
      importance: "normal",
      createdAt: 1,
    };
    expect(mockTruncator.truncate(item, 50).finalTokenEstimate).toBe(50);
  });
});
