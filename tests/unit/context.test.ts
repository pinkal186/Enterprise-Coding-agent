import { describe, it, expect } from "vitest";
import { ContextManager, DEFAULT_SYSTEM_PROMPT } from "../../src/context/context.js";
import { TaskState } from "../../src/agent/state.js";
import type { Message, ToolResult } from "../../src/llm/types.js";

describe("ContextManager & TaskState (TASK-09)", () => {
  describe("TaskState (FR-11)", () => {
    it("initializes default state and tracks events", () => {
      const state = new TaskState({
        userRequest: "Fix the calculation bug",
        workspaceRoot: "/workspace/project",
      });

      expect(state.taskId).toBeDefined();
      expect(state.status).toBe("idle");
      expect(state.iterationCount).toBe(0);
      expect(state.verificationPassed).toBe(false);

      // Record file modification
      state.recordFileModification("src/calc.ts");
      state.recordFileModification("src/calc.ts"); // duplicate
      expect(Array.from(state.modifiedFiles)).toEqual(["src/calc.ts"]);

      // Record command execution
      state.recordCommandExecution("npm test", 0, true);
      expect(state.executedCommands).toHaveLength(1);
      expect(state.executedCommands[0].command).toBe("npm test");

      // Record token usage
      state.recordTokenUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
      expect(state.tokenUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      // Mark verified and complete
      state.markVerified(true);
      state.complete("All tests passing.");
      expect(state.status).toBe("completed");
      expect(state.verificationPassed).toBe(true);
      expect(state.finalAnswer).toBe("All tests passing.");
    });

    it("records failure with specific reason", () => {
      const state = new TaskState({
        userRequest: "Impossible task",
        workspaceRoot: "/workspace",
      });

      state.fail("iteration_limit", "Hit max iterations");
      expect(state.status).toBe("failed");
      expect(state.failureReason).toBe("iteration_limit");
      expect(state.finalAnswer).toBe("Hit max iterations");
    });
  });

  describe("ContextManager (NFR-4)", () => {
    it("assembles messages with default system prompt and user request", () => {
      const manager = new ContextManager();
      const messages = manager.assemble("Write unit tests");

      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toBe(DEFAULT_SYSTEM_PROMPT);
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toBe("Write unit tests");
    });

    it("assembles message history without duplicating system prompt", () => {
      const manager = new ContextManager();
      const history: Message[] = [
        { role: "user", content: "Fix bug" },
        {
          role: "assistant",
          content: "I will read the file",
          toolCall: { id: "c1", toolName: "read_file", arguments: { path: "a.ts" } },
        },
        {
          role: "tool",
          content: "1: const x = 1;",
          toolResult: { toolCallId: "c1", success: true, output: "1: const x = 1;" },
        },
      ];

      const messages = manager.assemble("Fix bug", history);

      expect(messages).toHaveLength(4);
      expect(messages[0].role).toBe("system");
      expect(messages[1].role).toBe("user");
      expect(messages[2].role).toBe("assistant");
      expect(messages[3].role).toBe("tool");
    });

    it("caps oversized tool output and appends truncation note (NFR-4)", () => {
      const manager = new ContextManager({ maxContentBytes: 100 });
      const hugeOutput = "A".repeat(500);

      const toolResult: ToolResult = {
        toolCallId: "call_large",
        success: true,
        output: hugeOutput,
      };

      const msg = manager.createToolResultMessage(toolResult);

      expect(msg.role).toBe("tool");
      expect(msg.content.length).toBeLessThan(200);
      expect(msg.content).toContain("[... Tool output truncated by context manager ...]");
    });
  });
});
