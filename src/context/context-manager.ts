/**
 * Managed Context Manager
 *
 * Implements FR-22 and DECISION-566cf411 for Iteration 2 Context Management.
 * Coordinates TokenEstimator, ContextPolicy, Truncator, Compactor, and ContextBuilder
 * into a single unified buildManaged(state, tools, budget) entry point.
 */

import type { Message, ToolDefinition, ToolResult } from "../llm/types.js";
import type {
  BuildContextResult,
  CompactionEvent,
  ContextBudget,
  ContextItem,
  ContextState,
  ImportantFact,
} from "./types.js";
import { DEFAULT_CONTEXT_BUDGET } from "./types.js";
import { defaultTokenEstimator, SimpleTokenEstimator } from "./token-estimator.js";
import { defaultTruncator, TypeAwareTruncator } from "./truncator.js";
import {
  ContextSelectionPolicy,
  defaultSelectionPolicy,
  loadContextBudgetFromEnv,
} from "./policies.js";
import { defaultCompactor, DeterministicCompactor } from "./compactor.js";
import { defaultContextBuilder, StandardContextBuilder } from "./context-builder.js";
import {
  ContextMetricsAggregator,
  defaultMetricsAggregator,
} from "./context-metrics.js";

export interface ManagedContextOptions {
  estimator?: SimpleTokenEstimator;
  truncator?: TypeAwareTruncator;
  policy?: ContextSelectionPolicy;
  compactor?: DeterministicCompactor;
  builder?: StandardContextBuilder;
  metrics?: ContextMetricsAggregator;
  budget?: ContextBudget;
  systemPrompt?: string;
}

export interface TaskStateLike {
  userRequest: string;
  messages?: Message[];
  importantFacts?: ImportantFact[];
  modifiedFiles?: Set<string> | string[];
  executedCommands?: Array<{ command: string; exitCode: number; success: boolean }>;
}

export class ManagedContextManager {
  readonly estimator: SimpleTokenEstimator;
  readonly truncator: TypeAwareTruncator;
  readonly policy: ContextSelectionPolicy;
  readonly compactor: DeterministicCompactor;
  readonly builder: StandardContextBuilder;
  readonly metrics: ContextMetricsAggregator;

  private budget: ContextBudget;
  private contextState: ContextState;
  private readonly importantFacts: ImportantFact[] = [];
  private syncedMessageCount: number = 0;

  constructor(options: ManagedContextOptions = {}) {
    this.estimator = options.estimator ?? defaultTokenEstimator;
    this.truncator = options.truncator ?? defaultTruncator;
    this.policy = options.policy ?? defaultSelectionPolicy;
    this.compactor = options.compactor ?? defaultCompactor;
    this.builder = options.builder ?? defaultContextBuilder;
    this.metrics = options.metrics ?? defaultMetricsAggregator;
    this.budget = options.budget ?? loadContextBudgetFromEnv();

    this.contextState = {
      items: [],
      maxContextTokens: this.budget.maxContextTokens,
      reservedOutputTokens: this.budget.reservedOutputTokens,
      estimatedInputTokens: 0,
      compactionCount: 0,
      truncatedItemCount: 0,
    };
  }

