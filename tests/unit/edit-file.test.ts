import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { EditFileTool } from "../../src/tools/edit-file.js";
import type { ToolContext } from "../../src/tools/types.js";

describe("EditFileTool (TASK-07)", () => {
  let tempWorkspace: string;
  let toolContext: ToolContext;
  let tool: EditFileTool;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-edit-test-"));
    toolContext = { workspaceRoot: tempWorkspace };
    tool = new EditFileTool();
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("write operation", () => {
    it("creates a new file and any missing parent directories", async () => {
      const result = await tool.execute(
        {
          path: "src/nested/module.ts",
          operation: "write",
          content: "export const answer = 42;\n",
        },
        toolContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Successfully wrote");

      const saved = await fs.readFile(
        path.join(tempWorkspace, "src", "nested", "module.ts"),
        "utf-8",
      );
      expect(saved).toBe("export const answer = 42;\n");
    });

    it("overwrites an existing file", async () => {
      const filePath = path.join(tempWorkspace, "config.json");
      await fs.writeFile(filePath, '{"version": 1}', "utf-8");

      const result = await tool.execute(
        {
          path: "config.json",
          operation: "write",
          content: '{"version": 2}',
        },
        toolContext,
      );

      expect(result.success).toBe(true);
      const saved = await fs.readFile(filePath, "utf-8");
      expect(saved).toBe('{"version": 2}');
    });

    it("fails when content is missing for write", async () => {
      const result = await tool.execute(
        {
          path: "test.txt",
          operation: "write",
        },
        toolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Field 'content' is required");
    });
  });

  describe("replace operation", () => {
    it("successfully replaces an exact unique occurrence", async () => {
      const filePath = path.join(tempWorkspace, "code.ts");
      await fs.writeFile(
        filePath,
        "function add(a: number, b: number) {\n  return a - b; // Bug\n}\n",
        "utf-8",
      );

      const result = await tool.execute(
        {
          path: "code.ts",
          operation: "replace",
          target: "return a - b; // Bug",
          replacement: "return a + b;",
        },
        toolContext,
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("Successfully replaced target text");

      const updated = await fs.readFile(filePath, "utf-8");
      expect(updated).toBe("function add(a: number, b: number) {\n  return a + b;\n}\n");
    });

    it("fails when target text is not found in file", async () => {
      const filePath = path.join(tempWorkspace, "code.ts");
      await fs.writeFile(filePath, "const x = 10;\n", "utf-8");

      const result = await tool.execute(
        {
          path: "code.ts",
          operation: "replace",
          target: "const y = 20;",
          replacement: "const y = 30;",
        },
        toolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Target text not found in 'code.ts'");
    });

    it("fails when target text is ambiguous (appears multiple times)", async () => {
      const filePath = path.join(tempWorkspace, "repeat.txt");
      await fs.writeFile(filePath, "hello world\nhello world\n", "utf-8");

      const result = await tool.execute(
        {
          path: "repeat.txt",
          operation: "replace",
          target: "hello world",
          replacement: "greetings world",
        },
        toolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("found 2 times in 'repeat.txt'");
      expect(result.error).toContain("include more surrounding context");
    });

    it("fails when attempting replace on non-existent file", async () => {
      const result = await tool.execute(
        {
          path: "missing.ts",
          operation: "replace",
          target: "foo",
          replacement: "bar",
        },
        toolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("File not found: 'missing.ts'");
    });
  });

  describe("workspace sandboxing (NFR-2 / AC-3)", () => {
    it("rejects write outside workspace", async () => {
      const result = await tool.execute(
        {
          path: "../escape.txt",
          operation: "write",
          content: "malicious",
        },
        toolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("resolves outside workspace root");
    });

    it("rejects replace outside workspace", async () => {
      const result = await tool.execute(
        {
          path: "../../system.ini",
          operation: "replace",
          target: "a",
          replacement: "b",
        },
        toolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("resolves outside workspace root");
    });
  });
});
