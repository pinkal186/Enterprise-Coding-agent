/**
 * Type-Aware Context Truncator
 *
 * Implements FR-17 for Iteration 2 Context Management.
 * Provides specialized truncation strategies for file content, search results,
 * and command output with clear truncation markers and preserved metadata.
 */

import type { ContextItem, Truncator } from "./types.js";
import { defaultTokenEstimator, SimpleTokenEstimator } from "./token-estimator.js";

export const TRUNCATION_MARKER = "\n[result truncated]";

export class TypeAwareTruncator implements Truncator {
  private readonly estimator: SimpleTokenEstimator;
  private readonly charsPerToken: number = 4;

  constructor(estimator: SimpleTokenEstimator = defaultTokenEstimator) {
    this.estimator = estimator;
  }

  /**
   * Truncates a ContextItem to stay within maxTokens using type-specific strategies.
   * If item is already within limit, returns it unchanged.
   */
  truncate(item: ContextItem, maxTokens: number): ContextItem {
    if (maxTokens <= 0) {
      throw new Error("maxTokens must be positive");
    }

    const originalTokens = item.tokenEstimate ?? this.estimator.estimate(item.content);

    // If item is already within budget, return unmodified
    if (originalTokens <= maxTokens) {
      return {
        ...item,
        tokenEstimate: originalTokens,
      };
    }

    let truncatedContent: string;

    // Strategy selection based on source metadata or item characteristics
    const toolName = item.source?.toolName?.toLowerCase();
    if (toolName === "read_file" || item.source?.filePath) {
      truncatedContent = this.truncateFileContent(item.content, maxTokens);
    } else if (toolName === "search_files" || toolName === "search") {
      truncatedContent = this.truncateSearchResults(item.content, maxTokens);
    } else if (toolName === "run_command" || item.source?.command) {
      truncatedContent = this.truncateCommandOutput(item.content, maxTokens);
    } else {
      truncatedContent = this.truncateGeneric(item.content, maxTokens);
    }

    const finalTokens = this.estimator.estimate(truncatedContent);

    return {
      ...item,
      content: truncatedContent,
      truncated: true,
      originalTokenEstimate: originalTokens,
      finalTokenEstimate: finalTokens,
      tokenEstimate: finalTokens,
    };
  }

  /**
   * Strategy for file content: Preserves line structure from the top down.
   */
  private truncateFileContent(content: string, maxTokens: number): string {
    const marker = "\n[result truncated — file content exceeds budget]";
    const markerTokens = this.estimator.estimate(marker);
    const budgetForContent = Math.max(1, maxTokens - markerTokens);
    const maxChars = budgetForContent * this.charsPerToken;

    const lines = content.split("\n");
    let accumulated = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const candidate = accumulated.length === 0 ? line : accumulated + "\n" + line;
      if (this.estimator.estimate(candidate) > budgetForContent) {
        break;
      }
      accumulated = candidate;
    }

    // If even the first line didn't fit, do a hard slice
    if (accumulated.length === 0) {
      accumulated = content.slice(0, maxChars);
    }

    return accumulated + marker;
  }

  /**
   * Strategy for search results: Preserves as many whole match lines/blocks as possible.
   */
  private truncateSearchResults(content: string, maxTokens: number): string {
    const marker = "\n[result truncated — search results exceed budget]";
    const markerTokens = this.estimator.estimate(marker);
    const budgetForContent = Math.max(1, maxTokens - markerTokens);

    const lines = content.split("\n");
    let accumulated = "";

    for (const line of lines) {
      const candidate = accumulated.length === 0 ? line : accumulated + "\n" + line;
      if (this.estimator.estimate(candidate) > budgetForContent) {
        break;
      }
      accumulated = candidate;
    }

    if (accumulated.length === 0) {
      accumulated = content.slice(0, budgetForContent * this.charsPerToken);
    }

    return accumulated + marker;
  }

  /**
   * Strategy for command output: Prioritizes error and tail output over early verbose logs.
   */
  private truncateCommandOutput(content: string, maxTokens: number): string {
    const marker = "\n[result truncated — command output exceeds budget]\n";
    const markerTokens = this.estimator.estimate(marker);
    const budgetForContent = Math.max(1, maxTokens - markerTokens);
    const maxChars = budgetForContent * this.charsPerToken;

    const lines = content.split("\n");
    // Look for failure or error markers (Vitest, Jest, compiler errors, etc.)
    const errorIndex = lines.findIndex((l) =>
      /\b(FAIL|ERROR|Error:|AssertionError|failed|TypeError)\b/i.test(l)
    );

    if (errorIndex !== -1) {
      // Prioritize starting from the error section up to end of output
      const errorSection = lines.slice(errorIndex).join("\n");
      if (this.estimator.estimate(errorSection) <= budgetForContent) {
        return "[... earlier output truncated ...]\n" + errorSection;
      }
      // If error section alone is too large, take head of error section
      const slicedError = errorSection.slice(0, maxChars);
      return "[... earlier output truncated ...]\n" + slicedError + marker;
    }

    // If no explicit error keyword found, preserve the most recent tail output
    // Command completions, test summaries, exit reports are usually at the bottom.
    const tailCandidate = content.slice(-maxChars);
    return "[... earlier command output truncated ...]\n" + tailCandidate;
  }

  /**
   * Fallback generic truncation: slice content and attach truncation marker.
   */
  private truncateGeneric(content: string, maxTokens: number): string {
    const marker = TRUNCATION_MARKER;
    const markerTokens = this.estimator.estimate(marker);
    const budgetForContent = Math.max(1, maxTokens - markerTokens);
    const maxChars = budgetForContent * this.charsPerToken;

    const sliced = content.slice(0, maxChars);
    return sliced + marker;
  }
}

/** Default singleton instance */
export const defaultTruncator = new TypeAwareTruncator();
