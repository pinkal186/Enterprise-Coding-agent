import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { AgentLoop } from "../../src/agent/loop.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { ReadFileTool } from "../../src/tools/read-file.js";
import { SearchTool } from "../../src/tools/search.js";
import { EditFileTool } from "../../src/tools/edit-file.js";
import { RunCommandTool } from "../../src/tools/run-command.js";
import type { LLMProvider } from "../../src/llm/provider.js";
import type { LLMResponse } from "../../src/llm/types.js";

describe("Autonomous Agent Integration (TASK-13 / AC-8)", () => {
  let tempWorkspace: string;
  const fixtureDir = path.resolve(process.cwd(), "tests/fixtures/test-project");

  beforeEach(async () => {
    // 1. Create a fresh temporary workspace for this test run
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-integration-test-"));

    // 2. Copy test fixture files into temporary workspace
    const files = await fs.readdir(fixtureDir);
    for (const file of files) {
      const srcPath = path.join(fixtureDir, file);
      const destPath = path.join(tempWorkspace, file);
      await fs.copyFile(srcPath, destPath);
    }
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("proves the calculator test initially fails before any agent intervention", () => {
    expect(() => {
      execSync("node calculator.test.js", {
        cwd: tempWorkspace,
        stdio: "pipe",
      });
    }).toThrow();
  });

  it("autonomously inspects, edits, tests, and fixes the calculator bug", async () => {
    // Register real tool implementations
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new SearchTool());
    registry.register(new EditFileTool());
    registry.register(new RunCommandTool());

    // Deterministic LLM response sequence simulating model reasoning and tool calling
    const responses: LLMResponse[] = [
      // 1. Model searches for calculator test
      {
        type: "tool_call",
        toolCall: {
          id: "call_search",
          toolName: "search_files",
          arguments: { query: "add(" },
        },
      },
      // 2. Model reads calculator.js
      {
        type: "tool_call",
        toolCall: {
          id: "call_read",
          toolName: "read_file",
          arguments: { path: "calculator.js" },
        },
      },
      // 3. Model fixes the subtraction bug using edit_file replace
      {
        type: "tool_call",
        toolCall: {
          id: "call_edit",
          toolName: "edit_file",
          arguments: {
            path: "calculator.js",
            operation: "replace",
            target: "return a - b;",
            replacement: "return a + b;",
          },
        },
      },
      // 4. Model runs the verification command
      {
        type: "tool_call",
        toolCall: {
          id: "call_verify",
          toolName: "run_command",
          arguments: { command: "node calculator.test.js" },
        },
      },
      // 5. Model produces final summary
      {
        type: "text",
        text: "I identified the bug in calculator.js where addition was performing subtraction. I updated the add function to return a + b and ran the tests. All calculator tests pass.",
      },
    ];

    const mockProvider: LLMProvider = {
      generate: vi.fn().mockImplementation(async () => responses.shift()!),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: registry,
      workspaceRoot: tempWorkspace,
      verificationCommandPattern: /calculator\.test\.js|test/i,
    });

    // Run the agent loop on the task
    const state = await loop.run(
      "Fix the failing calculator tests in calculator.test.js",
      "integration_task_1",
    );

    // 1. Verify agent state
    expect(state.status).toBe("completed");
    expect(state.verificationPassed).toBe(true);
    expect(state.iterationCount).toBe(5);
    expect(Array.from(state.modifiedFiles)).toContain("calculator.js");

    // 2. Verify modified file content directly on disk
    const fixedContent = await fs.readFile(
      path.join(tempWorkspace, "calculator.js"),
      "utf-8",
    );
    expect(fixedContent).toContain("return a + b;");
    expect(fixedContent).not.toContain("return a - b;");

    // 3. INDEPENDENT VERIFICATION (AC-8):
    // Execute the test script directly from node without relying on agent's self-report
    const testOutput = execSync("node calculator.test.js", {
      cwd: tempWorkspace,
      encoding: "utf-8",
    });

    expect(testOutput).toContain("All calculator tests passed successfully!");
  });
});
