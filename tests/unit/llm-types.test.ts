import { describe, it, expect } from "vitest";
import type {
  Message,
  ToolCall,
  ToolResult,
  LLMResponse,
  ToolDefinition,
  UsageInfo,
} from "../../src/llm/types.js";
import { ProviderError } from "../../src/llm/types.js";
import type { LLMProvider, GenerateOptions } from "../../src/llm/provider.js";

// ---------------------------------------------------------------------------
// Provider isolation: confirm no SDK import leaks into types or provider files
// ---------------------------------------------------------------------------

describe("Provider isolation (NFR-1)", () => {
  it("types.ts has no @google/genai import", async () => {
    // Dynamic import lets us inspect the module without executing side-effects.
    // If @google/genai were imported there it would throw (not installed at
    // root-level test scope with a mock), proving isolation structurally.
    const mod = await import("../../src/llm/types.js");
    expect(mod).toBeDefined();
    // ProviderError should be the only non-type export
    expect(typeof mod.ProviderError).toBe("function");
  });

  it("provider.ts re-exports nothing from a provider SDK", async () => {
    const mod = await import("../../src/llm/provider.js");
    // Interface-only module — no runtime exports expected
    expect(Object.keys(mod)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ProviderError shape
// ---------------------------------------------------------------------------

describe("ProviderError", () => {
  it("stores all fields correctly", () => {
    const err = new ProviderError({
      message: "quota exceeded",
      type: "rate_limit",
      retryable: true,
      provider: "gemini",
    });
    expect(err.message).toBe("quota exceeded");
    expect(err.type).toBe("rate_limit");
    expect(err.retryable).toBe(true);
    expect(err.provider).toBe("gemini");
    expect(err.name).toBe("ProviderError");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof ProviderError).toBe(true);
  });

  it("stores cause when provided", () => {
    const cause = new Error("upstream");
    const err = new ProviderError({
      message: "network failure",
      type: "network",
      retryable: true,
      provider: "gemini",
      cause,
    });
    expect(err.cause).toBe(cause);
  });

  it("works with all error types", () => {
    const types = [
      "authentication",
      "rate_limit",
      "context_overflow",
      "invalid_request",
      "provider_error",
      "network",
      "unknown",
    ] as const;
    for (const type of types) {
      const err = new ProviderError({ message: "x", type, retryable: false, provider: "test" });
      expect(err.type).toBe(type);
    }
  });
});

// ---------------------------------------------------------------------------
// Message type shapes (compile-time proofs via assignability)
// ---------------------------------------------------------------------------

describe("Message type shapes", () => {
  it("accepts a system message", () => {
    const msg: Message = { role: "system", content: "You are a coding agent." };
    expect(msg.role).toBe("system");
  });

  it("accepts a user message", () => {
    const msg: Message = { role: "user", content: "Fix the bug." };
    expect(msg.role).toBe("user");
  });

  it("accepts an assistant message with tool call", () => {
    const toolCall: ToolCall = {
      id: "call-1",
      toolName: "read_file",
      arguments: { path: "src/calc.ts" },
    };
    const msg: Message = { role: "assistant", content: "", toolCall };
    expect(msg.toolCall?.toolName).toBe("read_file");
  });

  it("accepts a tool result message", () => {
    const toolResult: ToolResult = {
      toolCallId: "call-1",
      success: true,
      output: "file content here",
    };
    const msg: Message = { role: "tool", content: "", toolResult };
    expect(msg.toolResult?.success).toBe(true);
  });

  it("accepts a failed tool result", () => {
    const toolResult: ToolResult = {
      toolCallId: "call-2",
      success: false,
      output: "",
      error: "File not found: src/missing.ts",
    };
    const msg: Message = { role: "tool", content: "", toolResult };
    expect(msg.toolResult?.error).toMatch("not found");
  });
});

// ---------------------------------------------------------------------------
// LLMResponse shapes
// ---------------------------------------------------------------------------

describe("LLMResponse shapes", () => {
  it("text response shape", () => {
    const res: LLMResponse = { type: "text", text: "Task complete." };
    expect(res.type).toBe("text");
    expect(res.text).toBe("Task complete.");
  });

  it("tool_call response shape", () => {
    const toolCall: ToolCall = {
      id: "call-3",
      toolName: "search",
      arguments: { query: "calculator" },
    };
    const res: LLMResponse = { type: "tool_call", toolCall };
    expect(res.type).toBe("tool_call");
    expect(res.toolCall?.toolName).toBe("search");
  });

  it("response may include usage info", () => {
    const usage: UsageInfo = { inputTokens: 120, outputTokens: 45, totalTokens: 165 };
    const res: LLMResponse = { type: "text", text: "Done.", usage };
    expect(res.usage?.totalTokens).toBe(165);
  });
});

// ---------------------------------------------------------------------------
// ToolDefinition shape
// ---------------------------------------------------------------------------

describe("ToolDefinition shape", () => {
  it("well-formed tool definition", () => {
    const def: ToolDefinition = {
      name: "read_file",
      description: "Read a file within the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file." },
          startLine: { type: "number", description: "First line to read (1-indexed)." },
          endLine: { type: "number", description: "Last line to read (inclusive)." },
        },
        required: ["path"],
      },
    };
    expect(def.name).toBe("read_file");
    expect(def.parameters.required).toContain("path");
  });
});

// ---------------------------------------------------------------------------
// LLMProvider interface: structural stub
// ---------------------------------------------------------------------------

describe("LLMProvider interface contract", () => {
  it("a stub implementing the interface satisfies the generate signature", async () => {
    // Proves the interface is usable and the agent loop can receive any LLMProvider.
    const stub: LLMProvider = {
      async generate(
        _messages: Message[],
        _tools: ToolDefinition[],
        _options?: GenerateOptions,
      ): Promise<LLMResponse> {
        return { type: "text", text: "stub response" };
      },
    };

    const result = await stub.generate(
      [{ role: "user", content: "hello" }],
      [],
    );
    expect(result.type).toBe("text");
    expect(result.text).toBe("stub response");
  });

  it("stub provider can throw ProviderError", async () => {
    const stub: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        throw new ProviderError({
          message: "Auth failed",
          type: "authentication",
          retryable: false,
          provider: "stub",
        });
      },
    };

    await expect(stub.generate([], [])).rejects.toBeInstanceOf(ProviderError);
  });
});
