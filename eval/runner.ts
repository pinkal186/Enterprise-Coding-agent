/**
 * Standalone Evaluation Runner in TypeScript
 *
 * Runs evaluation tasks against the agent loop and records results.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { AgentLoop } from "../src/agent/loop.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { ReadFileTool } from "../src/tools/read-file.js";
import { SearchTool } from "../src/tools/search.js";
import { EditFileTool } from "../src/tools/edit-file.js";
import { RunCommandTool } from "../src/tools/run-command.js";
import type { LLMResponse } from "../src/llm/types.js";
import type { LLMProvider } from "../src/llm/provider.js";

const TASK_ACTIONS: Record<string, LLMResponse[]> = {
  "task-1": [
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
  ],
  "task-2": [
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
  ],
  "task-3": [
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
          content: `export function truncate(str, maxLength, suffix = "...") {\n  if (str.length <= maxLength) return str;\n  return str.slice(0, maxLength) + suffix;\n}\n`,
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
  ],
  "task-4": [
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
          content: `export function safeGet(obj, path, defaultValue = undefined) {\n  if (obj === null || obj === undefined) return defaultValue;\n  const keys = path.split(".");\n  let current = obj;\n  for (const key of keys) {\n    if (current === null || current === undefined) return defaultValue;\n    current = current[key];\n  }\n  return current !== undefined ? current : defaultValue;\n}\n`,
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
  ],
  "task-5": [
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
  ],
};

async function runTask(taskId: string): Promise<boolean> {
  const normalizedId = taskId.startsWith("task-") ? taskId : `task-${taskId}`;
  const taskSourceDir = path.resolve(process.cwd(), "eval/tasks", normalizedId);
  const tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), `eval-${normalizedId}-`));

  console.log(`\n======================================================`);
  console.log(`Running evaluation for: ${normalizedId}`);
  console.log(`Workspace: ${tempWorkspace}`);

  try {
    const files = await fs.readdir(taskSourceDir);
    for (const file of files) {
      if (file === "result.json") continue;
      await fs.copyFile(path.join(taskSourceDir, file), path.join(tempWorkspace, file));
    }

    const actions = [...(TASK_ACTIONS[normalizedId] || [])];
    if (actions.length === 0) {
      throw new Error(`No scripted actions defined for ${normalizedId}`);
    }

    const mockProvider: LLMProvider = {
      async generate() {
        return actions.shift()!;
      },
    };

    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new SearchTool());
    registry.register(new EditFileTool());
    registry.register(new RunCommandTool());

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: registry,
      workspaceRoot: tempWorkspace,
      verificationCommandPattern: /test\.js/i,
    });

    const requestContent = await fs.readFile(path.join(taskSourceDir, "request.txt"), "utf-8");
    const state = await loop.run(requestContent, normalizedId);

    const testOut = execSync("node test.js", { cwd: tempWorkspace, encoding: "utf-8" });
    console.log(`Verification Output: ${testOut.trim()}`);

    const result = {
      taskId: normalizedId,
      status: state.status,
      verified: state.verificationPassed,
      iterations: state.iterationCount,
      modifiedFiles: Array.from(state.modifiedFiles),
      timestamp: new Date().toISOString(),
    };

    await fs.writeFile(
      path.join(taskSourceDir, "result.json"),
      JSON.stringify(result, null, 2),
      "utf-8",
    );

    console.log(`Evaluation ${normalizedId}: PASSED (status: ${state.status}, verified: ${state.verificationPassed})`);
    console.log(`======================================================\n`);
    return true;
  } catch (err: unknown) {
    console.error(`Evaluation ${normalizedId} FAILED:`, err instanceof Error ? err.message : String(err));
    return false;
  } finally {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {}
  }
}

async function main() {
  const args = process.argv.slice(2);
  let targetTask = "task-1";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--task" && i + 1 < args.length) {
      targetTask = args[i + 1];
      i++;
    } else if (args[i] === "--all") {
      targetTask = "all";
    }
  }

  if (targetTask === "all") {
    let allPassed = true;
    for (let i = 1; i <= 5; i++) {
      const passed = await runTask(`task-${i}`);
      if (!passed) allPassed = false;
    }
    process.exit(allPassed ? 0 : 1);
  } else {
    const passed = await runTask(targetTask);
    process.exit(passed ? 0 : 1);
  }
}

main().catch((err: unknown) => {
  console.error("Runner error:", err);
  process.exit(1);
});
