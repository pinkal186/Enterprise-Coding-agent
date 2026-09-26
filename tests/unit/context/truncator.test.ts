import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  TypeAwareTruncator,
  defaultTruncator,
  TRUNCATION_MARKER,
} from "../../../src/context/truncator.js";
import type { ContextItem } from "../../../src/context/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Provider isolation (NFR-1 / FR-17)
// ---------------------------------------------------------------------------

describe("Truncator — Provider Isolation (NFR-1 / FR-17)", () => {
  it("has zero imports from @google/genai or any other provider SDK", () => {
    const filePath = resolve(__dirname, "../../../src/context/truncator.ts");
    const content = readFileSync(filePath, "utf-8");

    expect(content).not.toContain("@google/genai");
    expect(content).not.toContain("google");
    expect(content).not.toContain("openai");
    expect(content).not.toContain("anthropic");
  });
});

// ---------------------------------------------------------------------------
// Core Truncation Behavior (TASK-18 / FR-17)
// ---------------------------------------------------------------------------

describe("Truncator — Core Specifications (Section 40)", () => {
  const truncator = defaultTruncator;

  it("Case 1: Input below limit remains unchanged", () => {
    const item: ContextItem = {
      id: "item-1",
      type: "user",
      content: "Short user task that easily fits.",
      importance: "critical",
      createdAt: 1000,
      tokenEstimate: 9,
    };

    const result = truncator.truncate(item, 50);

    expect(result.content).toBe(item.content);
    expect(result.truncated).toBeUndefined();
    expect(result.originalTokenEstimate).toBeUndefined();
    expect(result.id).toBe(item.id);
  });

  it("Case 2: Input above limit is truncated with truncated: true", () => {
    const longContent = "line of text to exceed budget\n".repeat(40);
    const item: ContextItem = {
      id: "item-2",
      type: "tool_result",
      content: longContent,
      importance: "normal",
      createdAt: 2000,
    };

    const maxTokens = 30;
    const result = truncator.truncate(item, maxTokens);

    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThan(item.content.length);
    expect(result.finalTokenEstimate).toBeDefined();
    expect(result.finalTokenEstimate).toBeLessThanOrEqual(maxTokens + 10); // accounts for marker
  });

  it("Case 3: Truncated result contains a clear truncation marker", () => {
    const item: ContextItem = {
      id: "item-3",
      type: "tool_result",
      content: "A".repeat(800),
      importance: "normal",
      createdAt: 3000,
    };

    const result = truncator.truncate(item, 25);

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("[result truncated");
  });

  it("Case 4: Original metadata is preserved and originalTokenEstimate > finalTokenEstimate", () => {
    const item: ContextItem = {
      id: "preserved-id-99",
      type: "tool_result",
      content: "Data content for testing metadata preservation. ".repeat(30),
      importance: "high",
      createdAt: 9999,
      source: {
        toolName: "read_file",
        filePath: "src/important.ts",
      },
      removable: true,
    };

    const result = truncator.truncate(item, 40);

    expect(result.id).toBe("preserved-id-99");
    expect(result.type).toBe("tool_result");
    expect(result.importance).toBe("high");
    expect(result.createdAt).toBe(9999);
    expect(result.source?.toolName).toBe("read_file");
    expect(result.source?.filePath).toBe("src/important.ts");
    expect(result.removable).toBe(true);

    expect(result.truncated).toBe(true);
    expect(result.originalTokenEstimate).toBeDefined();
    expect(result.finalTokenEstimate).toBeDefined();
    expect(result.originalTokenEstimate!).toBeGreaterThan(result.finalTokenEstimate!);
  });

  it("validates maxTokens is positive", () => {
    const item: ContextItem = {
      id: "1",
      type: "user",
      content: "test",
      importance: "normal",
      createdAt: 1,
    };

    expect(() => truncator.truncate(item, 0)).toThrow("maxTokens must be positive");
    expect(() => truncator.truncate(item, -5)).toThrow("maxTokens must be positive");
  });
});

// ---------------------------------------------------------------------------
// Type-Aware Strategies (Section 16)
// ---------------------------------------------------------------------------

describe("Truncator — Specialized Strategies (Section 16)", () => {
  const truncator = new TypeAwareTruncator();

  it("File content strategy: preserves whole lines starting from top", () => {
    const fileLines = [
      "import { foo } from 'bar';",
      "export function calculate() {",
      "  const a = 1;",
      "  const b = 2;",
      "  return a + b;",
      "}",
      "// Extra lines to push over limit",
      "console.log('extra 1');",
      "console.log('extra 2');",
      "console.log('extra 3');",
    ].join("\n");

    const item: ContextItem = {
      id: "file-item",
      type: "tool_result",
      content: fileLines,
      importance: "high",
      createdAt: 5000,
      source: { toolName: "read_file", filePath: "src/calculator.ts" },
    };

    const result = truncator.truncate(item, 25);

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("import { foo } from 'bar';");
    expect(result.content).toContain("[result truncated — file content exceeds budget]");
  });

  it("Search results strategy: preserves search result lines", () => {
    const searchOutput = [
      "Found 10 matches in 3 files:",
      "src/a.ts:1: function testA()",
      "src/a.ts:15: function testA2()",
      "src/b.ts:4: function testB()",
      "src/c.ts:8: function testC()",
      "src/c.ts:18: function testC2()",
      "src/c.ts:28: function testC3()",
      "src/c.ts:38: function testC4()",
    ].join("\n");

    const item: ContextItem = {
      id: "search-item",
      type: "tool_result",
      content: searchOutput,
      importance: "normal",
      createdAt: 6000,
      source: { toolName: "search_files" },
    };

    const result = truncator.truncate(item, 20);

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("Found 10 matches in 3 files:");
    expect(result.content).toContain("[result truncated — search results exceed budget]");
  });

  it("Command output strategy: preserves errors and test failure sections", () => {
    const commandLog = [
      "verbose step 1: initiating runner...",
      "verbose step 2: loading configuration...",
      "verbose step 3: compiling 14 files...",
      "verbose step 4: running suite...",
      "FAIL tests/unit/calculator.test.ts",
      "AssertionError: expected 5 to equal 6",
      "  at Object.<anonymous> (calculator.test.ts:12:10)",
      "Tests: 1 failed, 9 passed",
    ].join("\n");

    const item: ContextItem = {
      id: "cmd-item",
      type: "tool_result",
      content: commandLog,
      importance: "critical",
      createdAt: 7000,
      source: { toolName: "run_command", command: "npm test" },
    };

    const result = truncator.truncate(item, 35);

    expect(result.truncated).toBe(true);
    // Should preserve the failure information over the early verbose lines
    expect(result.content).toContain("FAIL tests/unit/calculator.test.ts");
    expect(result.content).toContain("AssertionError");
    expect(result.content).toContain("[... earlier output truncated ...]");
  });

  it("Command output strategy: preserves tail summary if no error keyword", () => {
    const normalOutput = [
      "building target 1/10...",
      "building target 2/10...",
      "building target 3/10...",
      "building target 4/10...",
      "building target 5/10...",
      "Done in 4.52s. All assets compiled cleanly.",
    ].join("\n");

    const item: ContextItem = {
      id: "build-item",
      type: "tool_result",
      content: normalOutput,
      importance: "normal",
      createdAt: 8000,
      source: { toolName: "run_command", command: "npm run build" },
    };

    const result = truncator.truncate(item, 20);

    expect(result.truncated).toBe(true);
    expect(result.content).toContain("All assets compiled cleanly.");
  });
});
