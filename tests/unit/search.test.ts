import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { SearchTool } from "../../src/tools/search.js";
import type { ToolContext } from "../../src/tools/types.js";

describe("SearchTool (TASK-06)", () => {
  let tempWorkspace: string;
  let toolContext: ToolContext;
  let tool: SearchTool;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "agent-search-test-"));
    toolContext = { workspaceRoot: tempWorkspace };
    tool = new SearchTool();

    // Create test files
    await fs.mkdir(path.join(tempWorkspace, "src"), { recursive: true });
    await fs.mkdir(path.join(tempWorkspace, "node_modules", "pkg"), { recursive: true });
    await fs.mkdir(path.join(tempWorkspace, ".git"), { recursive: true });

    await fs.writeFile(
      path.join(tempWorkspace, "src", "index.ts"),
      "export function calculateTotal(items: number[]) {\n  return items.reduce((a, b) => a + b, 0);\n}",
      "utf-8",
    );

    await fs.writeFile(
      path.join(tempWorkspace, "src", "utils.ts"),
      "// Helper utilities\nexport const MAX_RETRIES = 5;\nexport function calculateAverage() {}\n",
      "utf-8",
    );

    // Ignored directories should not be searched
    await fs.writeFile(
      path.join(tempWorkspace, "node_modules", "pkg", "index.js"),
      "export function calculateTotal() {}",
      "utf-8",
    );

    await fs.writeFile(
      path.join(tempWorkspace, ".git", "config"),
      "calculateTotal",
      "utf-8",
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(tempWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("finds matching occurrences in workspace files", async () => {
    const result = await tool.execute({ query: "calculateTotal" }, toolContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/index.ts:1: export function calculateTotal");
    // Ensure node_modules and .git were ignored
    expect(result.output).not.toContain("node_modules");
    expect(result.output).not.toContain(".git");
  });

  it("supports case-insensitive substring search", async () => {
    const result = await tool.execute(
      { query: "calculatetotal", caseSensitive: false },
      toolContext,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/index.ts:1: export function calculateTotal");
  });

  it("supports regex pattern matching", async () => {
    const result = await tool.execute(
      { query: "calculate(Total|Average)", isRegex: true },
      toolContext,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/index.ts:1: export function calculateTotal");
    expect(result.output).toContain("src/utils.ts:3: export function calculateAverage");
  });

  it("filters by filePattern when specified", async () => {
    const result = await tool.execute(
      { query: "calculate", filePattern: "utils.ts" },
      toolContext,
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/utils.ts:3: export function calculateAverage");
    expect(result.output).not.toContain("src/index.ts");
  });

  it("returns clear message when no matches are found", async () => {
    const result = await tool.execute({ query: "non_existent_symbol_xyz" }, toolContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("No matches found for 'non_existent_symbol_xyz'");
  });

  it("enforces maxResults limit and adds truncation notice", async () => {
    const testFilePath = path.join(tempWorkspace, "src", "repeat.ts");
    const lines = Array.from({ length: 30 }, (_, i) => `const targetItem_${i} = ${i};`);
    await fs.writeFile(testFilePath, lines.join("\n"), "utf-8");

    const result = await tool.execute({ query: "targetItem", maxResults: 5 }, toolContext);

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/repeat.ts:1: const targetItem_0 = 0;");
    expect(result.output).toContain("src/repeat.ts:5: const targetItem_4 = 4;");
    expect(result.output).not.toContain("src/repeat.ts:6:");
    expect(result.output).toContain("[... Truncated: showing first 5 matching occurrences ...]");
  });

  it("rejects search paths outside workspace root", async () => {
    const result = await tool.execute({ query: "test", path: "../outside" }, toolContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("resolves outside workspace root");
  });
});
