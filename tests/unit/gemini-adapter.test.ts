import { describe, it, expect, vi, beforeEach } from "vitest";
import { GeminiProvider, DEFAULT_GEMINI_MODEL } from "../../src/llm/gemini.js";
import { ProviderError, type Message, type ToolDefinition } from "../../src/llm/types.js";
import fs from "fs";
import path from "path";

describe("GeminiProvider (TASK-03)", () => {
  let mockGenerateContent: ReturnType<typeof vi.fn>;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContent = vi.fn();
    mockClient = {
      apiKey: "test-api-key",
      models: {
        generateContent: mockGenerateContent,
      },
    };
  });

  describe("NFR-1: Provider Isolation", () => {
    it("confirms @google/genai is only imported in src/llm/gemini.ts", () => {
      const srcDir = path.resolve(process.cwd(), "src");
      const files: string[] = [];

      function walk(dir: string) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
            files.push(fullPath);
          }
        }
      }

      walk(srcDir);

      const violatingFiles: string[] = [];
      const importRegex = /(?:from\s+['"]@google\/genai['"]|require\(['"]@google\/genai['"]\)|import\(['"]@google\/genai['"]\))/;
      for (const file of files) {
        const content = fs.readFileSync(file, "utf-8");
        const relPath = path.relative(process.cwd(), file).replace(/\\/g, "/");
        if (relPath !== "src/llm/gemini.ts" && importRegex.test(content)) {
          violatingFiles.push(relPath);
        }
      }

      expect(violatingFiles).toEqual([]);
    });
  });

  describe("Text generation response", () => {
    it("translates simple text response and usage metadata", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: "Here is the solution to your issue.",
        usageMetadata: {
          promptTokenCount: 120,
          candidatesTokenCount: 45,
          totalTokenCount: 165,
        },
      });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });
      const messages: Message[] = [{ role: "user", content: "Fix the bug in index.ts" }];

      const response = await provider.generate(messages);

      expect(response.type).toBe("text");
      expect(response.text).toBe("Here is the solution to your issue.");
      expect(response.toolCall).toBeUndefined();
      expect(response.usage).toEqual({
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165,
      });

      // Verify the call to generateContent
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(callArgs.contents).toEqual([
        { role: "user", parts: [{ text: "Fix the bug in index.ts" }] },
      ]);
    });

    it("falls back to candidate text parts if text property is empty", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [{ text: "Candidate " }, { text: "part text" }],
            },
          },
        ],
      });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });
      const response = await provider.generate([{ role: "user", content: "Hello" }]);

      expect(response.type).toBe("text");
      expect(response.text).toBe("Candidate part text");
    });
  });

  describe("Tool call response translation", () => {
    it("translates functionCalls getter from response", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        functionCalls: [
          {
            id: "call_abc123",
            name: "read_file",
            args: { path: "src/index.ts", startLine: 1, endLine: 50 },
          },
        ],
        usageMetadata: {
          promptTokenCount: 200,
          candidatesTokenCount: 30,
          totalTokenCount: 230,
        },
      });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });
      const response = await provider.generate([{ role: "user", content: "Read src/index.ts" }]);

      expect(response.type).toBe("tool_call");
      expect(response.toolCall).toEqual({
        id: "call_abc123",
        toolName: "read_file",
        arguments: { path: "src/index.ts", startLine: 1, endLine: 50 },
      });
      expect(response.text).toBeUndefined();
      expect(response.usage?.totalTokens).toBe(230);
    });

    it("translates functionCall from candidate parts when getter is not populated", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "edit_file",
                    args: { path: "README.md", content: "# Hello" },
                  },
                },
              ],
            },
          },
        ],
      });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });
      const response = await provider.generate([{ role: "user", content: "Update readme" }]);

      expect(response.type).toBe("tool_call");
      expect(response.toolCall?.toolName).toBe("edit_file");
      expect(response.toolCall?.arguments).toEqual({ path: "README.md", content: "# Hello" });
      expect(response.toolCall?.id).toBeDefined();
    });
  });

  describe("Message history and system instruction translation", () => {
    it("extracts system message to systemInstruction and translates all message roles", async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: "Understood" });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });
      const messages: Message[] = [
        { role: "system", content: "You are an autonomous senior engineer." },
        { role: "user", content: "Start task." },
        {
          role: "assistant",
          content: "Let me search for files.",
          toolCall: {
            id: "call_1",
            toolName: "search_workspace",
            arguments: { pattern: "test" },
          },
        },
        {
          role: "tool",
          content: "",
          toolResult: {
            toolCallId: "call_1",
            success: true,
            output: "Found 2 files: a.ts, b.ts",
          },
        },
      ];

      await provider.generate(messages);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.systemInstruction).toBe("You are an autonomous senior engineer.");
      expect(callArgs.contents).toEqual([
        { role: "user", parts: [{ text: "Start task." }] },
        {
          role: "model",
          parts: [
            { text: "Let me search for files." },
            {
              functionCall: {
                id: "call_1",
                name: "search_workspace",
                args: { pattern: "test" },
              },
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "call_1",
                response: {
                  success: true,
                  output: "Found 2 files: a.ts, b.ts",
                },
              },
            },
          ],
        },
      ]);
    });
  });

  describe("Tool definition translation", () => {
    it("converts ToolDefinition array to Gemini function declarations", async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: "Ready" });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });
      const tools: ToolDefinition[] = [
        {
          name: "read_file",
          description: "Reads a file from workspace",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to file" },
              startLine: { type: "number", description: "Start line (1-indexed)" },
            },
            required: ["path"],
          },
        },
      ];

      await provider.generate([{ role: "user", content: "Read file" }], tools);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.config.tools).toEqual([
        {
          functionDeclarations: [
            {
              name: "read_file",
              description: "Reads a file from workspace",
              parameters: {
                type: "OBJECT",
                properties: {
                  path: { type: "STRING", description: "Path to file" },
                  startLine: { type: "NUMBER", description: "Start line (1-indexed)" },
                },
                required: ["path"],
              },
            },
          ],
        },
      ]);
    });
  });

  describe("Options handling", () => {
    it("respects model, temperature, and maxOutputTokens overrides", async () => {
      mockGenerateContent.mockResolvedValueOnce({ text: "Custom config response" });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });
      await provider.generate(
        [{ role: "user", content: "Run" }],
        [],
        {
          model: "gemini-2.5-pro",
          temperature: 0.2,
          maxOutputTokens: 2048,
        },
      );

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.model).toBe("gemini-2.5-pro");
      expect(callArgs.config.temperature).toBe(0.2);
      expect(callArgs.config.maxOutputTokens).toBe(2048);
    });
  });

  describe("Error normalization to ProviderError", () => {
    it("normalizes authentication errors (401/403/API_KEY_INVALID)", async () => {
      mockGenerateContent.mockRejectedValueOnce({
        status: 401,
        message: "API_KEY_INVALID: The provided API key is expired or invalid.",
      });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });

      try {
        await provider.generate([{ role: "user", content: "Hello" }]);
        expect.unreachable();
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.type).toBe("authentication");
        expect(err.retryable).toBe(false);
        expect(err.provider).toBe("gemini");
      }
    });

    it("normalizes rate limit errors (429 / RESOURCE_EXHAUSTED)", async () => {
      mockGenerateContent.mockRejectedValueOnce({
        status: 429,
        message: "RESOURCE_EXHAUSTED: Rate limit exceeded for quota group.",
      });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });

      try {
        await provider.generate([{ role: "user", content: "Hello" }]);
        expect.unreachable();
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.type).toBe("rate_limit");
        expect(err.retryable).toBe(true);
        expect(err.provider).toBe("gemini");
      }
    });

    it("normalizes context length overflow errors", async () => {
      mockGenerateContent.mockRejectedValueOnce({
        status: 400,
        message: "Token limit exceeded: prompt is too long for model context window.",
      });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });

      try {
        await provider.generate([{ role: "user", content: "Large prompt" }]);
        expect.unreachable();
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.type).toBe("context_overflow");
        expect(err.retryable).toBe(false);
      }
    });

    it("normalizes invalid argument / bad request errors", async () => {
      mockGenerateContent.mockRejectedValueOnce({
        status: 400,
        message: "INVALID_ARGUMENT: Schema mismatch on tool declaration.",
      });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });

      try {
        await provider.generate([{ role: "user", content: "Invalid schema" }]);
        expect.unreachable();
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.type).toBe("invalid_request");
        expect(err.retryable).toBe(false);
      }
    });

    it("normalizes internal server / provider errors (500/503)", async () => {
      mockGenerateContent.mockRejectedValueOnce({
        status: 503,
        message: "Service Unavailable: backend temporarily overloaded.",
      });

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });

      try {
        await provider.generate([{ role: "user", content: "Hello" }]);
        expect.unreachable();
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.type).toBe("provider_error");
        expect(err.retryable).toBe(true);
      }
    });

    it("normalizes network errors (fetch failed / ECONNRESET)", async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error("fetch failed: ECONNRESET"));

      const provider = new GeminiProvider({ client: mockClient, apiKey: "test-api-key" });

      try {
        await provider.generate([{ role: "user", content: "Hello" }]);
        expect.unreachable();
      } catch (err: any) {
        expect(err).toBeInstanceOf(ProviderError);
        expect(err.type).toBe("network");
        expect(err.retryable).toBe(true);
      }
    });

    it("throws authentication ProviderError when GEMINI_API_KEY is missing", async () => {
      const origEnv = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      try {
        const provider = new GeminiProvider({ client: { models: { generateContent: mockGenerateContent } } as any });
        await expect(provider.generate([{ role: "user", content: "Test" }])).rejects.toThrow(ProviderError);
      } finally {
        if (origEnv !== undefined) {
          process.env.GEMINI_API_KEY = origEnv;
        }
      }
    });
  });
});
