/**
 * Context Builder
 *
 * Implements FR-20 for Iteration 2 Context Management.
 * Assembles LLM-ready messages ordered according to Section 14:
 * system -> task -> facts -> recent-tools -> recent-interaction -> older -> summaries.
 * Enforces context budget, computes utilization, and tracks metrics.
 */

import type { Message } from "../llm/types.js";
import type {
  BuildContextInput,
  BuildContextResult,
  ContextBuilder,
  ContextItem,
  ContextMetrics,
  ImportantFact,
  Truncator,
} from "./types.js";
import { DEFAULT_SYSTEM_PROMPT } from "./context.js";
import { defaultTokenEstimator, SimpleTokenEstimator } from "./token-estimator.js";
import { defaultTruncator } from "./truncator.js";
import { ContextSelectionPolicy, defaultSelectionPolicy } from "./policies.js";

export interface ContextBuilderOptions {
  estimator?: SimpleTokenEstimator;
  truncator?: Truncator;
  policy?: ContextSelectionPolicy;
  systemPrompt?: string;
  recentTurnsWindow?: number; // default 8 turns
}

export class StandardContextBuilder implements ContextBuilder {
  private readonly estimator: SimpleTokenEstimator;
  private readonly truncator: Truncator;
  private readonly policy: ContextSelectionPolicy;
  private readonly systemPrompt: string;
  private readonly recentTurnsWindow: number;

  constructor(options: ContextBuilderOptions = {}) {
    this.estimator = options.estimator ?? defaultTokenEstimator;
    this.truncator = options.truncator ?? defaultTruncator;
    this.policy = options.policy ?? defaultSelectionPolicy;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.recentTurnsWindow = options.recentTurnsWindow ?? 8;
  }