  /**
   * Main entry point for the Agent Loop (DECISION-566cf411).
   * Prepares managed context from state, handles compaction threshold,
   * enforces budgets, and produces LLM-ready messages.
   */
  buildManaged(
    state: TaskStateLike,
    tools: ToolDefinition[] = [],
    budgetOverride?: ContextBudget
  ): BuildContextResult {
    const budget = budgetOverride ?? this.budget;
    this.budget = budget;

    // Sync any external messages from state into internal ContextItem[]
    if (state.messages && state.messages.length > this.syncedMessageCount) {
      const newMessages = state.messages.slice(this.syncedMessageCount);
      for (const msg of newMessages) {
        this.addMessageAsContextItem(msg);
      }
      this.syncedMessageCount = state.messages.length;
    }

    // Merge any external important facts
    if (state.importantFacts) {
      for (const fact of state.importantFacts) {
        this.addImportantFact(fact);
      }
    }

    const usableBudget = Math.max(
      1,
      budget.maxContextTokens - budget.reservedOutputTokens
    );

    // Compute current utilization
    const currentTokens = this.contextState.items.reduce(
      (sum, it) => sum + (it.tokenEstimate ?? this.estimator.estimate(it.content)),
      0
    );
    const utilization = currentTokens / usableBudget;

    let latestCompactionEvent: CompactionEvent | undefined;
    // Trigger compaction if utilization meets or exceeds compaction threshold
    if (utilization >= budget.compactionThreshold) {
      const compactionResult = this.compactor.compact(
        this.contextState,
        budget,
        this.importantFacts
      );
      this.contextState = compactionResult.state;
      latestCompactionEvent = compactionResult.event;
    }

    // Build the final managed context result
    const buildResult = this.builder.build({
      task: state.userRequest,
      contextState: this.contextState,
      tools,
      budget,
      importantFacts: this.importantFacts,
    });

    if (latestCompactionEvent) {
      buildResult.compactionEvent = latestCompactionEvent;
    }

    // Record metrics snapshot
    this.metrics.record(buildResult.metrics);

    // Update internal context state tracking
    this.contextState.estimatedInputTokens = buildResult.estimatedTokens;

    return buildResult;
  }

  /**
   * Adds an important fact that survives compaction.
   */
  addImportantFact(fact: ImportantFact): void {
    if (!this.importantFacts.some((f) => f.content.trim() === fact.content.trim())) {
      this.importantFacts.push(fact);
      this.addContextItem({
        id: fact.id || `fact-${Date.now()}`,
        type: "important_fact",
        content: fact.content,
        importance: fact.importance,
        createdAt: fact.createdAt ?? Date.now(),
        removable: false,
      });
    }
  }

  /**
   * Adds an item directly to the managed context.
   */
  addContextItem(item: ContextItem): void {
    const tokens = item.tokenEstimate ?? this.estimator.estimate(item.content);
    this.contextState.items.push({
      ...item,
      tokenEstimate: tokens,
    });
    this.contextState.estimatedInputTokens += tokens;
  }

  /**
   * Records a ToolResult into the managed context state.
   */
  addToolResult(
    toolName: string,
    output: string,
    options: {
      filePath?: string;
      command?: string;
      importance?: ContextItem["importance"];
      success?: boolean;
    } = {}
  ): ContextItem {
    const item: ContextItem = {
      id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: "tool_result",
      content: output,
      importance: options.importance ?? (options.success === false ? "high" : "normal"),
      createdAt: Date.now(),
      source: {
        toolName,
        filePath: options.filePath,
        command: options.command,
      },
      removable: true,
    };

    this.addContextItem(item);
    return item;
  }

  /**
   * Internal mapper from Message to ContextItem.
   */
  private addMessageAsContextItem(msg: Message): void {
    if (msg.role === "system") {
      // System instructions are handled by builder
      return;
    }

    if (msg.role === "user") {
      this.addContextItem({
        id: `user-${Date.now()}`,
        type: "user",
        content: msg.content,
        importance: "normal",
        createdAt: Date.now(),
      });
    } else if (msg.role === "assistant") {
      this.addContextItem({
        id: `asst-${Date.now()}`,
        type: msg.toolCall ? "tool_call" : "assistant",
        content: msg.content,
        importance: "normal",
        createdAt: Date.now(),
        source: msg.toolCall ? { toolName: msg.toolCall.toolName } : undefined,
      });
    } else if (msg.role === "tool") {
      this.addContextItem({
        id: `tool-${Date.now()}`,
        type: "tool_result",
        content: msg.content,
        importance: msg.toolResult?.success === false ? "high" : "normal",
        createdAt: Date.now(),
        source: msg.toolResult
          ? { command: msg.toolResult.toolCallId }
          : undefined,
      });
    }
  }

  /**
   * Returns current internal ContextState.
   */
  getState(): ContextState {
    return {
      ...this.contextState,
      items: [...this.contextState.items],
    };
  }

  /**
   * Returns current configured budget.
   */
  getBudget(): ContextBudget {
    return { ...this.budget };
  }
}
