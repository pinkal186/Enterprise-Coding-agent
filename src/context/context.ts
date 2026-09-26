/**
 * Context Assembly and Management — Backward-Compatible Shim
 *
 * Implements DECISION-f2edfb27 for Iteration 2 Context Management.
 * Preserves the original ContextManager class and assemble() method so all
 * Iteration 1 unit tests (tests/unit/context.test.ts) continue to pass without modification.
 * Re-exports the new subsystem components for unified access.
 */

import type { Message, ToolResult } from "../llm/types.js";
import { ManagedContextManager } from "./context-manager.js";

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

/**
 * Backward-compatible ContextManager shim (DECISION-f2edfb27).
 * Preserves assemble() and legacy helper signatures while delegating to ManagedContextManager.
 */
export class ContextManager {
  readonly systemPrompt: string;
  readonly maxContentBytes: number;
  private readonly delegate: ManagedContextManager;

  constructor(options: ContextManagerOptions = {}) {
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.maxContentBytes = options.maxContentBytes || MAX_MESSAGE_CONTENT_BYTES;
    this.delegate = new ManagedContextManager({
      systemPrompt: this.systemPrompt,
    });
  }

  /**
   * Legacy assembly method: Assembles full message history with system prompt and size caps.
   * Preserved for backward compatibility with Iteration 1 tests.
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
   * Applies safety bounds to ensure individual message contents don't exceed limits.
   */
  private protectMessage(message: Message): Message {
    if (message.content && message.content.length > this.maxContentBytes) {
      return {
        ...message,
        content:
          message.content.slice(0, this.maxContentBytes) +
          "\n[... Message content truncated by context manager ...]",
      };
    }
    return message;
  }

  /**
   * Exposes the underlying ManagedContextManager delegate.
   */
  getManagedDelegate(): ManagedContextManager {
    return this.delegate;
  }
}

// Re-export modern context subsystem types and classes for seamless imports
export * from "./types.js";
export * from "./token-estimator.js";
export * from "./truncator.js";
export * from "./policies.js";
export * from "./compactor.js";
export * from "./context-builder.js";
export * from "./context-metrics.js";
export * from "./context-manager.js";
