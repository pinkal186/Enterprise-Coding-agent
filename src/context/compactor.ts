/**
 * Deterministic Context Compactor
 *
 * Implements FR-21 and DECISION-3ad6a1ad for Iteration 2 Context Management.
 * Performs deterministic structured extraction without LLM summarization.
 * Preserves user task, modified files, commands, test results, important facts,
 * and the most recent 8 interaction turns while recording CompactionEvent metrics.
 */

import type {
  CompactionEvent,
  Compactor,
  ContextBudget,
  ContextItem,
  ContextState,
  ImportantFact,
} from "./types.js";
import { defaultTokenEstimator, SimpleTokenEstimator } from "./token-estimator.js";

export interface CompactorOptions {
  estimator?: SimpleTokenEstimator;
  recentTurnsWindow?: number; // default 8 turns
}

export class DeterministicCompactor implements Compactor {
  private readonly estimator: SimpleTokenEstimator;
  private readonly recentTurnsWindow: number;

  constructor(options: CompactorOptions = {}) {
    this.estimator = options.estimator ?? defaultTokenEstimator;
    this.recentTurnsWindow = options.recentTurnsWindow ?? 8;
  }

  /**
   * Performs deterministic compaction on ContextState.
   * Stage 1: Identifies interaction items older than the recent turns window.
   * Stage 2: Produces structured summary preserving critical state and facts.
   */
  compact(
    state: ContextState,
    budget: ContextBudget,
    importantFacts: ImportantFact[] = []
  ): {
    state: ContextState;
    event?: CompactionEvent;
  } {
    const items = state.items;

    // Identify interaction items (user, assistant, tool_call, tool_result)
    const interactionIndices: number[] = [];
    items.forEach((item, index) => {
      if (
        item.type === "assistant" ||
        item.type === "tool_call" ||
        item.type === "tool_result" ||
        (item.type === "user" && index > 0)
      ) {
        interactionIndices.push(index);
      }
    });

    // If there aren't more interactions than the recent turns window, no compaction possible
    if (interactionIndices.length <= this.recentTurnsWindow) {
      return { state };
    }

    // Cutoff index: items before this index (among interaction items) are eligible for compaction
    const cutoffTurnIndex = interactionIndices.length - this.recentTurnsWindow;
    const cutoffItemIndex = interactionIndices[cutoffTurnIndex];

    const olderEligibleItems: ContextItem[] = [];
    const preservedItems: ContextItem[] = [];

    const firstUserIndex = items.findIndex((it) => it.type === "user");

    items.forEach((item, index) => {
      // Unconditionally preserve system instructions, original user task, critical items, and important facts
      const isOriginalTask = item.id === "user-task" || index === firstUserIndex;
      if (
        item.type === "system" ||
        item.type === "important_fact" ||
        item.importance === "critical" ||
        isOriginalTask ||
        item.removable === false ||
        index >= cutoffItemIndex
      ) {
        preservedItems.push(item);
      } else {
        olderEligibleItems.push(item);
      }
    });

    // If no older items were eligible, return original state
    if (olderEligibleItems.length === 0) {
      return { state };
    }

    // Stage 2: Structured extraction from older eligible items
    const summaryText = this.buildStructuredSummary(olderEligibleItems, items, importantFacts);

    const summaryItem: ContextItem = {
      id: `summary-${Date.now()}`,
      type: "summary",
      content: summaryText,
      importance: "high",
      createdAt: Date.now(),
      tokenEstimate: this.estimator.estimate(summaryText),
      removable: true,
    };

    // Insert summary item before recent interaction items
    // Place after initial system/task/facts but before recent turns
    const recentIndex = preservedItems.findIndex((item) =>
      interactionIndices.slice(cutoffTurnIndex).some((idx) => items[idx]?.id === item.id)
    );

    const newItems = [...preservedItems];
    if (recentIndex !== -1) {
      newItems.splice(recentIndex, 0, summaryItem);
    } else {
      newItems.push(summaryItem);
    }

    // Compute token estimates before and after
    const tokensBefore = items.reduce(
      (acc, item) => acc + (item.tokenEstimate ?? this.estimator.estimate(item.content)),
      0
    );

    const tokensAfter = newItems.reduce(
      (acc, item) => acc + (item.tokenEstimate ?? this.estimator.estimate(item.content)),
      0
    );

    const event: CompactionEvent = {
      timestamp: Date.now(),
      itemsBefore: items.length,
      itemsAfter: newItems.length,
      estimatedTokensBefore: tokensBefore,
      estimatedTokensAfter: tokensAfter,
      itemsRemoved: olderEligibleItems.length,
      summaryCreated: true,
    };

    const newState: ContextState = {
      ...state,
      items: newItems,
      estimatedInputTokens: tokensAfter,
      compactionCount: state.compactionCount + 1,
    };

    return {
      state: newState,
      event,
    };
  }

