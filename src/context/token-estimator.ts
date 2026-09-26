/**
 * Deterministic Token Estimator
 *
 * Implements FR-15 for Iteration 2 Context Management.
 * Uses a deterministic characters / 4 approximation with zero provider SDK dependencies.
 */

import type { TokenEstimator } from "./types.js";
import type { Message } from "../llm/types.js";

export class SimpleTokenEstimator implements TokenEstimator {
  private readonly charsPerToken: number;

  constructor(charsPerToken: number = 4) {
    if (charsPerToken <= 0) {
      throw new Error("charsPerToken must be positive");
    }
    this.charsPerToken = charsPerToken;
  }

  /**
   * Deterministically estimates token count for a text string using Math.ceil(chars / 4).
   * Monotone increasing and returns 0 for empty strings.
   */
  estimate(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }
    return Math.ceil(text.length / this.charsPerToken);
  }

  /**
   * Estimates tokens for a conversation message, including content and tool structures.
   */
  estimateMessage(message: Message): number {
    let tokens = 0;

    // Account for tool result representation overhead if present
    if (message.toolResult) {
      const outputText = message.toolResult.output || message.content || "";
      tokens += this.estimate(outputText);
      if (message.content && message.content !== message.toolResult.output) {
        tokens += this.estimate(message.content);
      }
      if (message.toolResult.error) {
        tokens += this.estimate(message.toolResult.error);
      }
      tokens += 4; // structural formatting overhead tokens
    } else {
      tokens += this.estimate(message.content || "");
    }

    // Account for tool call representation overhead if present
    if (message.toolCall) {
      tokens += this.estimate(message.toolCall.toolName);
      tokens += this.estimate(JSON.stringify(message.toolCall.arguments || {}));
      tokens += 4; // structural formatting overhead tokens
    }

    // Baseline message framing overhead (role, markers)
    tokens += 3;

    return tokens;
  }
}

/** Default singleton instance with standard 4 chars/token approximation */
export const defaultTokenEstimator = new SimpleTokenEstimator(4);
