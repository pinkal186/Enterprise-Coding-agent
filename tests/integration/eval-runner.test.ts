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

interface TaskMetadata {
  id: string;
  name: string;
  category: string;
  verificationCommand: string;
  successCriteria: string;
}

describe("Evaluation Tasks Runner (TASK-14 / AC-9)", () => {
  let tempWorkspace: string;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-eval-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  async function setupWorkspace(taskId: string): Promise<string> {
    const taskSourceDir = path.resolve(process.cwd(), "eval/tasks", taskId);
    const files = await fs.readdir(taskSourceDir);
    for (const file of files) {
      if (file === "result.json") continue;
      const src = path.join(taskSourceDir, file);
      const dest = path.join(tempWorkspace, file);
      await fs.copyFile(src, dest);
    }
    return taskSourceDir;
  }

  function createToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new SearchTool());
    registry.register(new EditFileTool());
    registry.register(new RunCommandTool());
    return registry;
  }

  // --- TASK 1: Pagination off-by-one ---
  it("evaluates task-1: pagination off-by-one bug", async () => {
    const taskSourceDir = await setupWorkspace("task-1");

    // Verify initially failing
    expect(() => {
      execSync("node test.js", { cwd: tempWorkspace, stdio: "pipe" });
    }).toThrow();

    const responses: LLMResponse[] = [
      {
        type: "tool_call",
        toolCall: {
          id: "t1_read",
          toolName: "read_file",
          arguments: { path: "paginate.js" },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "t1_edit",
          toolName: "edit_file",
          arguments: {
            path: "paginate.js",
            operation: "replace",
            target: "const start = page * pageSize;",
            replacement: "const start = (page - 1) * pageSize;",
          },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "t1_verify",
          toolName: "run_command",
          arguments: { command: "node test.js" },
        },
      },
      {
        type: "text",
        text: "Fixed the off-by-one index in paginate.js. All tests pass.",
      },
    ];

    const mockProvider: LLMProvider = {
      generate: vi.fn().mockImplementation(async () => responses.shift()!),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: createToolRegistry(),
      workspaceRoot: tempWorkspace,
      verificationCommandPattern: /test\.js/i,
    });

    const state = await loop.run("Fix paginate bug", "task-1");
    expect(state.status).toBe("completed");
    expect(state.verificationPassed).toBe(true);

    // Independent verification
    const testOut = execSync("node test.js", { cwd: tempWorkspace, encoding: "utf-8" });
    expect(testOut).toContain("Task 1 tests passed!");

    // Save logged result
    const result = {
      taskId: "task-1",
      status: state.status,
      verified: state.verificationPassed,
      iterations: state.iterationCount,
      modifiedFiles: Array.from(state.modifiedFiles),
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(tempWorkspace, "result.json"),
      JSON.stringify(result, null, 2),
      "utf-8",
    );
  });

  // --- TASK 2: URL Slugifier ---
  it("evaluates task-2: url slugifier bug", async () => {
    const taskSourceDir = await setupWorkspace("task-2");

    expect(() => {
      execSync("node test.js", { cwd: tempWorkspace, stdio: "pipe" });
    }).toThrow();

    const responses: LLMResponse[] = [
      {
        type: "tool_call",
        toolCall: {
          id: "t2_read",
          toolName: "read_file",
          arguments: { path: "slugify.js" },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "t2_edit",
          toolName: "edit_file",
          arguments: {
            path: "slugify.js",
            operation: "replace",
            target: 'return text.trim().replace(/\\s+/g, "_");',
            replacement: 'return text.trim().toLowerCase().replace(/\\s+/g, "-");',
          },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "t2_verify",
          toolName: "run_command",
          arguments: { command: "node test.js" },
        },
      },
      {
        type: "text",
        text: "Updated slugify to lowercase and replace spaces with hyphens.",
      },
    ];

    const mockProvider: LLMProvider = {
      generate: vi.fn().mockImplementation(async () => responses.shift()!),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: createToolRegistry(),
      workspaceRoot: tempWorkspace,
      verificationCommandPattern: /test\.js/i,
    });

    const state = await loop.run("Fix slugify", "task-2");
    expect(state.status).toBe("completed");
    expect(state.verificationPassed).toBe(true);

    const testOut = execSync("node test.js", { cwd: tempWorkspace, encoding: "utf-8" });
    expect(testOut).toContain("Task 2 tests passed!");

    const result = {
      taskId: "task-2",
      status: state.status,
      verified: state.verificationPassed,
      iterations: state.iterationCount,
      modifiedFiles: Array.from(state.modifiedFiles),
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(tempWorkspace, "result.json"),
      JSON.stringify(result, null, 2),
      "utf-8",
    );
  });

  // --- TASK 3: Truncate function implementation ---
  it("evaluates task-3: truncate function implementation", async () => {
    const taskSourceDir = await setupWorkspace("task-3");

    expect(() => {
      execSync("node test.js", { cwd: tempWorkspace, stdio: "pipe" });
    }).toThrow();

    const responses: LLMResponse[] = [
      {
        type: "tool_call",
        toolCall: {
          id: "t3_read",
          toolName: "read_file",
          arguments: { path: "truncate.js" },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "t3_edit",
          toolName: "edit_file",
          arguments: {
            path: "truncate.js",
            operation: "write",
            content: `export function truncate(str, maxLength, suffix = "...") {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + suffix;
}
`,
          },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "t3_verify",
          toolName: "run_command",
          arguments: { command: "node test.js" },
        },
      },
      {
        type: "text",
        text: "Implemented truncate function with custom suffix support.",
      },
    ];

    const mockProvider: LLMProvider = {
      generate: vi.fn().mockImplementation(async () => responses.shift()!),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: createToolRegistry(),
      workspaceRoot: tempWorkspace,
      verificationCommandPattern: /test\.js/i,
    });

    const state = await loop.run("Implement truncate", "task-3");
    expect(state.status).toBe("completed");
    expect(state.verificationPassed).toBe(true);

    const testOut = execSync("node test.js", { cwd: tempWorkspace, encoding: "utf-8" });
    expect(testOut).toContain("Task 3 tests passed!");

    const result = {
      taskId: "task-3",
      status: state.status,
      verified: state.verificationPassed,
      iterations: state.iterationCount,
      modifiedFiles: Array.from(state.modifiedFiles),
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(tempWorkspace, "result.json"),
      JSON.stringify(result, null, 2),
      "utf-8",
    );
  });

  // --- TASK 4: Safe nested property getter ---
  it("evaluates task-4: safe deep property getter", async () => {
    const taskSourceDir = await setupWorkspace("task-4");

    expect(() => {
      execSync("node test.js", { cwd: tempWorkspace, stdio: "pipe" });
    }).toThrow();

    const responses: LLMResponse[] = [
      {
        type: "tool_call",
        toolCall: {
          id: "t4_read",
          toolName: "read_file",
          arguments: { path: "get.js" },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "t4_edit",
          toolName: "edit_file",
          arguments: {
            path: "get.js",
            operation: "write",
            content: `export function safeGet(obj, path, defaultValue = undefined) {
  if (obj === null || obj === undefined) return defaultValue;
  const keys = path.split(".");
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) {
      return defaultValue;
    }
    current = current[key];
  }
  return current !== undefined ? current : defaultValue;
}
`,
          },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "t4_verify",
          toolName: "run_command",
          arguments: { command: "node test.js" },
        },
      },
      {
        type: "text",
        text: "Refactored safeGet to guard against null and undefined intermediates.",
      },
    ];

    const mockProvider: LLMProvider = {
      generate: vi.fn().mockImplementation(async () => responses.shift()!),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: createToolRegistry(),
      workspaceRoot: tempWorkspace,
      verificationCommandPattern: /test\.js/i,
    });

    const state = await loop.run("Fix safeGet null safety", "task-4");
    expect(state.status).toBe("completed");
    expect(state.verificationPassed).toBe(true);

    const testOut = execSync("node test.js", { cwd: tempWorkspace, encoding: "utf-8" });
    expect(testOut).toContain("Task 4 tests passed!");

    const result = {
      taskId: "task-4",
      status: state.status,
      verified: state.verificationPassed,
      iterations: state.iterationCount,
      modifiedFiles: Array.from(state.modifiedFiles),
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(tempWorkspace, "result.json"),
      JSON.stringify(result, null, 2),
      "utf-8",
    );
  });

  // --- TASK 5: Numeric sorting comparator ---
  it("evaluates task-5: numeric sorting comparator", async () => {
    const taskSourceDir = await setupWorkspace("task-5");

    expect(() => {
      execSync("node test.js", { cwd: tempWorkspace, stdio: "pipe" });
    }).toThrow();

    const responses: LLMResponse[] = [
      {
        type: "tool_call",
        toolCall: {
          id: "t5_read",
          toolName: "read_file",
          arguments: { path: "sort.js" },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "t5_edit",
          toolName: "edit_file",
          arguments: {
            path: "sort.js",
            operation: "replace",
            target: "return [...arr].sort();",
            replacement: "return [...arr].sort((a, b) => a - b);",
          },
        },
      },
      {
        type: "tool_call",
        toolCall: {
          id: "t5_verify",
          toolName: "run_command",
          arguments: { command: "node test.js" },
        },
      },
      {
        type: "text",
        text: "Provided numerical comparator (a, b) => a - b to sortNumbers.",
      },
    ];

    const mockProvider: LLMProvider = {
      generate: vi.fn().mockImplementation(async () => responses.shift()!),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: createToolRegistry(),
      workspaceRoot: tempWorkspace,
      verificationCommandPattern: /test\.js/i,
    });

    const state = await loop.run("Fix numeric sorting", "task-5");
    expect(state.status).toBe("completed");
    expect(state.verificationPassed).toBe(true);

    const testOut = execSync("node test.js", { cwd: tempWorkspace, encoding: "utf-8" });
    expect(testOut).toContain("Task 5 tests passed!");

    const result = {
      taskId: "task-5",
      status: state.status,
      verified: state.verificationPassed,
      iterations: state.iterationCount,
      modifiedFiles: Array.from(state.modifiedFiles),
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(tempWorkspace, "result.json"),
      JSON.stringify(result, null, 2),
      "utf-8",
    );
  });
});
