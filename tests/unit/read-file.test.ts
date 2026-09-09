import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { ReadFileTool } from "../../src/tools/read-file.js";
import { SafetyPolicy } from "../../src/safety/policy.js";
import type { ToolContext } from "../../src/tools/types.js";

describe("ReadFileTool & SafetyPolicy (TASK-05)", () => {
  let tempWorkspace: string;
  let toolContext: ToolContext;
  let tool: ReadFileTool;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-workspace-test-"));
    toolContext = { workspaceRoot: tempWorkspace };
    tool = new ReadFileTool();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("SafetyPolicy workspace boundary validation (NFR-2 / AC-3)", () => {
    it("allows paths inside workspace", () => {
      const res = SafetyPolicy.validateWorkspacePath(tempWorkspace, "src/index.ts");
      expect(res.allowed).toBe(true);
      expect(res.resolvedPath).toBe(path.resolve(tempWorkspace, "src/index.ts"));
    });

    it("rejects path traversal attempting to escape workspace", () => {
      const res = SafetyPolicy.validateWorkspacePath(tempWorkspace, "../../etc/passwd");
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("resolves outside workspace root");
    });

    it("rejects absolute paths pointing outside workspace", () => {
      const outsidePath = path.resolve(tempWorkspace, "../outside-file.txt");
      const res = SafetyPolicy.validateWorkspacePath(tempWorkspace, outsidePath);
      expect(res.allowed).toBe(false);
      expect(res.reason).toContain("resolves outside workspace root");
    });

    it("rejects empty paths", () => {
      const res = SafetyPolicy.validateWorkspacePath(tempWorkspace, "");
      expect(res.allowed).toBe(false);
    });
  });

  describe("ReadFileTool execution (FR-6)", () => {
    it("reads full file with line numbers", async () => {
      const testFilePath = path.join(tempWorkspace, "hello.txt");
      await fs.writeFile(testFilePath, "line one\nline two\nline three", "utf-8");

      const result = await tool.execute({ path: "hello.txt" }, toolContext);

      expect(result.success).toBe(true);
      expect(result.output).toBe("1: line one\n2: line two\n3: line three");
      expect(result.error).toBeUndefined();
    });

    it("reads specific line range", async () => {
      const testFilePath = path.join(tempWorkspace, "lines.txt");
      const lines = Array.from({ length: 20 }, (_, i) => `content ${i + 1}`);
      await fs.writeFile(testFilePath, lines.join("\n"), "utf-8");

      const result = await tool.execute(
        { path: "lines.txt", startLine: 5, endLine: 7 },
        toolContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("5: content 5\n6: content 6\n7: content 7");
      expect(result.output).toContain("[... Truncated: showing lines 5-7 of 20 total lines ...]");
    });

    it("caps max lines and shows truncation note", async () => {
      const testFilePath = path.join(tempWorkspace, "large.txt");
      const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
      await fs.writeFile(testFilePath, lines.join("\n"), "utf-8");

      const result = await tool.execute(
        { path: "large.txt", startLine: 1, maxLines: 10 },
        toolContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("1: line 1");
      expect(result.output).toContain("10: line 10");
      expect(result.output).not.toContain("11: line 11");
      expect(result.output).toContain("[... Truncated: showing lines 1-10 of 50 total lines ...]");
    });

    it("returns error for non-existent file", async () => {
      const result = await tool.execute({ path: "missing.txt" }, toolContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found: 'missing.txt'");
    });

    it("returns error when target path is a directory", async () => {
      const dirPath = path.join(tempWorkspace, "subfolder");
      await fs.mkdir(dirPath);

      const result = await tool.execute({ path: "subfolder" }, toolContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("is a directory, not a file");
    });

    it("rejects reading outside workspace with structured error", async () => {
      const result = await tool.execute({ path: "../outside.txt" }, toolContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("resolves outside workspace root");
    });
  });
});
