import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  loadContextBudgetFromEnv,
  comparePriorityAndRecency,
  computeContentHash,
  ContextSelectionPolicy,
  defaultSelectionPolicy,
} from "../../../src/context/policies.js";
import type { ContextItem } from "../../../src/context/types.js";
import { DEFAULT_CONTEXT_BUDGET } from "../../../src/context/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Provider isolation (NFR-1 / FR-16 / FR-18 / FR-19)
// ---------------------------------------------------------------------------

describe("Context Policies — Provider Isolation (NFR-1)", () => {
  it("has zero imports from @google/genai or any other provider SDK", () => {
    const filePath = resolve(__dirname, "../../../src/context/policies.ts");
    const content = readFileSync(filePath, "utf-8");

    expect(content).not.toContain("@google/genai");
    expect(content).not.toContain("google");
    expect(content).not.toContain("openai");
    expect(content).not.toContain("anthropic");
  });
});

// ---------------------------------------------------------------------------
// Context Budget from Environment (FR-16)
// ---------------------------------------------------------------------------

describe("Context Budget Loading (FR-16)", () => {
  it("loads defaults when env variables are absent", () => {
    const budget = loadContextBudgetFromEnv({});
    expect(budget.maxContextTokens).toBe(DEFAULT_CONTEXT_BUDGET.maxContextTokens);
    expect(budget.reservedOutputTokens).toBe(DEFAULT_CONTEXT_BUDGET.reservedOutputTokens);
    expect(budget.compactionThreshold).toBe(DEFAULT_CONTEXT_BUDGET.compactionThreshold);
    expect(budget.maxToolOutputTokens).toBe(DEFAULT_CONTEXT_BUDGET.maxToolOutputTokens);
    expect(budget.maxFileReadTokens).toBe(DEFAULT_CONTEXT_BUDGET.maxFileReadTokens);
    expect(budget.maxSearchResultTokens).toBe(DEFAULT_CONTEXT_BUDGET.maxSearchResultTokens);
    expect(budget.maxCommandOutputTokens).toBe(DEFAULT_CONTEXT_BUDGET.maxCommandOutputTokens);
  });

  it("parses valid environment variables correctly", () => {
    const customEnv = {
      MODEL_CONTEXT_TOKENS: "64000",
      MODEL_OUTPUT_TOKENS: "8192",
      CONTEXT_COMPACTION_THRESHOLD: "0.75",
      MAX_TOOL_OUTPUT_TOKENS: "5000",
      MAX_FILE_READ_TOKENS: "8000",
      MAX_SEARCH_RESULT_TOKENS: "3000",
      MAX_COMMAND_OUTPUT_TOKENS: "4500",
    };

    const budget = loadContextBudgetFromEnv(customEnv);
    expect(budget.maxContextTokens).toBe(64000);
    expect(budget.reservedOutputTokens).toBe(8192);
    expect(budget.compactionThreshold).toBe(0.75);
    expect(budget.maxToolOutputTokens).toBe(5000);
    expect(budget.maxFileReadTokens).toBe(8000);
    expect(budget.maxSearchResultTokens).toBe(3000);
    expect(budget.maxCommandOutputTokens).toBe(4500);
  });

  it("safely handles invalid or negative numbers by falling back to defaults", () => {
    const invalidEnv = {
      MODEL_CONTEXT_TOKENS: "-100",
      MODEL_OUTPUT_TOKENS: "not-a-number",
      CONTEXT_COMPACTION_THRESHOLD: "1.5", // clamped fallback
    };

    const budget = loadContextBudgetFromEnv(invalidEnv);
    expect(budget.maxContextTokens).toBe(DEFAULT_CONTEXT_BUDGET.maxContextTokens);
    expect(budget.reservedOutputTokens).toBe(DEFAULT_CONTEXT_BUDGET.reservedOutputTokens);
    expect(budget.compactionThreshold).toBe(DEFAULT_CONTEXT_BUDGET.compactionThreshold);
  });
});

// ---------------------------------------------------------------------------
// Priority & Recency Comparator (Section 18 & 20 / FR-18)
// ---------------------------------------------------------------------------

