/**
 * Central Tool Registry
 *
 * Manages tool registration, lookup, schema validation, and invocation.
 */

import type { ToolDefinition, ToolResult } from "../llm/types.js";
import type { Tool, ToolContext } from "./types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<unknown>>();

  /**
   * Registers a tool. Throws if a tool with the same name already exists.
   */
  register(tool: Tool<unknown>): void {
    if (!tool.name || typeof tool.name !== "string") {
      throw new Error("Tool name must be a non-empty string");
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name '${tool.name}' is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Retrieves a registered tool by name.
   */
  get(name: string): Tool<unknown> | undefined {
    return this.tools.get(name);
  }

  /**
   * Returns all registered tools.
   */
  list(): Tool<unknown>[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns tool definitions formatted for passing to LLMProvider.
   */
  getDefinitions(): ToolDefinition[] {
    return this.list().map((tool) => tool.getDefinition());
  }

  /**
   * Validates arguments with Zod and executes the specified tool.
   * Never throws uncaught errors — captures failures into structured ToolResult.
   */
  async execute(
    name: string,
    rawArgs: Record<string, unknown>,
    context: ToolContext,
    toolCallId: string = `call_${Date.now()}`,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        toolCallId,
        success: false,
        output: "",
        error: `Tool '${name}' not found. Available tools: ${Array.from(this.tools.keys()).join(", ") || "none"}`,
      };
    }

    // Validate inputs using the tool's Zod schema
    const parseResult = tool.inputSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const formattedErrors = parseResult.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ");
      return {
        toolCallId,
        success: false,
        output: "",
        error: `Invalid arguments for tool '${name}': ${formattedErrors}`,
      };
    }

    try {
      const result = await tool.execute(parseResult.data, context);
      return {
        toolCallId,
        success: result.success,
        output: result.output,
        ...(result.error ? { error: result.error } : {}),
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err) || "Unknown tool execution error";
      return {
        toolCallId,
        success: false,
        output: "",
        error: `Error executing tool '${name}': ${errorMessage}`,
      };
    }
  }
}
