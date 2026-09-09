/**
 * Gemini LLM Provider Adapter
 *
 * Implements the LLMProvider interface for Google Gemini using the @google/genai SDK.
 * INVARIANT: This is the ONLY file in the entire repository that imports @google/genai.
 */

import { GoogleGenAI } from "@google/genai";
import type {
  LLMProvider,
  GenerateOptions,
} from "./provider.js";
import {
  ProviderError,
  type Message,
  type ToolDefinition,
  type LLMResponse,
  type UsageInfo,
  type ProviderErrorType,
} from "./types.js";

// Default model to use when not specified
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export interface GeminiProviderOptions {
  /** API Key for Google Gen AI. Falls back to process.env.GEMINI_API_KEY */
  apiKey?: string;
  /** Default model identifier */
  defaultModel?: string;
  /** Optional custom client instance for testing/dependency injection */
  client?: GoogleGenAI;
}

export class GeminiProvider implements LLMProvider {
  private readonly client: GoogleGenAI;
  private readonly defaultModel: string;

  constructor(options: GeminiProviderOptions = {}) {
    const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
    this.defaultModel = options.defaultModel || DEFAULT_GEMINI_MODEL;

    if (options.client) {
      this.client = options.client;
    } else {
      this.client = new GoogleGenAI({ apiKey: apiKey || "" });
    }
  }

  /**
   * Main entry point for generating responses from Gemini.
   */
  async generate(
    messages: Message[],
    tools: ToolDefinition[] = [],
    options: GenerateOptions = {},
  ): Promise<LLMResponse> {
    const apiKey = (this.client as unknown as { apiKey?: string }).apiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ProviderError({
        message: "GEMINI_API_KEY is not set. Please provide a valid Gemini API key.",
        type: "authentication",
        retryable: false,
        provider: "gemini",
      });
    }

    const model = options.model || this.defaultModel;

    try {
      // 1. Extract system instruction and convert remaining messages to Gemini contents format
      const { systemInstruction, contents } = this.translateMessages(messages);

      // 2. Build configuration (tools, temperature, maxOutputTokens, systemInstruction)
      const config: Record<string, unknown> = {};

      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }

      if (typeof options.temperature === "number") {
        config.temperature = options.temperature;
      }

      if (typeof options.maxOutputTokens === "number") {
        config.maxOutputTokens = options.maxOutputTokens;
      }

      if (tools.length > 0) {
        config.tools = [
          {
            functionDeclarations: this.translateTools(tools),
          },
        ];
      }

      // 3. Call the Gemini API via @google/genai SDK
      const response = await this.client.models.generateContent({
        model,
        contents,
        config,
      });

