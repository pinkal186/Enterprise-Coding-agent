import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { Tool, ToolContext } from "../../src/tools/types.js";
import type { ToolDefinition } from "../../src/llm/types.js";

describe("ToolRegistry (TASK-04)", () => {
  const mockContext: ToolContext = {
    workspaceRoot: "/workspace/test-repo",
  };

  const sampleTool: Tool<{ path: string; count?: number }> = {
    name: "read_sample",
    description: "Reads sample file",
    inputSchema: z.object({
      path: z.string().min(1, "Path is required"),
      count: z.number().optional(),
    }),
    getDefinition(): ToolDefinition {
      return {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to read" },
            count: { type: "number", description: "Number of lines" },
          },
          required: ["path"],
        },
      };
    },
    async execute(input) {
      return {
        success: true,
        output: `Read ${input.path} with count ${input.count ?? 10}`,
      };
    },
  };

  const throwingTool: Tool<Record<string, unknown>> = {
    name: "throw_error",
    description: "Always throws",
    inputSchema: z.object({}),
    getDefinition(): ToolDefinition {
      return {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: {},
        },
      };
    },
    async execute() {
      throw new Error("Disk I/O failure");
    },
  };

  it("registers and retrieves tools by name", () => {
    const registry = new ToolRegistry();
    expect(registry.get("read_sample")).toBeUndefined();
    expect(registry.list()).toHaveLength(0);

    registry.register(sampleTool);

    expect(registry.get("read_sample")).toBe(sampleTool);
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0].name).toBe("read_sample");
  });

  it("rejects duplicate tool registration", () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool);

    expect(() => registry.register(sampleTool)).toThrowError(
      "Tool with name 'read_sample' is already registered",
    );
  });

  it("rejects invalid tool without a name", () => {
    const registry = new ToolRegistry();
    expect(() => registry.register({} as any)).toThrowError("Tool name must be a non-empty string");
  });

  it("returns formatted ToolDefinitions for all registered tools", () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool);
    registry.register(throwingTool);

    const definitions = registry.getDefinitions();
    expect(definitions).toHaveLength(2);
    expect(definitions[0].name).toBe("read_sample");
    expect(definitions[0].parameters.required).toEqual(["path"]);
    expect(definitions[1].name).toBe("throw_error");
  });

  it("executes registered tool successfully with valid input", async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool);

    const result = await registry.execute(
      "read_sample",
      { path: "src/main.ts", count: 5 },
      mockContext,
      "call_123",
    );

    expect(result.toolCallId).toBe("call_123");
    expect(result.success).toBe(true);
    expect(result.output).toBe("Read src/main.ts with count 5");
    expect(result.error).toBeUndefined();
  });

  it("returns structured error when tool is not found", async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool);

    const result = await registry.execute(
      "non_existent",
      { foo: "bar" },
      mockContext,
      "call_404",
    );

    expect(result.toolCallId).toBe("call_404");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Tool 'non_existent' not found");
    expect(result.error).toContain("read_sample");
  });

  it("validates inputs and returns structured error for schema mismatch", async () => {
    const registry = new ToolRegistry();
    registry.register(sampleTool);

    // Missing required 'path' parameter
    const result = await registry.execute(
      "read_sample",
      { count: "not-a-number" as any },
      mockContext,
      "call_invalid",
    );

    expect(result.toolCallId).toBe("call_invalid");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid arguments for tool 'read_sample'");
    expect(result.error).toContain("path");
  });

  it("safely catches and structures unexpected runtime exceptions in tool execution", async () => {
    const registry = new ToolRegistry();
    registry.register(throwingTool);

    const result = await registry.execute("throw_error", {}, mockContext, "call_throw");

    expect(result.toolCallId).toBe("call_throw");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Error executing tool 'throw_error': Disk I/O failure");
  });
});