  /**
   * Builds an LLM-ready context with ordered messages and metrics.
   */
  build(input: BuildContextInput): BuildContextResult {
    const usableBudget = Math.max(
      1,
      input.budget.maxContextTokens - input.budget.reservedOutputTokens
    );

    // 1. Gather all raw items
    const rawItems: ContextItem[] = [];

    // System prompt item (CRITICAL)
    rawItems.push({
      id: "system-instruction",
      type: "system",
      content: this.systemPrompt,
      importance: "critical",
      createdAt: 0,
      removable: false,
    });

    // User task item (CRITICAL)
    rawItems.push({
      id: "user-task",
      type: "user",
      content: input.task,
      importance: "critical",
      createdAt: 1,
      removable: false,
    });

    // Important facts (CRITICAL / HIGH)
    const combinedFacts: ImportantFact[] = [
      ...(input.importantFacts ?? []),
    ];

    for (const item of input.contextState.items) {
      if (item.type === "important_fact") {
        combinedFacts.push({
          id: item.id,
          content: item.content,
          importance: item.importance === "critical" ? "critical" : "high",
        });
      }
    }

    // Deduplicate facts by content
    const seenFactContents = new Set<string>();
    for (const fact of combinedFacts) {
      const key = fact.content.trim().toLowerCase();
      if (!seenFactContents.has(key)) {
        seenFactContents.add(key);
        rawItems.push({
          id: fact.id || `fact-${rawItems.length}`,
          type: "important_fact",
          content: fact.content,
          importance: fact.importance,
          createdAt: fact.createdAt ?? 2,
          removable: fact.importance !== "critical",
        });
      }
    }

    // History and tool items from ContextState (excluding re-added important_fact items)
    for (const item of input.contextState.items) {
      if (item.type !== "important_fact") {
        rawItems.push({ ...item });
      }
    }

    // 2. Truncate oversized individual items based on per-tool/per-type caps
    let anyTruncated = false;
    const truncatedItems: ContextItem[] = rawItems.map((item) => {
      let cap = usableBudget;
      const tool = item.source?.toolName?.toLowerCase();

      if (tool === "search_files" || tool === "search") {
        cap = Math.min(cap, input.budget.maxSearchResultTokens);
      } else if (tool === "read_file" || item.source?.filePath) {
        cap = Math.min(cap, input.budget.maxFileReadTokens);
      } else if (tool === "run_command" || item.source?.command) {
        cap = Math.min(cap, input.budget.maxCommandOutputTokens);
      } else if (item.type === "tool_result") {
        cap = Math.min(cap, input.budget.maxToolOutputTokens);
      }

      const truncated = this.truncator.truncate(item, cap);
      if (truncated.truncated) {
        anyTruncated = true;
      }
      return truncated;
    });

    // 3. Apply selection policy to fit within usable budget
    const selection = this.policy.select(truncatedItems, usableBudget);
    const selectedItems = selection.selected;

    // 4. Partition selected items into the specified order:
    // system -> task -> facts -> recent-tools -> recent-interaction -> older -> summaries
    const systemItems: ContextItem[] = [];
    const taskItems: ContextItem[] = [];
    const factItems: ContextItem[] = [];
    const recentToolItems: ContextItem[] = [];
    const recentInteractionItems: ContextItem[] = [];
    const olderItems: ContextItem[] = [];
    const summaryItems: ContextItem[] = [];

    // Determine recency threshold (last N interaction turns)
    const interactionItems = selectedItems.filter(
      (item) =>
        item.type === "assistant" ||
        item.type === "tool_call" ||
        item.type === "tool_result" ||
        (item.type === "user" && item.id !== "user-task")
    );
    const recentThreshold =
      interactionItems.length > this.recentTurnsWindow
        ? interactionItems[interactionItems.length - this.recentTurnsWindow].createdAt
        : 0;

    for (const item of selectedItems) {
      if (item.id === "system-instruction" || (item.type === "system" && item.id !== "user-task")) {
        systemItems.push(item);
      } else if (item.id === "user-task" || (item.type === "user" && item.content === input.task)) {
        taskItems.push(item);
      } else if (item.type === "important_fact") {
        factItems.push(item);
      } else if (item.type === "summary") {
        summaryItems.push(item);
      } else if (item.type === "tool_result") {
        if (item.createdAt >= recentThreshold) {
          recentToolItems.push(item);
        } else {
          olderItems.push(item);
        }
      } else if (item.type === "assistant" || item.type === "tool_call" || item.type === "user") {
        if (item.createdAt >= recentThreshold) {
          recentInteractionItems.push(item);
        } else {
          olderItems.push(item);
        }
      } else {
        olderItems.push(item);
      }
    }

    const orderedItems: ContextItem[] = [
      ...systemItems,
      ...taskItems,
      ...factItems,
      ...recentToolItems,
      ...recentInteractionItems,
      ...olderItems,
      ...summaryItems,
    ];

    // 5. Convert ordered ContextItems to LLM Messages
    let messages: Message[] = orderedItems.map((item) => this.itemToMessage(item));

    // 6. Compute metrics and token estimates, strictly enforcing usableBudget against message framing overhead
    let totalEstimatedTokens = messages.reduce(
      (sum, msg) => sum + this.estimator.estimateMessage(msg),
      0
    );

    const droppedFromFraming: ContextItem[] = [];
    while (totalEstimatedTokens > usableBudget && orderedItems.length > 2) {
      const dropIndex = orderedItems.findIndex(
        (item) =>
          item.removable !== false &&
          item.importance !== "critical" &&
          item.id !== "user-task" &&
          item.id !== "system-instruction"
      );
      if (dropIndex === -1) break;
      const [removed] = orderedItems.splice(dropIndex, 1);
      droppedFromFraming.push(removed);
      messages = orderedItems.map((item) => this.itemToMessage(item));
      totalEstimatedTokens = messages.reduce(
        (sum, msg) => sum + this.estimator.estimateMessage(msg),
        0
      );
    }

    const allDropped = [...selection.dropped, ...droppedFromFraming];
    const finalSelectedItems = orderedItems;

    const utilization = Number((totalEstimatedTokens / usableBudget).toFixed(4));
    const isCompacted =
      input.contextState.compactionCount > 0 ||
      finalSelectedItems.some((item) => item.type === "summary");

    const toolResultsCount = finalSelectedItems.filter(
      (item) => item.type === "tool_result"
    ).length;

    const truncatedCount =
      finalSelectedItems.filter((item) => item.truncated).length +
      input.contextState.truncatedItemCount;

    const metrics: ContextMetrics = {
      estimatedInputTokens: totalEstimatedTokens,
      contextUtilization: utilization,
      totalItems: finalSelectedItems.length,
      toolResultsCount,
      truncatedItemsCount: truncatedCount,
      droppedItemsCount: allDropped.length,
      compactionsCount: input.contextState.compactionCount,
    };

    return {
      messages,
      estimatedTokens: totalEstimatedTokens,
      utilization,
      truncated: anyTruncated || input.contextState.truncatedItemCount > 0,
      compacted: isCompacted,
      metrics,
      selectedItems: finalSelectedItems,
      droppedItems: allDropped,
      truncatedItems: truncatedItems.filter((i) => i.truncated),
    };
  }

  /**
   * Maps an internal ContextItem to a provider-independent Message.
   */
  private itemToMessage(item: ContextItem): Message {
    switch (item.type) {
      case "system":
        return {
          role: "system",
          content: item.content,
        };

      case "user":
        return {
          role: "user",
          content: item.content,
        };

      case "assistant":
        return {
          role: "assistant",
          content: item.content,
        };

      case "tool_call":
        return {
          role: "assistant",
          content: item.content,
          toolCall: {
            id: item.id,
            toolName: item.source?.toolName || "tool",
            arguments: {},
          },
        };

      case "tool_result":
        return {
          role: "tool",
          content: item.content,
          toolResult: {
            toolCallId: item.source?.command || item.id,
            success: !item.content.toLowerCase().startsWith("error:"),
            output: item.content,
          },
        };

      case "important_fact":
        return {
          role: "system",
          content: `Important Fact: ${item.content}`,
        };

      case "task_state":
        return {
          role: "system",
          content: `Current Task State:\n${item.content}`,
        };

      case "summary":
        return {
          role: "system",
          content: `Compacted History Summary:\n${item.content}`,
        };

      default:
        return {
          role: "system",
          content: item.content,
        };
    }
  }
}

/** Default singleton instance */
export const defaultContextBuilder = new StandardContextBuilder();
