/**
 * Context Assembly and Management
 *
 * Assembles system prompts, user tasks, and conversation history with bounded output protection (NFR-4).
 */

import type { Message, ToolResult } from "../llm/types.js";

export const DEFAULT_SYSTEM_PROMPT = `You are an expert autonomous software engineering agent.
Your goal is to solve the user's coding request within the specified workspace.

Guidelines:
1. EXPLORE: Use search_files and read_file to inspect the codebase and locate relevant code before making edits.
2. EDIT: Use edit_file to create or modify code. For exact single-occurrence substitution, use operation: 'replace'. For new files or rewrites, use operation: 'write'.
3. VERIFY: Always verify your solution by running tests, builds, or linting using run_command (e.g. 'npm test').
4. SAFETY: You can only access files within the workspace root. Only use allowlisted commands.
5. COMPLETE: Once the verification succeeds and you are confident the problem is resolved, provide a concise final summary explaining what was fixed.`;

export const MAX_MESSAGE_CONTENT_BYTES = 50 * 1024; // 50 KB cap per message

export interface ContextManagerOptions {
  systemPrompt?: string;
  maxContentBytes?: number;
}

export class ContextManager {
  readonly systemPrompt: string;
  readonly maxContentBytes: number;

  constructor(options: ContextManagerOptions = {}) {
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.maxContentBytes = options.maxContentBytes || MAX_MESSAGE_CONTENT_BYTES;
  }

  /**
   * Assembles full message history with system prompt and size caps.
   */
  assemble(userRequest: string, history: Message[] = []): Message[] {
    const messages: Message[] = [
      {
        role: "system",
        content: this.systemPrompt,
      },
    ];

    // If history is empty, initialize with user request
    if (history.length === 0) {
      messages.push({
        role: "user",
        content: userRequest,
      });
      return messages;
    }

    // Otherwise, ensure first non-system message represents the user request if not present
    let hasUserMessage = false;
    for (const msg of history) {
      if (msg.role === "user" && !msg.toolResult) {
        hasUserMessage = true;
        break;
      }
    }

    if (!hasUserMessage) {
      messages.push({
        role: "user",
        content: userRequest,
      });
    }

    // Append and protect each message in history
    for (const msg of history) {
      if (msg.role === "system") continue; // Skip duplicate system messages
      messages.push(this.protectMessage(msg));
    }

    return messages;
  }

  /**
   * Creates a Message object from a ToolResult with size boundary protection.
   */
  createToolResultMessage(toolResult: ToolResult): Message {
    let output = toolResult.output || "";
    if (output.length > this.maxContentBytes) {
      output =
        output.slice(0, this.maxContentBytes) +
        "\n[... Tool output truncated by context manager ...]";
    }

    return {
      role: "tool",
      content: output,
      toolResult: {
        ...toolResult,
        output,
      },
    };
  }

  /**
   * Truncates message content if it exceeds the maximum byte limit (NFR-4).
   */
  private protectMessage(msg: Message): Message {
    let content = msg.content || "";
    if (content.length > this.maxContentBytes) {
      content =
        content.slice(0, this.maxContentBytes) +
        "\n[... Message content truncated by context manager ...]";
      return {
        ...msg,
        content,
      };
    }
    return msg;
  }
}
