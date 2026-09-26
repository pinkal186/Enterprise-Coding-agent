import { describe, it, expect, beforeEach } from "vitest";
import { ManagedContextManager } from "../../../src/context/context-manager.js";
import type { ContextBudget, ContextItem, ImportantFact } from "../../../src/context/types.js";
import type { ToolDefinition, Message } from "../../../src/llm/types.js";
import { TaskState } from "../../../src/agent/state.js";

describe("Context Stress Testing (TASK-26 / AC-16 / AC-17)", () => {
  let contextManager: ManagedContextManager;
  const stressBudget: ContextBudget = {
    maxContextTokens: 8000,
    reservedOutputTokens: 1000,
    compactionThreshold: 0.75, // 5250 tokens triggers compaction
    maxToolOutputTokens: 1500,
    maxFileReadTokens: 2000,
    maxSearchResultTokens: 1000,
    maxCommandOutputTokens: 1500,
  };

  const sampleTools: ToolDefinition[] = [
    {
      name: "read_file",
      description: "Reads a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
    {
      name: "search_files",
      description: "Searches files",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    {
      name: "run_command",
      description: "Runs a shell command",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  ];

  beforeEach(() => {
    contextManager = new ManagedContextManager({ budget: stressBudget });
  });

  it("handles 100+ tool results, 50+ file reads, and repeated results within budget without crashing (AC-17)", () => {
    const state = new TaskState({
      taskId: "stress-task-1",
      userRequest: "Refactor legacy authentication subsystem across all microservices",
      workspaceRoot: "/workspace/project",
    });

    // 1. Add critical important facts that must never be dropped
    const criticalFact: ImportantFact = {
      id: "fact-critical-auth",
      content: "CRITICAL: Database password salt must remain HMAC-SHA256 with 32 rounds",
      importance: "critical",
      source: "security_policy.md",
    };
    state.addImportantFact(criticalFact);

    const highFact: ImportantFact = {
      id: "fact-high-arch",
      content: "HIGH: Token expiration is fixed at 3600 seconds",
      importance: "high",
      source: "auth_config.json",
    };
    state.addImportantFact(highFact);

    // 2. Generate 50+ file reads with large payloads (2,000 to 12,000 characters each)
    for (let i = 1; i <= 55; i++) {
      const fileContent = `// File content for module-${i}.ts\n` +
        `export class AuthModule${i} {\n` +
        `  // Logic implementation for chunk ${i}\n` +
        `  public verifyToken(token: string): boolean {\n` +
        `    return token.startsWith("auth-${i}-") && token.length > 20;\n` +
        `  }\n` +
        `}\n` +
        `// Additional comments and padding to increase token size\n`.repeat(i % 5 === 0 ? 100 : 25);

      state.messages.push({
        role: "assistant",
        content: `Reading module-${i}.ts`,
        toolCalls: [
          {
            id: `call-read-${i}`,
            toolName: "read_file",
            arguments: { path: `src/auth/module-${i}.ts` },
          },
        ],
      });

      state.messages.push({
        role: "tool",
        content: fileContent,
        toolCallId: `call-read-${i}`,
      });
    }

    // 3. Generate 100+ mixed tool results (search results, command runs, tool calls)
    for (let i = 1; i <= 105; i++) {
      const toolType = i % 3 === 0 ? "search_files" : i % 3 === 1 ? "run_command" : "custom_inspect";
      let toolOutput = "";

      if (i >= 100) {
        toolOutput = "LARGE_TOOL_OUTPUT_ENTRY_LINE_DATA: ".repeat(300); // ~10,000 chars > 6,000 chars (1500 tokens)
      } else if (toolType === "search_files") {
        toolOutput = Array.from({ length: 40 }, (_, idx) => `src/auth/module-${idx}.ts:${idx * 10}: match token`).join("\n");
      } else if (toolType === "run_command") {
        toolOutput = `npm test auth-suite-${i}\n` +
          `PASS src/auth/module-${i}.test.ts\n` +
          `  ✓ test suite ${i} passed (24ms)\n` +
          `Tests: 10 passed, 10 total\n` +
          `Time: 0.54s\n`;
      } else {
        toolOutput = JSON.stringify({
          subsystem: `auth-${i}`,
          status: "active",
          details: "x".repeat(300),
        });
      }

      state.messages.push({
        role: "assistant",
        content: `Executing ${toolType} #${i}`,
        toolCalls: [
          {
            id: `call-tool-${i}`,
            toolName: toolType,
            arguments: { step: i },
          },
        ],
      });

      state.messages.push({
        role: "tool",
        content: toolOutput,
        toolCallId: `call-tool-${i}`,
      });
    }

    // 4. Inject 20+ repeated results to stress-test deduplication under load
    const duplicateContent = `REPEATED_SEARCH_RESULT: Found 50 matches for 'validateSession' across codebase.\n` +
      `src/auth/session.ts:15: export function validateSession(id: string)\n`.repeat(10);

    for (let i = 1; i <= 25; i++) {
      state.messages.push({
        role: "tool",
        content: duplicateContent,
        toolCallId: `duplicate-call-${i}`,
      });
    }

    // Add an oversized recent tool result to exercise truncation in active context
    state.messages.push({
      role: "tool",
      content: "OVERSIZED_RECENT_TOOL_RESULT_DATA: ".repeat(300), // ~10,000 chars > 6,000 char cap
      toolCallId: "call-recent-oversized",
    });

    // Verify raw messages count is huge (300+ messages)
    expect(state.messages.length).toBeGreaterThan(320);

    // 5. Build managed context under stress
    const result = contextManager.buildManaged(state, sampleTools, stressBudget);

    const usableBudget = stressBudget.maxContextTokens - stressBudget.reservedOutputTokens;

    // A. Context Manager must not crash and produce valid result
    expect(result).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);

    // B. Managed context must remain strictly within usable budget (AC-17)
    expect(result.estimatedTokens).toBeLessThanOrEqual(usableBudget);
    expect(result.utilization).toBeLessThanOrEqual(1.0);
    expect(result.utilization).toBeGreaterThan(0);

    // C. Critical facts and task must be preserved (AC-13 / AC-14)
    const taskMessage = result.messages.find(
      (m) => m.role === "user" && m.content.includes("Refactor legacy authentication subsystem")
    );
    expect(taskMessage).toBeDefined();

    const criticalFactMessage = result.messages.find(
      (m) => typeof m.content === "string" && m.content.includes("Database password salt must remain HMAC-SHA256")
    );
    expect(criticalFactMessage).toBeDefined();

    // D. Truncation and compaction are properly recorded
    expect(result.truncated).toBe(true);
    expect(result.compacted).toBe(true);
    expect(result.metrics.truncatedItemsCount).toBeGreaterThan(0);
    expect(result.metrics.compactionsCount).toBeGreaterThan(0);
    expect(result.metrics.droppedItemsCount).toBeGreaterThan(0);

    // E. Every message in result.messages has valid role and content
    for (const msg of result.messages) {
      expect(["system", "user", "assistant", "model", "tool"]).toContain(msg.role);
      expect(typeof msg.content === "string" || Array.isArray(msg.content) || msg.toolCalls).toBeTruthy();
    }
  });

  it("maintains bounded context over 30 simulated progressive iterations (Design Doc §46)", () => {
    const state = new TaskState({
      taskId: "iterative-sim-1",
      userRequest: "Trace memory leak in WebSocket connection handler",
      workspaceRoot: "/workspace/server",
    });

    const tokenHistory: number[] = [];
    let compactionTriggeredCount = 0;

    // Simulate 30 sequential agent iterations
    for (let iteration = 1; iteration <= 30; iteration++) {
      state.iterationCount = iteration;

      // Model explores files and executes tests progressively
      const actionName = iteration <= 10 ? "read_file" : iteration <= 20 ? "search_files" : "run_command";
      const payload = `Iteration ${iteration} payload from ${actionName}: ` +
        `Detailed log entries, stack traces, and variable values. `.repeat(iteration * 5);

      state.messages.push({
        role: "assistant",
        content: `Iteration ${iteration}: Performing ${actionName}`,
        toolCalls: [
          {
            id: `call-iter-${iteration}`,
            toolName: actionName,
            arguments: { iteration },
          },
        ],
      });

      state.messages.push({
        role: "tool",
        content: payload,
        toolCallId: `call-iter-${iteration}`,
      });

      const buildResult = contextManager.buildManaged(state, sampleTools, stressBudget);

      // Usable budget is 7,000 tokens
      const usableBudget = stressBudget.maxContextTokens - stressBudget.reservedOutputTokens;

      expect(buildResult.estimatedTokens).toBeLessThanOrEqual(usableBudget);
      expect(buildResult.utilization).toBeLessThanOrEqual(1.0);

      tokenHistory.push(buildResult.estimatedTokens);

      if (buildResult.compacted) {
        compactionTriggeredCount++;
      }
    }

    // Verify that compaction occurred at least once across 30 iterations
    expect(compactionTriggeredCount).toBeGreaterThan(0);

    // Verify context never grew without limit:
    // Raw messages grew to 60, but estimatedTokens remained bounded by 7,000
    expect(state.messages.length).toBe(60);
    const maxTokensSeen = Math.max(...tokenHistory);
    expect(maxTokensSeen).toBeLessThanOrEqual(7000);
  });

  it("gracefully truncates massive individual items exceeding tool caps without memory corruption", () => {
    const state = new TaskState({
      taskId: "oversized-items-task",
      userRequest: "Analyze memory dump log",
      workspaceRoot: "/workspace",
    });

    // Massive search result of 80,000 characters
    const massiveSearch = "MATCH: line found\n".repeat(4000);
    state.messages.push({
      role: "tool",
      content: massiveSearch,
      toolCallId: "call-massive-search",
    });

    // Massive command output of 120,000 characters
    const massiveOutput = "DEBUG [2026-09-26T18:00:00Z] socket buffer flush\n".repeat(3000);
    state.messages.push({
      role: "tool",
      content: massiveOutput,
      toolCallId: "call-massive-cmd",
    });

    const result = contextManager.buildManaged(state, sampleTools, stressBudget);

    expect(result.truncated).toBe(true);
    expect(result.metrics.truncatedItemsCount).toBeGreaterThan(0);
    expect(result.estimatedTokens).toBeLessThanOrEqual(
      stressBudget.maxContextTokens - stressBudget.reservedOutputTokens
    );
  });

  it("handles extremely constrained budgets safely without dropping critical task (AC-13)", () => {
    const tightBudget: ContextBudget = {
      maxContextTokens: 2000,
      reservedOutputTokens: 500, // 1500 usable tokens
      compactionThreshold: 0.70,
      maxToolOutputTokens: 400,
      maxFileReadTokens: 600,
      maxSearchResultTokens: 300,
      maxCommandOutputTokens: 400,
    };

    const tightManager = new ManagedContextManager({ budget: tightBudget });

    const state = new TaskState({
      taskId: "tight-budget-task",
      userRequest: "Fix critical regression in parser.ts",
      workspaceRoot: "/workspace",
    });

    state.addImportantFact({
      id: "fact-parser-rule",
      content: "CRITICAL: AST visitor must not mutate parent node pointers",
      importance: "critical",
    });

    // Add 40 items to overflow the 1,500 token budget
    for (let i = 1; i <= 40; i++) {
      state.messages.push({
        role: "tool",
        content: `Tool result ${i}: ` + "token information ".repeat(20),
        toolCallId: `call-tight-${i}`,
      });
    }

    const result = tightManager.buildManaged(state, sampleTools, tightBudget);

    expect(result.estimatedTokens).toBeLessThanOrEqual(1500);
    expect(result.utilization).toBeLessThanOrEqual(1.0);

    // CRITICAL items must survive even in tight budget
    const hasTask = result.messages.some(
      (m) => m.role === "user" && m.content.includes("Fix critical regression in parser.ts")
    );
    expect(hasTask).toBe(true);

    const hasFact = result.messages.some(
      (m) => typeof m.content === "string" && m.content.includes("AST visitor must not mutate parent")
    );
    expect(hasFact).toBe(true);
  });
});
