import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { AgentLoop, type AgentEvent } from "../../src/agent/loop.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ReadFileTool } from "../../src/tools/read-file.js";
import { SearchTool } from "../../src/tools/search.js";
import { EditFileTool } from "../../src/tools/edit-file.js";
import { RunCommandTool } from "../../src/tools/run-command.js";
import type { LLMProvider } from "../../src/llm/provider.js";
import type { LLMResponse } from "../../src/llm/types.js";
import type { ContextBudget } from "../../src/context/types.js";

describe("Context Management Integration (TASK-26 / AC-18)", () => {
  let tempWorkspace: string;
  const fixtureDir = path.resolve(process.cwd(), "tests/fixtures/test-project");

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "context-mgmt-int-"));

    // Copy fixture files into temporary workspace
    const files = await fs.readdir(fixtureDir);
    for (const file of files) {
      const srcPath = path.join(fixtureDir, file);
      const destPath = path.join(tempWorkspace, file);
      await fs.copyFile(srcPath, destPath);
    }

    // Add extra reference files with realistic documentation to support multi-step investigation and exceed threshold
    await fs.writeFile(
      path.join(tempWorkspace, "architecture.md"),
      `# System Architecture & Math Operations Specification\n` +
      `- Standard operations: add, subtract, multiply, divide.\n` +
      `- All functions must be pure and deterministic without side effects.\n` +
      `- Core equation: add(a, b) -> a + b.\n` +
      `- Historical error: Subtraction logic was mistakenly substituted into addition handler.\n` +
      `// Comprehensive technical notes and specifications for the math engine.\n`.repeat(50)
    );

    await fs.writeFile(
      path.join(tempWorkspace, "guidelines.txt"),
      `Engineering Guidelines for Mathematics Engine Quality Assurance:\n` +
      `Rule 1: Always verify addition produces expected positive sum for positive integers.\n` +
      `Rule 2: Never modify test files directly unless test expectations are erroneous.\n` +
      `Rule 3: Keep implementation backward-compatible.\n` +
      `Rule 4: Validate inputs and ensure edge cases around negative numbers and zeroes pass.\n`.repeat(40)
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("forces growth -> threshold -> compaction -> continued correct work and successful verification (AC-18)", async () => {
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new SearchTool());
    registry.register(new EditFileTool());
    registry.register(new RunCommandTool());

    // Controlled tight budget to force compaction within a realistic 10-turn sequence
    const tightBudget: ContextBudget = {
      maxContextTokens: 3000,
      reservedOutputTokens: 500, // 2500 usable tokens
      compactionThreshold: 0.70, // 1750 tokens threshold triggers compaction
      maxToolOutputTokens: 600,
      maxFileReadTokens: 800,
      maxSearchResultTokens: 400,
      maxCommandOutputTokens: 600,
    };

    const emittedEvents: AgentEvent[] = [];

    // Multi-turn model reasoning sequence
    const responses: LLMResponse[] = [
      // Turn 1: Search repository
      {
        type: "tool_call",
        toolCall: {
          id: "call_search_1",
          toolName: "search_files",
          arguments: { query: "add" },
        },
      },
      // Turn 2: Read guidelines.txt
      {
        type: "tool_call",
        toolCall: {
          id: "call_read_guidelines",
          toolName: "read_file",
          arguments: { path: "guidelines.txt" },
        },
      },
      // Turn 3: Read architecture.md
      {
        type: "tool_call",
        toolCall: {
          id: "call_read_arch",
          toolName: "read_file",
          arguments: { path: "architecture.md" },
        },
      },
      // Turn 4: Run initial failing test to observe error output
      {
        type: "tool_call",
        toolCall: {
          id: "call_initial_test",
          toolName: "run_command",
          arguments: { command: "node calculator.test.js" },
        },
      },
      // Turn 5: Search for calculator implementation
      {
        type: "tool_call",
        toolCall: {
          id: "call_search_impl",
          toolName: "search_files",
          arguments: { query: "function add" },
        },
      },
      // Turn 6: Read package.json
      {
        type: "tool_call",
        toolCall: {
          id: "call_read_pkg",
          toolName: "read_file",
          arguments: { path: "package.json" },
        },
      },
      // Turn 7: Read calculator.js (inspect bug)
      {
        type: "tool_call",
        toolCall: {
          id: "call_read_calc",
          toolName: "read_file",
          arguments: { path: "calculator.js" },
        },
      },
      // Turn 8: Fix bug using edit_file replace (compaction occurred as context exceeded threshold)
      {
        type: "tool_call",
        toolCall: {
          id: "call_edit_fix",
          toolName: "edit_file",
          arguments: {
            path: "calculator.js",
            operation: "replace",
            target: "return a - b;",
            replacement: "return a + b;",
          },
        },
      },
      // Turn 9: Run verification test command
      {
        type: "tool_call",
        toolCall: {
          id: "call_verify_final",
          toolName: "run_command",
          arguments: { command: "node calculator.test.js" },
        },
      },
      // Turn 10: Final completed summary
      {
        type: "text",
        text: "I investigated the architecture and guidelines, observed the test failure in calculator.test.js, inspected calculator.js, fixed the addition operation from subtraction to addition, and verified all tests pass.",
      },
    ];

    const mockProvider: LLMProvider = {
      generate: vi.fn().mockImplementation(async () => responses.shift()!),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: registry,
      workspaceRoot: tempWorkspace,
      budget: tightBudget,
      verificationCommandPattern: /calculator\.test\.js|test/i,
      onEvent: (event) => {
        emittedEvents.push(event);
      },
    });

    const state = await loop.run(
      "Fix the failing calculator tests in calculator.test.js",
      "context-mgmt-int-task"
    );

    // 1. Verify agent successfully completed the task
    expect(state.status).toBe("completed");
    expect(state.verificationPassed).toBe(true);
    expect(Array.from(state.modifiedFiles)).toContain("calculator.js");

    // 2. Verify compaction actually occurred (AC-18)
    expect(state.contextStats.compactions).toBeGreaterThanOrEqual(1);

    // 3. Verify compaction events were properly emitted
    const compactionStartedEvents = emittedEvents.filter(
      (e) => e.type === "context_compaction_started"
    );
    const compactionCompletedEvents = emittedEvents.filter(
      (e) => e.type === "context_compaction_completed"
    );
    expect(compactionStartedEvents.length).toBeGreaterThanOrEqual(1);
    expect(compactionCompletedEvents.length).toBeGreaterThanOrEqual(1);

    // 4. Verify context build events and llm_request metrics
    const llmRequests = emittedEvents.filter((e) => e.type === "llm_request");
    expect(llmRequests.length).toBe(10);
    for (const req of llmRequests) {
      expect(req.data.estimated_input_tokens).toBeDefined();
      expect(req.data.context_budget).toBeDefined();
      expect(req.data.utilization).toBeDefined();
      // Utilization must never exceed 1.0 (100% budget)
      expect(Number(req.data.utilization)).toBeLessThanOrEqual(1.0);
    }

    // 5. Verify the disk state has the fixed file and tests pass
    const fixedContent = await fs.readFile(
      path.join(tempWorkspace, "calculator.js"),
      "utf-8"
    );
    expect(fixedContent).toContain("return a + b;");
    expect(fixedContent).not.toContain("return a - b;");

    const directOutput = execSync("node calculator.test.js", {
      cwd: tempWorkspace,
      encoding: "utf-8",
    });
    expect(directOutput).toContain("All calculator tests passed successfully!");
  });
});