  /**
   * Deterministically extracts facts, modified files, commands, and errors
   * into a structured text summary without calling any LLM.
   */
  private buildStructuredSummary(
    eligibleItems: ContextItem[],
    allItems: ContextItem[],
    importantFacts: ImportantFact[]
  ): string {
    const sections: string[] = [];

    // 1. User task extraction
    const userTaskItem = allItems.find(
      (item) => item.type === "user" || item.id === "user-task"
    );
    if (userTaskItem) {
      sections.push(`Task:\n${userTaskItem.content.trim()}`);
    }

    // 2. Important facts
    const factsList = new Set<string>();
    importantFacts.forEach((f) => factsList.add(f.content.trim()));
    allItems
      .filter((item) => item.type === "important_fact")
      .forEach((item) => factsList.add(item.content.trim()));

    if (factsList.size > 0) {
      const formattedFacts = Array.from(factsList)
        .map((f) => `- ${f}`)
        .join("\n");
      sections.push(`Important Findings & Constraints:\n${formattedFacts}`);
    }

    // 3. Modified files extraction
    const modifiedFiles = new Set<string>();
    eligibleItems.forEach((item) => {
      if (item.source?.filePath) {
        modifiedFiles.add(item.source.filePath);
      }
      // Inspect edit_file tool outputs or operations
      const match = item.content.match(/(?:file|edited|modified|written|created)\s+[`"']?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)[`"']?/i);
      if (match && match[1]) {
        modifiedFiles.add(match[1]);
      }
    });

    if (modifiedFiles.size > 0) {
      const filesFormatted = Array.from(modifiedFiles)
        .map((f) => `- ${f}`)
        .join("\n");
      sections.push(`Modified/Inspected Files:\n${filesFormatted}`);
    }

    // 4. Executed commands & test results
    const commandsList = new Set<string>();
    eligibleItems.forEach((item) => {
      if (item.source?.command) {
        const status = item.content.includes("FAIL") || item.content.includes("failed") ? "failed" : "passed";
        commandsList.add(`${item.source.command} (${status})`);
      }
    });

    if (commandsList.size > 0) {
      const commandsFormatted = Array.from(commandsList)
        .map((c) => `- ${c}`)
        .join("\n");
      sections.push(`Executed Commands & Test Status:\n${commandsFormatted}`);
    }

    // 5. Errors encountered
    const errorsList = new Set<string>();
    eligibleItems.forEach((item) => {
      const lines = item.content.split("\n");
      for (const line of lines) {
        if (/\b(AssertionError|FAIL|Error:|TypeError)\b/i.test(line)) {
          const trimmed = line.trim();
          if (trimmed.length > 0 && trimmed.length < 150) {
            errorsList.add(trimmed);
          }
        }
      }
    });

    if (errorsList.size > 0) {
      const errorsFormatted = Array.from(errorsList)
        .slice(0, 5) // Cap to top 5 errors to avoid bloating summary
        .map((e) => `- ${e}`)
        .join("\n");
      sections.push(`Errors Encountered:\n${errorsFormatted}`);
    }

    return sections.join("\n\n");
  }
}

/** Default singleton instance */
export const defaultCompactor = new DeterministicCompactor();
