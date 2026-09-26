import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ManagedContextManager } from "../../../src/context/context-manager.js";
import { ContextManager } from "../../../src/context/context.js";
import type { ContextBudget, ImportantFact } from "../../../src/context/types.js";
import { DEFAULT_CONTEXT_BUDGET } from "../../../src/context/types.js";
import type { Message, ToolDefinition } from "../../../src/llm/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Provider isolation (NFR-1 / FR-22)
// ---------------------------------------------------------------------------

describe("Context Manager — Provider Isolation (NFR-1)", () => {
  it("has zero imports from @google/genai or any other provider SDK", () => {
    const filePath = resolve(__dirname, "../../../src/context/context-manager.ts");
    const content = readFileSync(filePath, "utf-8");

    expect(content).not.toContain("@google/genai");
    expect(content).not.toContain("google");
    expect(content).not.toContain("openai");
    expect(content).not.toContain("anthropic");
  });
});

// ---------------------------------------------------------------------------
// ManagedContextManager Subsystem Coordination (TASK-22 / FR-22)
// ---------------------------------------------------------------------------

describe("ManagedContextManager (TASK-22 / FR-22 / DECISION-566cf411)", () => {
  it("buildManaged coordinates builder, policies, and estimator into single entry point", () => {
    const manager = new ManagedContextManager();

    const tools: ToolDefinition[] = [
      {
        name: "read_file",
        description: "Read file contents",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "File path" } },
          required: ["path"],
        },
      },
    ];

    const state = {
      userRequest: "Find and fix bugs in calculator",
      messages: [
        {
          role: "assistant" as const,
          content: "I will read calculator.ts",
          toolCall: { id: "call_1", toolName: "read_file", arguments: { path: "src/calculator.ts" } },
        },
        {
          role: "tool" as const,
          content: "export function multiply(a, b) { return a + b; }",
          toolResult: { toolCallId: "call_1", success: true, output: "export function multiply(a, b) { return a + b; }" },
        },
      ],
    };

    const result = manager.buildManaged(state, tools);

    expect(result.messages.length).toBeGreaterThanOrEqual(3);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].role).toBe("user");
    expect(result.messages[1].content).toBe(state.userRequest);
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.utilization).toBeGreaterThan(0);
    expect(result.metrics).toBeDefined();

    // Verify state tracking was updated
    const ctxState = manager.getState();
    expect(ctxState.items.length).toBeGreaterThan(0);
    expect(ctxState.estimatedInputTokens).toBe(result.estimatedTokens);
  });

  it("retains important facts across buildManaged calls", () => {
    const manager = new ManagedContextManager();
    const fact: ImportantFact = {
      id: "fact-1",
      content: "multiply() performs addition instead of multiplication",
      importance: "critical",
    };

    manager.addImportantFact(fact);

    const result = manager.buildManaged({
      userRequest: "Fix calculator bug",
      messages: [],
    });

    const hasFact = result.messages.some((m) =>
      m.content.includes("multiply() performs addition instead of multiplication")
    );
    expect(hasFact).toBe(true);
  });

  it("records tool results and truncates oversized outputs", () => {
    const manager = new ManagedContextManager();
    const hugeOutput = "result line\n".repeat(1000); // 12,000 chars = 3,000 tokens (> 2,000 maxSearchResultTokens)

    const item = manager.addToolResult("search_files", hugeOutput, {
      importance: "normal",
    });

    expect(item.type).toBe("tool_result");

    const result = manager.buildManaged({
      userRequest: "Search files",
      messages: [],
    });

    expect(result.truncated).toBe(true);
    expect(result.metrics.truncatedItemsCount).toBeGreaterThan(0);
  });

  it("triggers compaction when utilization meets or exceeds threshold", () => {
    // Set small budget so compaction threshold is triggered
    const smallBudget: ContextBudget = {
      maxContextTokens: 600,
      reservedOutputTokens: 100, // usable = 500 tokens
      compactionThreshold: 0.5, // 250 tokens triggers compaction
      maxToolOutputTokens: 200,
      maxFileReadTokens: 200,
      maxSearchResultTokens: 100,
      maxCommandOutputTokens: 100,
    };

    const manager = new ManagedContextManager({ budget: smallBudget });

    // Populate enough turns to exceed recent window (8) and hit threshold
    for (let i = 1; i <= 12; i++) {
      manager.addContextItem({
        id: `asst-${i}`,
        type: "assistant",
        content: `Assistant thought step ${i}: detailed explanation of code inspection. `.repeat(3),
        importance: "normal",
        createdAt: 100 * i,
      });
      manager.addToolResult("search_files", `Search results for query ${i} in codebase. `.repeat(4), {
        importance: "normal",
      });
    }

    const result = manager.buildManaged(
      {
        userRequest: "Solve task with many turns",
        messages: [],
      },
      [],
      smallBudget
    );

    expect(result.compacted).toBe(true);
    expect(result.metrics.compactionsCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Backward-Compatibility Shim (DECISION-f2edfb27)
// ---------------------------------------------------------------------------

describe("ContextManager Shim (DECISION-f2edfb27)", () => {
  it("preserves assemble() and creates valid message history without modification", () => {
    const shim = new ContextManager();
    const history: Message[] = [
      { role: "user", content: "Test user task" },
      { role: "assistant", content: "I will proceed" },
    ];

    const messages = shim.assemble("Test user task", history);

    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[2].role).toBe("assistant");
  });

  it("preserves createToolResultMessage() behavior", () => {
    const shim = new ContextManager({ maxContentBytes: 50 });
    const msg = shim.createToolResultMessage({
      toolCallId: "call_abc",
      success: true,
      output: "A".repeat(200),
    });

    expect(msg.role).toBe("tool");
    expect(msg.content).toContain("[... Tool output truncated by context manager ...]");
  });

  it("exposes underlying ManagedContextManager delegate", () => {
    const shim = new ContextManager();
    expect(shim.getManagedDelegate()).toBeInstanceOf(ManagedContextManager);
  });
});
