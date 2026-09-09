/**
 * Tool system types and interfaces.
 *
 * Defines the contract for all executable tools in the engineering agent.
 */

import { z } from "zod";
import type { ToolDefinition, ToolResult } from "../llm/types.js";

/**
 * Execution context passed to each tool invocation.
 */
export interface ToolContext {
  /** Absolute path to the allowed workspace root */
  workspaceRoot: string;
  /** Optional cancellation signal */
  abortSignal?: AbortSignal;
}

/**
 * Interface that every concrete tool must implement.
 */
export interface Tool<TInput = unknown> {
  /** Unique name matching tool call requests (e.g. "read_file", "search_files") */
  readonly name: string;
  /** Clear natural language description for the model */
  readonly description: string;
  /** Zod schema for input argument validation */
  readonly inputSchema: z.ZodType<TInput>;
  /** Returns the LLM-compatible ToolDefinition format */
  getDefinition(): ToolDefinition;
  /** Executes the tool action within the given context */
  execute(input: TInput, context: ToolContext): Promise<Omit<ToolResult, "toolCallId">>;
}
