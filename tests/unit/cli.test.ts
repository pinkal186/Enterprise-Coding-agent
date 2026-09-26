import { describe, it, expect, vi } from "vitest";
import {
  parseCliArgs,
  formatEventMessage,
  formatContextDebug,
  redactDebugOutput,
  runCli,
} from "../../src/cli/runner.js";
import path from "path";

describe("CLI Runner (TASK-11 & TASK-25)", () => {
  describe("parseCliArgs", () => {
    it("parses task, workspace, and model arguments correctly", () => {
      const args = [
        "Fix the failing test",
        "--workspace",
        "./tests/fixtures/test-project",
        "--model",
        "gemini-2.5-flash",
      ];

      const parsed = parseCliArgs(args);

      expect(parsed.task).toBe("Fix the failing test");
      expect(parsed.workspace).toBe(path.resolve("./tests/fixtures/test-project"));
      expect(parsed.model).toBe("gemini-2.5-flash");
      expect(parsed.showHelp).toBe(false);
      expect(parsed.debugContext).toBe(false);
    });

    it("handles short flags (-w, -m, -h)", () => {
      const args = ["-w", "./sub", "-m", "gemini-2.5-pro", "-h"];
      const parsed = parseCliArgs(args);

      expect(parsed.workspace).toBe(path.resolve("./sub"));
      expect(parsed.model).toBe("gemini-2.5-pro");
      expect(parsed.showHelp).toBe(true);
      expect(parsed.debugContext).toBe(false);
    });

    it("parses --debug-context flag correctly (FR-27)", () => {
      const args = ["Fix the failing test", "--debug-context"];
      const parsed = parseCliArgs(args);

      expect(parsed.task).toBe("Fix the failing test");
      expect(parsed.debugContext).toBe(true);
    });

    it("defaults workspace to cwd, model to default, and debugContext to false when omitted", () => {
      const parsed = parseCliArgs(["Do something"]);

      expect(parsed.task).toBe("Do something");
      expect(parsed.workspace).toBe(process.cwd());
      expect(parsed.model).toBe("gemini-2.5-flash");
      expect(parsed.debugContext).toBe(false);
    });
  });

  describe("formatEventMessage", () => {
    it("formats lifecycle events into human-readable strings", () => {
      const msgStarted = formatEventMessage({
        type: "task_started",
        taskId: "t1",
        timestamp: Date.now(),
        data: { userRequest: "Fix bug", workspaceRoot: "/workspace" },
      });
      expect(msgStarted).toContain("Task started");
      expect(msgStarted).toContain("Fix bug");

      const msgTool = formatEventMessage({
        type: "tool_requested",
        taskId: "t1",
        timestamp: Date.now(),
        data: { toolName: "read_file", arguments: { path: "a.ts" } },
      });
      expect(msgTool).toContain("Tool Call -> read_file");

      const msgVerify = formatEventMessage({
        type: "verification_completed",
        taskId: "t1",
        timestamp: Date.now(),
        data: { command: "npm test", passed: true },
      });
      expect(msgVerify).toContain("Verification (npm test): PASSED");
    });

    it("formats context events into human-readable strings (FR-26, AC-15)", () => {
      const msgBuild = formatEventMessage({
        type: "context_build_completed",
        taskId: "t1",
        timestamp: Date.now(),
        data: { estimatedTokens: 4200, utilization: 0.15 },
      });
      expect(msgBuild).toContain("Context build completed");
      expect(msgBuild).toContain("4200 tokens");
      expect(msgBuild).toContain("15.0% utilization");

      const msgCompact = formatEventMessage({
        type: "context_compaction_completed",
        taskId: "t1",
        timestamp: Date.now(),
        data: { tokensBefore: 28000, tokensAfter: 8000 },
      });
      expect(msgCompact).toContain("Context compaction completed");
      expect(msgCompact).toContain("28000 -> 8000 tokens");

      const msgTrunc = formatEventMessage({
        type: "context_item_truncated",
        taskId: "t1",
        timestamp: Date.now(),
        data: { itemId: "item-1", originalTokenEstimate: 5000, finalTokenEstimate: 2000 },
      });
      expect(msgTrunc).toContain("Context item truncated");
      expect(msgTrunc).toContain("5000 -> 2000 tokens");

      const msgDrop = formatEventMessage({
        type: "context_item_dropped",
        taskId: "t1",
        timestamp: Date.now(),
        data: { itemId: "item-2", importance: "low" },
      });
      expect(msgDrop).toContain("Context item dropped");
      expect(msgDrop).toContain("[LOW]");
    });
  });

  describe("formatContextDebug (FR-27, AC-15)", () => {
    it("formats per-item priority and disposition correctly without compaction", () => {
      const debugData = {
        estimated_input_tokens: 8420,
        context_budget: 28000,
        utilization: 0.301,
        items: [
          { importance: "critical", description: "User task", disposition: "INCLUDED" },
          { importance: "critical", description: "Current task state", disposition: "INCLUDED" },
          { importance: "high", description: "src/calculator.ts", disposition: "INCLUDED" },
          { importance: "high", description: "Latest test result", disposition: "INCLUDED" },
          { importance: "normal", description: "Search result", disposition: "INCLUDED" },
          { importance: "low", description: "Previous search result", disposition: "DROPPED" },
        ],
      };

      const formatted = formatContextDebug(debugData);

      expect(formatted).toContain("--- Context Debug ---");
      expect(formatted).toContain("Items: 6");
      expect(formatted).toContain("Estimated tokens: 8420");
      expect(formatted).toContain("Budget: 28000");
      expect(formatted).toContain("Utilization: 30.1%");
      expect(formatted).toContain("No compaction required.");
      expect(formatted).toContain("[CRITICAL] User task");
      expect(formatted).toContain("[CRITICAL] Current task state");
      expect(formatted).toContain("[HIGH] src/calculator.ts");
      expect(formatted).toContain("[HIGH] Latest test result");
      expect(formatted).toContain("[NORMAL] Search result");
      expect(formatted).toContain("[LOW] Previous search result [DROPPED]");
    });

    it("formats compaction details when compaction occurred", () => {
      const debugData = {
        estimated_input_tokens: 8100,
        context_budget: 28000,
        utilization: 0.289,
        compaction: {
          tokensBefore: 27900,
          tokensAfter: 8100,
        },
        items: [
          { importance: "critical", description: "User task", disposition: "INCLUDED" },
          { importance: "normal", description: "Compacted summary", disposition: "INCLUDED" },
        ],
      };

      const formatted = formatContextDebug(debugData);

      expect(formatted).toContain("Compaction:");
      expect(formatted).toContain("Before: 27900 tokens");
      expect(formatted).toContain("Compacted: 19800 tokens");
      expect(formatted).toContain("After: 8100 tokens");
    });

    it("strictly redacts sensitive tokens and API keys in debug context (AC-15)", () => {
      const fakeKey = "AIzaSyD-SecretApiKey12345678901234";
      const debugData = {
        estimated_input_tokens: 1000,
        context_budget: 28000,
        utilization: 0.05,
        items: [
          {
            importance: "critical",
            description: `User task with key: ${fakeKey}`,
            disposition: "INCLUDED",
          },
        ],
      };

      const formatted = formatContextDebug(debugData, [fakeKey]);

      expect(formatted).not.toContain(fakeKey);
      expect(formatted).toContain("[REDACTED]");
    });
  });

  describe("runCli behavior", () => {
    it("shows help and exits 0 when --help is passed", async () => {
      const logs: string[] = [];
      const logger = { log: (m: string) => logs.push(m), error: () => {} };

      const result = await runCli(["--help"], {}, logger);

      expect(result.exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Usage:"))).toBe(true);
      expect(logs.some((l) => l.includes("--debug-context"))).toBe(true);
    });

    it("returns exit code 1 when task string is missing", async () => {
      const errors: string[] = [];
      const logger = { log: () => {}, error: (e: string) => errors.push(e) };

      const result = await runCli([], {}, logger);

      expect(result.exitCode).toBe(0); // empty args shows help (exit code 0)

      const result2 = await runCli(["--workspace", "./foo"], {}, logger);
      expect(result2.exitCode).toBe(1);
      expect(errors.some((e) => e.includes("Task description is required"))).toBe(true);
    });

    it("returns exit code 1 when GEMINI_API_KEY is not set", async () => {
      const errors: string[] = [];
      const logger = { log: () => {}, error: (e: string) => errors.push(e) };

      const result = await runCli(["Fix bug"], { GEMINI_API_KEY: "" }, logger);

      expect(result.exitCode).toBe(1);
      expect(errors.some((e) => e.includes("GEMINI_API_KEY"))).toBe(true);
    });
  });
});