describe("Priority & Recency Comparator (Section 18, 20 / FR-18)", () => {
  it("CRITICAL beats HIGH, NORMAL, and LOW", () => {
    const critical: ContextItem = {
      id: "1",
      type: "user",
      content: "Task",
      importance: "critical",
      createdAt: 100,
    };
    const high: ContextItem = {
      id: "2",
      type: "tool_result",
      content: "File",
      importance: "high",
      createdAt: 500,
    };

    expect(comparePriorityAndRecency(critical, high)).toBeLessThan(0); // critical comes first
    expect(comparePriorityAndRecency(high, critical)).toBeGreaterThan(0);
  });

  it("CRITICAL old beats NORMAL recent (priority over recency)", () => {
    const criticalOld: ContextItem = {
      id: "c-old",
      type: "task_state",
      content: "Initial constraint",
      importance: "critical",
      createdAt: 10,
    };
    const normalRecent: ContextItem = {
      id: "n-rec",
      type: "tool_result",
      content: "Recent command output",
      importance: "normal",
      createdAt: 99999,
    };

    expect(comparePriorityAndRecency(criticalOld, normalRecent)).toBeLessThan(0);
  });

  it("uses recency as a tiebreaker when importance is equal", () => {
    const older: ContextItem = {
      id: "h-old",
      type: "tool_result",
      content: "Old search result",
      importance: "high",
      createdAt: 1000,
    };
    const newer: ContextItem = {
      id: "h-new",
      type: "tool_result",
      content: "New search result",
      importance: "high",
      createdAt: 2000,
    };

    expect(comparePriorityAndRecency(newer, older)).toBeLessThan(0); // newer comes first
    expect(comparePriorityAndRecency(older, newer)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Content Hash Deduplication (FR-19)
// ---------------------------------------------------------------------------

describe("Duplicate Detection (FR-19)", () => {
  it("generates matching hashes for whitespace- and case-normalized content", () => {
    const content1 = "File content found in calculator.ts\nLine 1\nLine 2";
    const content2 = "  file content found in calculator.ts\r\nline 1\r\nline 2   ";
    const different = "File content found in calculator.ts\nLine 1\nLine 3";

    expect(computeContentHash(content1)).toBe(computeContentHash(content2));
    expect(computeContentHash(content1)).not.toBe(computeContentHash(different));
  });
});

// ---------------------------------------------------------------------------
// 7-Step Selection Algorithm (Section 19 / AC-13)
// ---------------------------------------------------------------------------

describe("7-Step Selection Algorithm (TASK-19 / AC-13)", () => {
  const policy = defaultSelectionPolicy;

  it("evaluates 20 mixed-priority items under a small budget: keeps critical, drops low first", () => {
    // Generate 20 items: 2 critical, 4 high, 8 normal, 6 low
    const items: ContextItem[] = [];

    // 2 Critical items
    for (let i = 1; i <= 2; i++) {
      items.push({
        id: `crit-${i}`,
        type: "user",
        content: `Critical item ${i} content`,
        importance: "critical",
        createdAt: 100 * i,
        tokenEstimate: 50,
      });
    }

    // 4 High items
    for (let i = 1; i <= 4; i++) {
      items.push({
        id: `high-${i}`,
        type: "tool_result",
        content: `High importance item ${i} content`,
        importance: "high",
        createdAt: 200 * i,
        tokenEstimate: 50,
      });
    }

    // 8 Normal items
    for (let i = 1; i <= 8; i++) {
      items.push({
        id: `norm-${i}`,
        type: "tool_result",
        content: `Normal item ${i} content`,
        importance: "normal",
        createdAt: 300 * i,
        tokenEstimate: 50,
      });
    }

    // 6 Low items
    for (let i = 1; i <= 6; i++) {
      items.push({
        id: `low-${i}`,
        type: "tool_result",
        content: `Low importance item ${i} content`,
        importance: "low",
        createdAt: 400 * i,
        tokenEstimate: 50,
      });
    }

    // Budget allows only 250 tokens (e.g. 5 items @ 50 tokens each)
    const budgetTokens = 250;
    const result = policy.select(items, budgetTokens);

    // Both CRITICAL items must be selected (2 items = 100 tokens)
    expect(result.selected.some((x) => x.id === "crit-1")).toBe(true);
    expect(result.selected.some((x) => x.id === "crit-2")).toBe(true);

    // Remaining budget (150 tokens) fits 3 HIGH items
    const selectedHigh = result.selected.filter((x) => x.importance === "high");
    expect(selectedHigh).toHaveLength(3);

    // Low items must be dropped first
    const selectedLow = result.selected.filter((x) => x.importance === "low");
    expect(selectedLow).toHaveLength(0);

    // Total tokens should not exceed budget
    expect(result.totalEstimatedTokens).toBeLessThanOrEqual(budgetTokens);
    expect(result.dropped.length).toBe(15);
  });

  it("recency tiebreaker: newer items are preferred within the same priority", () => {
    const itemOld: ContextItem = {
      id: "normal-old",
      type: "tool_result",
      content: "Old search result",
      importance: "normal",
      createdAt: 1000,
      tokenEstimate: 100,
    };
    const itemNew: ContextItem = {
      id: "normal-new",
      type: "tool_result",
      content: "New search result",
      importance: "normal",
      createdAt: 5000,
      tokenEstimate: 100,
    };

    // Budget fits only 1 item (100 tokens)
    const result = policy.select([itemOld, itemNew], 100);

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].id).toBe("normal-new");
    expect(result.dropped[0].id).toBe("normal-old");
  });

  it("duplicate removal: duplicate items are deduplicated and latest is preserved", () => {
    const item1: ContextItem = {
      id: "search-1",
      type: "tool_result",
      content: "calculator.ts contains add, subtract, multiply",
      importance: "normal",
      createdAt: 1000,
      tokenEstimate: 20,
    };
    const item2: ContextItem = {
      id: "search-2",
      type: "tool_result",
      content: "calculator.ts contains add, subtract, multiply", // identical content
      importance: "normal",
      createdAt: 2000,
      tokenEstimate: 20,
    };

    const result = policy.select([item1, item2], 500);

    expect(result.duplicatesRemoved).toBe(1);
    expect(result.selected).toHaveLength(1);
    // Preserves newer duplicate
    expect(result.selected[0].id).toBe("search-2");
    expect(result.dropped[0].id).toBe("search-1");
  });
});
