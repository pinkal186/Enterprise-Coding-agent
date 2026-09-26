import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  DeterministicCompactor,
  defaultCompactor,
} from "../../../src/context/compactor.js";
import type {
  ContextBudget,
  ContextItem,
  ContextState,
  ImportantFact,
} from "../../../src/context/types.js";
import { DEFAULT_CONTEXT_BUDGET } from "../../../src/context/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Provider isolation (NFR-1 / FR-21 / DECISION-3ad6a1ad)
// ---------------------------------------------------------------------------

describe("Compactor — Provider Isolation (NFR-1)", () => {
  it("has zero imports from @google/genai or any other provider SDK", () => {
    const filePath = resolve(__dirname, "../../../src/context/compactor.ts");
    const content = readFileSync(filePath, "utf-8");

    expect(content).not.toContain("@google/genai");
    expect(content).not.toContain("google");
    expect(content).not.toContain("openai");
    expect(content).not.toContain("anthropic");
  });
});

// ---------------------------------------------------------------------------
// Core Compactor Behavior (TASK-21 / FR-21 / AC-14)
// ---------------------------------------------------------------------------

describe("Deterministic Compactor (TASK-21 / AC-14)", () => {
  const compactor = new DeterministicCompactor({ recentTurnsWindow: 4 });

  it("does not compact when interaction items are within the recent turns window", () => {
    const state: ContextState = {
      items: [
        { id: "sys", type: "system", content: "Instructions", importance: "critical", createdAt: 0 },
        { id: "task", type: "user", content: "Fix bug", importance: "critical", createdAt: 1 },
        { id: "msg1", type: "assistant", content: "Looking at code", importance: "normal", createdAt: 10 },
        { id: "tool1", type: "tool_result", content: "File content", importance: "normal", createdAt: 20 },
      ],
      maxContextTokens: 32000,
      reservedOutputTokens: 4096,
      estimatedInputTokens: 200,
      compactionCount: 0,
      truncatedItemCount: 0,
    };

    const result = compactor.compact(state, DEFAULT_CONTEXT_BUDGET);

    expect(result.event).toBeUndefined();
    expect(result.state.items).toHaveLength(4);
    expect(result.state.compactionCount).toBe(0);
  });

  it("compacts older items beyond window, reduces tokens, and records CompactionEvent", () => {
    // Create conversation with 10 interaction turns (window is 4, so 6 turns eligible for compaction)
    const items: ContextItem[] = [
      { id: "sys", type: "system", content: "System instructions", importance: "critical", createdAt: 0 },
      { id: "user-task", type: "user", content: "Fix multiplication bug in src/calculator.ts", importance: "critical", createdAt: 1 },
    ];

    // Older interaction turns (to be compacted into structured summary)
    for (let i = 1; i <= 6; i++) {
      items.push({
        id: `old-asst-${i}`,
        type: "assistant",
        content: `Older step ${i}: searching and inspecting directory structures in detail with long output. `.repeat(15),
        importance: "normal",
        createdAt: 100 * i,
      });
      items.push({
        id: `old-tool-${i}`,
        type: "tool_result",
        content: `Search result for query ${i}: found references in src/calculator.ts and src/util.ts with verbose output. `.repeat(25),
        importance: "normal",
        createdAt: 100 * i + 10,
        source: {
          toolName: "search_files",
          filePath: "src/calculator.ts",
        },
      });
    }

    // Recent 4 interaction turns (must be preserved verbatim)
    for (let i = 7; i <= 8; i++) {
      items.push({
        id: `recent-asst-${i}`,
        type: "assistant",
        content: `Recent assistant step ${i}`,
        importance: "high",
        createdAt: 1000 * i,
      });
      items.push({
        id: `recent-tool-${i}`,
        type: "tool_result",
        content: `Recent tool output ${i}`,
        importance: "high",
        createdAt: 1000 * i + 10,
        source: {
          toolName: "run_command",
          command: "npm test",
        },
      });
    }

    const state: ContextState = {
      items,
      maxContextTokens: 32000,
      reservedOutputTokens: 4096,
      estimatedInputTokens: 3500,
      compactionCount: 0,
      truncatedItemCount: 0,
    };

    const importantFacts: ImportantFact[] = [
      {
        id: "fact-1",
        content: "calculator.ts multiply() returns addition",
        importance: "critical",
      },
    ];

    const result = compactor.compact(state, DEFAULT_CONTEXT_BUDGET, importantFacts);

    expect(result.event).toBeDefined();
    const event = result.event!;

    // Verification of CompactionEvent contract
    expect(event.itemsBefore).toBe(items.length);
    expect(event.itemsAfter).toBeLessThan(items.length);
    expect(event.estimatedTokensAfter).toBeLessThan(event.estimatedTokensBefore);
    expect(event.summaryCreated).toBe(true);
    expect(event.itemsRemoved).toBeGreaterThan(0);

    // Verification of Preserved State (Section 24)
    const newItems = result.state.items;

    // 1. User task remains
    const taskItem = newItems.find((it) => it.id === "user-task");
    expect(taskItem).toBeDefined();
    expect(taskItem?.content).toContain("Fix multiplication bug in src/calculator.ts");

    // 2. Summary item is created
    const summaryItem = newItems.find((it) => it.type === "summary");
    expect(summaryItem).toBeDefined();
    expect(summaryItem?.content).toContain("Task:");
    expect(summaryItem?.content).toContain("calculator.ts multiply() returns addition");
    expect(summaryItem?.content).toContain("src/calculator.ts");

    // 3. Recent 4 interaction turns remain intact
    expect(newItems.some((it) => it.id === "recent-asst-7")).toBe(true);
    expect(newItems.some((it) => it.id === "recent-tool-7")).toBe(true);
    expect(newItems.some((it) => it.id === "recent-asst-8")).toBe(true);
    expect(newItems.some((it) => it.id === "recent-tool-8")).toBe(true);

    // 4. Compaction count incremented
    expect(result.state.compactionCount).toBe(1);
  });

  it("extracts executed commands, test results, and error messages into summary", () => {
    const items: ContextItem[] = [
      { id: "task", type: "user", content: "Fix test", importance: "critical", createdAt: 0 },
      {
        id: "tool-fail",
        type: "tool_result",
        content: "FAIL tests/calc.test.ts\nAssertionError: expected 4 to equal 8",
        importance: "normal",
        createdAt: 10,
        source: { toolName: "run_command", command: "npm test" },
      },
    ];

    // Pad with turns to exceed window
    for (let i = 1; i <= 6; i++) {
      items.push({
        id: `pad-${i}`,
        type: "assistant",
        content: `Step ${i}`,
        importance: "normal",
        createdAt: 100 + i,
      });
    }

    const state: ContextState = {
      items,
      maxContextTokens: 32000,
      reservedOutputTokens: 4096,
      estimatedInputTokens: 500,
      compactionCount: 0,
      truncatedItemCount: 0,
    };

    const result = compactor.compact(state, DEFAULT_CONTEXT_BUDGET);
    const summary = result.state.items.find((it) => it.type === "summary");

    expect(summary).toBeDefined();
    expect(summary?.content).toContain("npm test");
    expect(summary?.content).toContain("AssertionError");
  });
});
