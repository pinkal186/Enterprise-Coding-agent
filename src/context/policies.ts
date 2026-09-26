/**
 * Context Policies & Selection Algorithm
 *
 * Implements FR-16, FR-18, and FR-19 for Iteration 2 Context Management.
 * Provides environment-based budget loading, content-hash deduplication,
 * priority+recency sorting, and the deterministic 7-step context selection policy.
 */

import { createHash } from "node:crypto";
import type {
  ContextBudget,
  ContextImportance,
  ContextItem,
} from "./types.js";
import { DEFAULT_CONTEXT_BUDGET } from "./types.js";
import { defaultTokenEstimator, SimpleTokenEstimator } from "./token-estimator.js";

// ---------------------------------------------------------------------------
// Context Budget Loader (FR-16)
// ---------------------------------------------------------------------------

/**
 * Loads ContextBudget configuration from environment variables with safe defaults.
 */
export function loadContextBudgetFromEnv(
  env: Record<string, string | undefined> = process.env
): ContextBudget {
  const parseNum = (val: string | undefined, fallback: number): number => {
    if (!val) return fallback;
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const parseFloatClamped = (val: string | undefined, fallback: number): number => {
    if (!val) return fallback;
    const n = Number.parseFloat(val);
    return Number.isFinite(n) && n > 0 && n <= 1.0 ? n : fallback;
  };

  return {
    maxContextTokens: parseNum(env.MODEL_CONTEXT_TOKENS, DEFAULT_CONTEXT_BUDGET.maxContextTokens),
    reservedOutputTokens: parseNum(
      env.MODEL_OUTPUT_TOKENS,
      DEFAULT_CONTEXT_BUDGET.reservedOutputTokens
    ),
    compactionThreshold: parseFloatClamped(
      env.CONTEXT_COMPACTION_THRESHOLD,
      DEFAULT_CONTEXT_BUDGET.compactionThreshold
    ),
    maxToolOutputTokens: parseNum(
      env.MAX_TOOL_OUTPUT_TOKENS,
      DEFAULT_CONTEXT_BUDGET.maxToolOutputTokens
    ),
    maxFileReadTokens: parseNum(
      env.MAX_FILE_READ_TOKENS,
      DEFAULT_CONTEXT_BUDGET.maxFileReadTokens
    ),
    maxSearchResultTokens: parseNum(
      env.MAX_SEARCH_RESULT_TOKENS,
      DEFAULT_CONTEXT_BUDGET.maxSearchResultTokens
    ),
    maxCommandOutputTokens: parseNum(
      env.MAX_COMMAND_OUTPUT_TOKENS,
      DEFAULT_CONTEXT_BUDGET.maxCommandOutputTokens
    ),
  };
}

// ---------------------------------------------------------------------------
// Priority & Recency Weights (FR-18)
// ---------------------------------------------------------------------------

export const PRIORITY_WEIGHTS: Record<ContextImportance, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * Comparator implementing Section 20 rule:
 * 1. Higher importance strictly beats lower importance (e.g. CRITICAL old beats NORMAL recent).
 * 2. When importance is equal, recency is used as a tiebreaker (newer createdAt beats older).
 */
export function comparePriorityAndRecency(a: ContextItem, b: ContextItem): number {
  const weightA = PRIORITY_WEIGHTS[a.importance] ?? 2;
  const weightB = PRIORITY_WEIGHTS[b.importance] ?? 2;

  if (weightA !== weightB) {
    return weightB - weightA; // Descending by priority
  }

  return b.createdAt - a.createdAt; // Descending by recency (newest first)
}

// ---------------------------------------------------------------------------
// Duplicate Detection (FR-19)
// ---------------------------------------------------------------------------

/**
 * Generates a normalized SHA-256 hash of text content for duplicate detection.
 * Whitespace is trimmed and newlines/casing normalized.
 */
export function computeContentHash(content: string): string {
  const normalized = content.trim().replace(/\r\n/g, "\n").toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

// ---------------------------------------------------------------------------
// Selection Policy & 7-Step Algorithm (Section 19 / FR-18 / FR-19)
// ---------------------------------------------------------------------------

export interface SelectionResult {
  selected: ContextItem[];
  dropped: ContextItem[];
  duplicatesRemoved: number;
  totalEstimatedTokens: number;
}

export interface SelectionOptions {
  estimator?: SimpleTokenEstimator;
  enableDeduplication?: boolean;
}

export class ContextSelectionPolicy {
  private readonly estimator: SimpleTokenEstimator;

  constructor(estimator: SimpleTokenEstimator = defaultTokenEstimator) {
    this.estimator = estimator;
  }

  /**
   * Deterministic 7-step context selection algorithm (Section 19):
   * 1. Remove duplicate items using normalized content hash (preserves most recent).
   * 2. Partition items into priority tiers (CRITICAL, HIGH, NORMAL, LOW).
   * 3. Always include CRITICAL items.
   * 4. Add HIGH-priority items by recency until budget filled.
   * 5. Add NORMAL-priority items by recency until budget filled.
   * 6. Add LOW-priority items only if budget remains.
   * 7. Record what was selected and what was dropped.
   */
  select(
    items: ContextItem[],
    budgetTokens: number,
    options: SelectionOptions = {}
  ): SelectionResult {
    const enableDeduplication = options.enableDeduplication ?? true;
    const dropped: ContextItem[] = [];
    let duplicatesRemoved = 0;

    // Step 1: Duplicate detection & removal (FR-19)
    let candidateItems: ContextItem[] = [];
    if (enableDeduplication) {
      // Sort newest-first so that for duplicates, the latest instance is kept
      const sortedByRecency = [...items].sort((a, b) => b.createdAt - a.createdAt);
      const seenHashes = new Set<string>();

      for (const item of sortedByRecency) {
        // Do not deduplicate system messages or explicit non-removables
        if (item.type === "system" || item.removable === false) {
          candidateItems.push(item);
          continue;
        }

        const hash = computeContentHash(item.content);
        if (seenHashes.has(hash)) {
          dropped.push(item);
          duplicatesRemoved++;
        } else {
          seenHashes.add(hash);
          candidateItems.push(item);
        }
      }
    } else {
      candidateItems = [...items];
    }

    // Step 2: Partition into priority tiers
    const criticalItems: ContextItem[] = [];
    const highItems: ContextItem[] = [];
    const normalItems: ContextItem[] = [];
    const lowItems: ContextItem[] = [];

    for (const item of candidateItems) {
      switch (item.importance) {
        case "critical":
          criticalItems.push(item);
          break;
        case "high":
          highItems.push(item);
          break;
        case "low":
          lowItems.push(item);
          break;
        case "normal":
        default:
          normalItems.push(item);
          break;
      }
    }

    // Sort within tiers by recency (newest first)
    highItems.sort((a, b) => b.createdAt - a.createdAt);
    normalItems.sort((a, b) => b.createdAt - a.createdAt);
    lowItems.sort((a, b) => b.createdAt - a.createdAt);

    const selected: ContextItem[] = [];
    let accumulatedTokens = 0;

    const getItemTokens = (item: ContextItem): number => {
      return item.tokenEstimate ?? this.estimator.estimate(item.content);
    };

    // Step 3: Always include CRITICAL items
    for (const item of criticalItems) {
      const tokens = getItemTokens(item);
      selected.push(item);
      accumulatedTokens += tokens;
    }

    // Step 4: Include HIGH-priority items
    for (const item of highItems) {
      const tokens = getItemTokens(item);
      if (accumulatedTokens + tokens <= budgetTokens) {
        selected.push(item);
        accumulatedTokens += tokens;
      } else {
        dropped.push(item);
      }
    }

    // Step 5: Add NORMAL-priority items
    for (const item of normalItems) {
      const tokens = getItemTokens(item);
      if (accumulatedTokens + tokens <= budgetTokens) {
        selected.push(item);
        accumulatedTokens += tokens;
      } else {
        dropped.push(item);
      }
    }

    // Step 6: Add LOW-priority items only if budget remains
    for (const item of lowItems) {
      const tokens = getItemTokens(item);
      if (accumulatedTokens + tokens <= budgetTokens) {
        selected.push(item);
        accumulatedTokens += tokens;
      } else {
        dropped.push(item);
      }
    }

    // Step 7: Record and return
    return {
      selected,
      dropped,
      duplicatesRemoved,
      totalEstimatedTokens: accumulatedTokens,
    };
  }
}

/** Default singleton instance */
export const defaultSelectionPolicy = new ContextSelectionPolicy();
