import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentLoop, type AgentEvent } from "../../src/agent/loop.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { LLMProvider } from "../../src/llm/provider.js";
import type { LLMResponse, Message, ToolDefinition } from "../../src/llm/types.js";
import { z } from "zod";
import type { Tool } from "../../src/tools/types.js";

describe("AgentLoop (TASK-10)", () => {
  let mockProvider: LLMProvider;
  let registry: ToolRegistry;
  let events: AgentEvent[];

  const dummyEditTool: Tool<{ path: string; content: string }> = {
    name: "edit_file",
    description: "Edits a file",
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    getDefinition(): ToolDefinition {
      return {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "path" },
            content: { type: "string", description: "content" },
          },
          required: ["path", "content"],
        },
      };
    },
    async execute(input) {
      return { success: true, output: `Wrote to ${input.path}` };
    },
  };

  const dummyCommandTool: Tool<{ command: string }> = {
    name: "run_command",
    description: "Runs a command",
    inputSchema: z.object({ command: z.string() }),
    getDefinition(): ToolDefinition {
      return {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: { command: { type: "string", description: "cmd" } },
          required: ["command"],
        },
      };
    },
    async execute(input) {
      if (input.command.includes("fail")) {
        return { success: false, output: "", error: "Test failed" };
      }
      return { success: true, output: "All 5 tests passed" };
    },
  };

  const failingTool: Tool<{ arg: string }> = {
    name: "failing_tool",
    description: "Always fails",
    inputSchema: z.object({ arg: z.string() }),
    getDefinition(): ToolDefinition {
      return {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: { arg: { type: "string", description: "arg" } },
          required: ["arg"],
        },
      };
    },
    async execute() {
      return { success: false, output: "", error: "I/O error" };
    },
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    registry.register(dummyEditTool);
    registry.register(dummyCommandTool);
    registry.register(failingTool);
    events = [];
  });

  it("completes full autonomous flow with verification (FR-9 / AC-6)", async () => {
    const responses: LLMResponse[] = [
      // 1. Tool call: edit_file
      {
        type: "tool_call",
        toolCall: {
          id: "c1",
          toolName: "edit_file",
          arguments: { path: "src/calc.ts", content: "export function add(a, b) { return a + b; }" },
        },
      },
      // 2. Tool call: run_command (verification)
      {
        type: "tool_call",
        toolCall: {
          id: "c2",
          toolName: "run_command",
          arguments: { command: "npm test" },
        },
      },
      // 3. Final text summary
      {
        type: "text",
        text: "Fixed addition bug in src/calc.ts and all tests passed.",
      },
    ];

    mockProvider = {
      generate: vi.fn().mockImplementation(async () => responses.shift()!),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: registry,
      workspaceRoot: "/workspace",
      onEvent: (e) => events.push(e),
    });

    const state = await loop.run("Fix calculation bug");

    expect(state.status).toBe("completed");
    expect(state.verificationPassed).toBe(true);
    expect(state.iterationCount).toBe(3);
    expect(Array.from(state.modifiedFiles)).toEqual(["src/calc.ts"]);
    expect(state.finalAnswer).toBe("Fixed addition bug in src/calc.ts and all tests passed.");
    expect(events.some((e) => e.type === "task_completed")).toBe(true);
  });

  it("terminates when hard iteration cap is reached (FR-10 / AC-5)", async () => {
    mockProvider = {
      generate: vi.fn().mockResolvedValue({
        type: "tool_call",
        toolCall: {
          id: "c_loop",
          toolName: "edit_file",
          arguments: { path: "file.ts", content: "loop" },
        },
      }),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: registry,
      workspaceRoot: "/workspace",
      maxIterations: 5,
      onEvent: (e) => events.push(e),
    });

    const state = await loop.run("Infinite loop task");

    expect(state.status).toBe("failed");
    expect(state.failureReason).toBe("iteration_limit");
    expect(state.iterationCount).toBe(5);
    expect(events.some((e) => e.type === "task_failed")).toBe(true);
  });

  it("terminates when identical failing action repeats 3 consecutive times (AC-5)", async () => {
    mockProvider = {
      generate: vi.fn().mockResolvedValue({
        type: "tool_call",
        toolCall: {
          id: "c_fail",
          toolName: "failing_tool",
          arguments: { arg: "same_args" },
        },
      }),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: registry,
      workspaceRoot: "/workspace",
      maxConsecutiveFailures: 3,
      onEvent: (e) => events.push(e),
    });

    const state = await loop.run("Repeated failing task");

    expect(state.status).toBe("failed");
    expect(state.failureReason).toBe("repeated_failure");
    expect(state.iterationCount).toBe(3);
  });

  it("blocks completion without verification when files were edited (AC-6)", async () => {
    const responses: LLMResponse[] = [
      // 1. Edit file
      {
        type: "tool_call",
        toolCall: {
          id: "c1",
          toolName: "edit_file",
          arguments: { path: "src/calc.ts", content: "x" },
        },
      },
      // 2. Tries to finish immediately without verifying
      {
        type: "text",
        text: "I finished the edit.",
      },
      // 3. Tries to finish again
      {
        type: "text",
        text: "I am definitely done.",
      },
      // 4. Third attempt
      {
        type: "text",
        text: "Trust me I am done.",
      },
    ];

    mockProvider = {
      generate: vi.fn().mockImplementation(async () => responses.shift()!),
    };

    const loop = new AgentLoop({
      provider: mockProvider,
      toolRegistry: registry,
      workspaceRoot: "/workspace",
    });

    const state = await loop.run("Fix without test");

    expect(state.status).toBe("failed");
    expect(state.failureReason).toBe("verification_failed");
  });
});
