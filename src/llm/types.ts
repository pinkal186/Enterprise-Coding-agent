/**
 * Internal LLM types — provider-independent.
 *
 * INVARIANT: No provider SDK (e.g. @google/genai, openai) may be imported here.
 * The Gemini adapter (src/llm/gemini.ts) is the only file that translates
 * between these types and provider-specific wire formats.
 */

// ---------------------------------------------------------------------------
// Message roles
// ---------------------------------------------------------------------------

export type MessageRole = "system" | "user" | "assistant" | "tool";

// ---------------------------------------------------------------------------
// Tool call — issued by the model inside an assistant message
// ---------------------------------------------------------------------------

export interface ToolCall {
  /** Unique identifier for this call within a conversation turn. */
  id: string;
  /** Matches a registered tool name exactly. */
  toolName: string;
  /** Parsed arguments object; keys depend on the tool's input schema. */
  arguments: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool result — returned to the model after tool execution
// ---------------------------------------------------------------------------

export interface ToolResult {
  /** Must match the ToolCall.id this result answers. */
  toolCallId: string;
  /** Whether the tool executed without error. */
  success: boolean;
  /** Stringified output (may be truncated by the tool itself). */
  output: string;
  /** Structured error description when success === false. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Conversation message
// ---------------------------------------------------------------------------

export interface Message {
  role: MessageRole;
  /** Text content of the message (may be empty when toolCall or toolResult is set). */
  content: string;
  /** Present on assistant messages when the model requested a tool. */
  toolCall?: ToolCall;
  /** Present on tool messages carrying the result back to the model. */
  toolResult?: ToolResult;
}

// ---------------------------------------------------------------------------
// Tool definition — supplied to the LLM so it knows what tools are available
// ---------------------------------------------------------------------------

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, {
    type: string;
    description: string;
    enum?: string[];
  }>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

// ---------------------------------------------------------------------------
// LLM response
// ---------------------------------------------------------------------------

export type LLMResponseType = "text" | "tool_call";

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LLMResponse {
  /** Whether the model produced a text reply or requested a tool. */
  type: LLMResponseType;
  /** Present when type === "text". */
  text?: string;
  /** Present when type === "tool_call". */
  toolCall?: ToolCall;
  /** Token usage metadata — available from most providers. */
  usage?: UsageInfo;
}

// ---------------------------------------------------------------------------
// Provider error — normalised across all adapters
// ---------------------------------------------------------------------------

export type ProviderErrorType =
  | "authentication"
  | "rate_limit"
  | "context_overflow"
  | "invalid_request"
  | "provider_error"
  | "network"
  | "unknown";

export class ProviderError extends Error {
  readonly type: ProviderErrorType;
  /** True when the caller may safely retry after a brief delay. */
  readonly retryable: boolean;
  readonly provider: string;

  constructor(opts: {
    message: string;
    type: ProviderErrorType;
    retryable: boolean;
    provider: string;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "ProviderError";
    this.type = opts.type;
    this.retryable = opts.retryable;
    this.provider = opts.provider;
    if (opts.cause) this.cause = opts.cause;
  }
}
