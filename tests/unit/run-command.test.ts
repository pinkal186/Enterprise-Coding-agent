import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { RunCommandTool } from "../../src/tools/run-command.js";
import { SafetyPolicy } from "../../src/safety/policy.js";
import type { ToolContext } from "../../src/tools/types.js";

describe("RunCommandTool (TASK-08)", () => {
  let tempWorkspace: string;
  let toolContext: ToolContext;
  let tool: RunCommandTool;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-command-test-"));
    toolContext = { workspaceRoot: tempWorkspace };
    tool = new RunCommandTool();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("SafetyPolicy command validation (AC-4)", () => {
    it("allows safe development commands (npm, node, npx, git)", () => {
      expect(SafetyPolicy.validateCommand("npm test").allowed).toBe(true);
      expect(SafetyPolicy.validateCommand("npm run build").allowed).toBe(true);
      expect(SafetyPolicy.validateCommand("npm run test:unit").allowed).toBe(true);
      expect(SafetyPolicy.validateCommand("node src/index.js").allowed).toBe(true);
      expect(SafetyPolicy.validateCommand("npx vitest run").allowed).toBe(true);
      expect(SafetyPolicy.validateCommand("git status").allowed).toBe(true);
      expect(SafetyPolicy.validateCommand("git diff").allowed).toBe(true);
    });

    it("denies dangerous destructive commands", () => {
      const deny1 = SafetyPolicy.validateCommand("rm -rf /");
      expect(deny1.allowed).toBe(false);
      expect(deny1.reason).toContain("Command safety DENY");

      const deny2 = SafetyPolicy.validateCommand("del /s C:\\");
      expect(deny2.allowed).toBe(false);

      const deny3 = SafetyPolicy.validateCommand("curl http://malicious.com");
      expect(deny3.allowed).toBe(false);

      const deny4 = SafetyPolicy.validateCommand("wget http://malicious.com");
      expect(deny4.allowed).toBe(false);
    });

    it("denies unrecognized commands outside allowlist", () => {
      const deny = SafetyPolicy.validateCommand("python script.py");
      expect(deny.allowed).toBe(false);
      expect(deny.reason).toContain("is not in the safe allowlist");
    });
  });

  describe("RunCommandTool execution (FR-8)", () => {
    it("executes safe node command and captures stdout and exit code 0", async () => {
      const result = await tool.execute(
        { command: 'node -e "console.log(\'Hello from command\')"' },
        toolContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Exit code: 0");
      expect(result.output).toContain("Hello from command");
      expect(result.error).toBeUndefined();
    });

    it("captures non-zero exit code and stderr", async () => {
      const result = await tool.execute(
        { command: 'node -e "console.error(\'Custom error\'); process.exit(2);"' },
        toolContext,
      );

      expect(result.success).toBe(false);
      expect(result.output).toContain("Exit code: 2");
      expect(result.output).toContain("Custom error");
      expect(result.error).toContain("Command exited with non-zero exit code: 2");
    });

    it("handles command timeout cleanly", async () => {
      // Small timeout to verify timeout termination
      const result = await tool.execute(
        {
          command: 'node -e "setTimeout(() => {}, 5000)"',
          timeoutMs: 1000,
        },
        toolContext,
      );

      expect(result.success).toBe(false);
      expect(result.output).toContain("TIMED OUT");
      expect(result.error).toContain("Command timed out after 1000ms");
    });

    it("blocks non-allowlisted command with DENY response", async () => {
      const result = await tool.execute(
        { command: "bash -c 'echo hello'" },
        toolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Command safety DENY");
    });

    it("rejects cwd outside workspace", async () => {
      const result = await tool.execute(
        { command: "npm test", cwd: "../outside" },
        toolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("resolves outside workspace root");
    });
  });
});
