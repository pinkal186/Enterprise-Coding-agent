/**
 * LLM provider interface — the only contract the agent loop speaks to.
 *
 * INVARIANT: The agent loop, tools, CLI, and context manager must import
 * only this interface — never a concrete adapter. Adapters implement this
 * interface; the agent loop receives one through dependency injection.
 */

import type {
  LLMResponse,
  Message,
  ToolDefinition,
} from "./types.js";

// ---------------------------------------------------------------------------
// Generation options
// ---------------------------------------------------------------------------

export interface GenerateOptions {
  /** Model identifier (e.g. "gemini-2.5-flash"). Falls back to provider default. */
  model?: string;
  /**
   * Sampling temperature in [0, 2].
   * Lower values → more deterministic; higher → more creative.
   */
  temperature?: number;
  /** Hard cap on output tokens — provider clips silently if exceeded. */
  maxOutputTokens?: number;
}

// ---------------------------------------------------------------------------
// LLM provider interface
// ---------------------------------------------------------------------------

export interface LLMProvider {
  /**
   * Send a conversation and optional tool definitions to the model.
   *
   * @param messages  Full conversation history (system + user + assistant + tool).
   * @param tools     Definitions of tools the model may call. Empty array = no tools.
   * @param options   Optional generation parameters.
   * @returns         A normalised LLMResponse (text or tool_call).
   * @throws          ProviderError on any provider-level failure.
   */
  generate(
    messages: Message[],
    tools: ToolDefinition[],
    options?: GenerateOptions,
  ): Promise<LLMResponse>;
}