      // 4. Translate response to internal LLMResponse format
      return this.translateResponse(response);
    } catch (err: unknown) {
      if (err instanceof ProviderError) {
        throw err;
      }
      throw this.normalizeError(err);
    }
  }

  /**
   * Translate internal Message[] into Gemini contents and system instruction.
   */
  private translateMessages(messages: Message[]): {
    systemInstruction?: string;
    contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
  } {
    const systemParts: string[] = [];
    const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        if (msg.content) {
          systemParts.push(msg.content);
        }
        continue;
      }

      if (msg.role === "user") {
        contents.push({
          role: "user",
          parts: [{ text: msg.content || "" }],
        });
        continue;
      }

      if (msg.role === "assistant") {
        const parts: Array<Record<string, unknown>> = [];

        if (msg.content) {
          parts.push({ text: msg.content });
        }

        if (msg.toolCall) {
          parts.push({
            functionCall: {
              name: msg.toolCall.toolName,
              args: msg.toolCall.arguments || {},
              id: msg.toolCall.id,
            },
          });
        }

        if (parts.length === 0) {
          parts.push({ text: "" });
        }

        contents.push({
          role: "model",
          parts,
        });
        continue;
      }

      if (msg.role === "tool") {
        if (msg.toolResult) {
          contents.push({
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: msg.toolResult.toolCallId,
                  response: {
                    success: msg.toolResult.success,
                    output: msg.toolResult.output,
                    ...(msg.toolResult.error ? { error: msg.toolResult.error } : {}),
                  },
                },
              },
            ],
          });
        } else {
          contents.push({
            role: "user",
            parts: [{ text: msg.content || "" }],
          });
        }
        continue;
      }
    }

    const systemInstruction = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
    return { systemInstruction, contents };
  }

  /**
   * Translate internal ToolDefinition[] to Gemini function declarations.
   */
  private translateTools(tools: ToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map((tool) => {
      const properties: Record<string, unknown> = {};

      for (const [key, prop] of Object.entries(tool.parameters.properties || {})) {
        properties[key] = {
          type: prop.type.toUpperCase(),
          description: prop.description,
          ...(prop.enum ? { enum: prop.enum } : {}),
        };
      }

      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "OBJECT",
          properties,
          ...(tool.parameters.required && tool.parameters.required.length > 0
            ? { required: tool.parameters.required }
            : {}),
        },
      };
    });
  }

  /**
   * Translate Gemini SDK response to internal LLMResponse.
   */
  private translateResponse(response: unknown): LLMResponse {
    const resp = response as {
      text?: string;
      functionCalls?: Array<{
        name: string;
        args?: Record<string, unknown>;
        arguments?: Record<string, unknown>;
        id?: string;
      }>;
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            functionCall?: {
              name: string;
              args?: Record<string, unknown>;
              arguments?: Record<string, unknown>;
              id?: string;
            };
          }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    // Extract usage
    let usage: UsageInfo | undefined;
    if (resp.usageMetadata) {
      usage = {
        inputTokens: resp.usageMetadata.promptTokenCount,
        outputTokens: resp.usageMetadata.candidatesTokenCount,
        totalTokens: resp.usageMetadata.totalTokenCount,
      };
    }

    // Check for function calls via getter or candidates
    let functionCallData:
      | {
          name: string;
          args?: Record<string, unknown>;
          arguments?: Record<string, unknown>;
          id?: string;
        }
      | undefined;

    if (resp.functionCalls && resp.functionCalls.length > 0) {
      functionCallData = resp.functionCalls[0];
    } else if (resp.candidates && resp.candidates.length > 0) {
      const candidate = resp.candidates[0];
      const part = candidate.content?.parts?.find((p) => p.functionCall);
      if (part?.functionCall) {
        functionCallData = part.functionCall;
      }
    }

    if (functionCallData) {
      return {
        type: "tool_call",
        toolCall: {
          id:
            functionCallData.id ||
            `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          toolName: functionCallData.name,
          arguments: functionCallData.args || functionCallData.arguments || {},
        },
        usage,
      };
    }

    // Default to text response
    let text = "";
    if (typeof resp.text === "string") {
      text = resp.text;
    } else if (resp.candidates && resp.candidates.length > 0) {
      const parts = resp.candidates[0].content?.parts || [];
      text = parts
        .map((p) => p.text || "")
        .filter(Boolean)
        .join("");
    }

    return {
      type: "text",
      text,
      usage,
    };
  }

  /**
   * Normalizes any SDK or network error into a structured ProviderError.
   */
  private normalizeError(err: unknown): ProviderError {
    const error = err as {
      message?: string;
      status?: number;
      statusCode?: number;
      code?: string | number;
      error?: {
        code?: number;
        message?: string;
        status?: string;
      };
    };

    const message =
      error.error?.message ||
      error.message ||
      (typeof err === "string" ? err : "Unknown Gemini error");

    const status = error.status || error.statusCode || error.error?.code || 0;
    const msgLower = message.toLowerCase();

    let type: ProviderErrorType = "unknown";
    let retryable = false;

    if (
      status === 401 ||
      status === 403 ||
      msgLower.includes("api_key_invalid") ||
      msgLower.includes("api key not valid") ||
      msgLower.includes("unauthenticated") ||
      msgLower.includes("permission_denied")
    ) {
      type = "authentication";
      retryable = false;
    } else if (
      status === 429 ||
      msgLower.includes("resource_exhausted") ||
      msgLower.includes("rate limit") ||
      msgLower.includes("quota exceeded")
    ) {
      type = "rate_limit";
      retryable = true;
    } else if (
      msgLower.includes("token limit") ||
      msgLower.includes("context length") ||
      msgLower.includes("maximum context") ||
      msgLower.includes("prompt is too long")
    ) {
      type = "context_overflow";
      retryable = false;
    } else if (
      status === 400 ||
      msgLower.includes("invalid_argument") ||
      msgLower.includes("bad request")
    ) {
      type = "invalid_request";
      retryable = false;
    } else if (
      status === 500 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      msgLower.includes("internal server error") ||
      msgLower.includes("service unavailable")
    ) {
      type = "provider_error";
      retryable = true;
    } else if (
      msgLower.includes("econnreset") ||
      msgLower.includes("etimedout") ||
      msgLower.includes("fetch failed") ||
      msgLower.includes("network") ||
      msgLower.includes("enotfound")
    ) {
      type = "network";
      retryable = true;
    }

    return new ProviderError({
      message,
      type,
      retryable,
      provider: "gemini",
      cause: err,
    });
  }
}
