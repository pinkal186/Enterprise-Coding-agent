/**
 * Context Management Subsystem — Core Types and Interfaces
 *
 * Implements FR-14 for Iteration 2 Context Management.
 * Provider-agnostic data model for context items, state, budget, compaction,
 * and context building.
 */

import type { Message, ToolDefinition } from "../llm/types.js";

// ---------------------------------------------------------------------------
// Context Items & Importance
// ---------------------------------------------------------------------------

export type ContextItemType =
  | "system"
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "task_state"
  | "important_fact"
  | "summary";

export type ContextImportance = "critical" | "high" | "normal" | "low";

export interface ContextItemSource {
  toolName?: string;
  filePath?: string;
  command?: string;
}

export interface ContextItem {
  id: string;
  type: ContextItemType;
  content: string;
  importance: ContextImportance;
  createdAt: number;
  tokenEstimate?: number;
  source?: ContextItemSource;
  removable?: boolean;
  truncated?: boolean;
  originalTokenEstimate?: number;
  finalTokenEstimate?: number;
}

// ---------------------------------------------------------------------------
// Context State
// ---------------------------------------------------------------------------

export interface ContextState {
  items: ContextItem[];
  maxContextTokens: number;
  reservedOutputTokens: number;
  estimatedInputTokens: number;
  compactionCount: number;
  truncatedItemCount: number;
}

// ---------------------------------------------------------------------------
// Context Budget
// ---------------------------------------------------------------------------

export interface ContextBudget {
  maxContextTokens: number;
  reservedOutputTokens: number;
  compactionThreshold: number; // e.g. 0.80 for 80%
  maxToolOutputTokens: number;
  maxFileReadTokens: number;
  maxSearchResultTokens: number;
  maxCommandOutputTokens: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxContextTokens: 32000,
  reservedOutputTokens: 4096,
  compactionThreshold: 0.8,
  maxToolOutputTokens: 4000,
  maxFileReadTokens: 6000,
  maxSearchResultTokens: 2000,
  maxCommandOutputTokens: 4000,
};

// ---------------------------------------------------------------------------
// Context Metrics & Stats
// ---------------------------------------------------------------------------

export interface ContextMetrics {
  iteration?: number;
  estimatedInputTokens: number;
  estimatedOutputTokens?: number;
  contextUtilization: number;
  totalItems: number;
  toolResultsCount: number;
  truncatedItemsCount: number;
  droppedItemsCount: number;
  compactionsCount: number;
}

export interface ContextStats {
  totalItems: number;
  estimatedTokens: number;
  utilization: number;
  truncations: number;
  compactions: number;
  droppedItems: number;
}

// ---------------------------------------------------------------------------
// Important Facts
// ---------------------------------------------------------------------------

export type FactImportance = "critical" | "high" | "normal";

export interface ImportantFact {
  id: string;
  content: string;
  importance: FactImportance;
  source?: string;
  createdAt?: number;
}

// ---------------------------------------------------------------------------
// Compaction Events
// ---------------------------------------------------------------------------

export interface CompactionEvent {
  timestamp: number;
  itemsBefore: number;
  itemsAfter: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  itemsRemoved: number;
  summaryCreated: boolean;
  tokensBefore?: number;
  tokensAfter?: number;
}

// ---------------------------------------------------------------------------
// Context Builder Inputs & Results
// ---------------------------------------------------------------------------

export interface BuildContextInput {
  task: string;
  contextState: ContextState;
  tools: ToolDefinition[];
  budget: ContextBudget;
  importantFacts?: ImportantFact[];
}

export interface BuildContextResult {
  messages: Message[];
  estimatedTokens: number;
  utilization: number;
  truncated: boolean;
  compacted: boolean;
  metrics: ContextMetrics;
  selectedItems?: ContextItem[];
  droppedItems?: ContextItem[];
  truncatedItems?: ContextItem[];
  compactionEvent?: CompactionEvent;
}

// ---------------------------------------------------------------------------
// Component Interfaces
// ---------------------------------------------------------------------------

export interface TokenEstimator {
  estimate(text: string): number;
}

export interface Truncator {
  truncate(item: ContextItem, maxTokens: number): ContextItem;
}

export interface Compactor {
  compact(state: ContextState, budget: ContextBudget, importantFacts?: ImportantFact[]): {
    state: ContextState;
    event?: CompactionEvent;
  };
}

export interface ContextBuilder {
  build(input: BuildContextInput): BuildContextResult;
}
