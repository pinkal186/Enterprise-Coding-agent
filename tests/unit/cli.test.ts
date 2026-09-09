import { describe, it, expect, vi } from "vitest";
import { parseCliArgs, formatEventMessage, runCli } from "../../src/cli/runner.js";
import path from "path";

describe("CLI Runner (TASK-11)", () => {
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
    });

    it("handles short flags (-w, -m, -h)", () => {
      const args = ["-w", "./sub", "-m", "gemini-2.5-pro", "-h"];
      const parsed = parseCliArgs(args);

      expect(parsed.workspace).toBe(path.resolve("./sub"));
      expect(parsed.model).toBe("gemini-2.5-pro");
      expect(parsed.showHelp).toBe(true);
    });

    it("defaults workspace to cwd and model to default when omitted", () => {
      const parsed = parseCliArgs(["Do something"]);

      expect(parsed.task).toBe("Do something");
      expect(parsed.workspace).toBe(process.cwd());
      expect(parsed.model).toBe("gemini-2.5-flash");
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
  });

  describe("runCli behavior", () => {
    it("shows help and exits 0 when --help is passed", async () => {
      const logs: string[] = [];
      const logger = { log: (m: string) => logs.push(m), error: () => {} };

      const result = await runCli(["--help"], {}, logger);

      expect(result.exitCode).toBe(0);
      expect(logs.some((l) => l.includes("Usage:"))).toBe(true);
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
