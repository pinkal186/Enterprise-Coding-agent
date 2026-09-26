/**
 * Context Metrics Aggregation & Tracking
 *
 * Implements FR-23 for Iteration 2 Context Management.
 * Aggregates context metrics across LLM requests, computes averages,
 * utilization statistics, and provides formatting for structured logs and CLI.
 */

import type { ContextMetrics } from "./types.js";

export interface AggregatedContextMetrics {
  totalRequests: number;
  avgEstimatedTokens: number;
  maxEstimatedTokens: number;
  avgUtilization: number;
  maxUtilization: number;
  totalCompactions: number;
  totalTruncations: number;
  totalDroppedItems: number;
}

export class ContextMetricsAggregator {
  private readonly history: ContextMetrics[] = [];

  /**
   * Records a ContextMetrics snapshot from an LLM request turn.
   */
  record(metrics: ContextMetrics): void {
    this.history.push({ ...metrics });
  }

  /**
   * Returns a copy of the recorded metrics history.
   */
  getHistory(): ContextMetrics[] {
    return [...this.history];
  }

  /**
   * Returns the most recent recorded metrics snapshot, if any.
   */
  getLatest(): ContextMetrics | undefined {
    return this.history.length > 0 ? this.history[this.history.length - 1] : undefined;
  }

  /**
   * Summarizes all recorded metrics into an aggregated statistics report.
   */
  summarize(): AggregatedContextMetrics {
    if (this.history.length === 0) {
      return {
        totalRequests: 0,
        avgEstimatedTokens: 0,
        maxEstimatedTokens: 0,
        avgUtilization: 0,
        maxUtilization: 0,
        totalCompactions: 0,
        totalTruncations: 0,
        totalDroppedItems: 0,
      };
    }

    let sumTokens = 0;
    let maxTokens = 0;
    let sumUtil = 0;
    let maxUtil = 0;
    let totalCompactions = 0;
    let totalTruncations = 0;
    let totalDropped = 0;

    for (const m of this.history) {
      sumTokens += m.estimatedInputTokens;
      maxTokens = Math.max(maxTokens, m.estimatedInputTokens);
      sumUtil += m.contextUtilization;
      maxUtil = Math.max(maxUtil, m.contextUtilization);
      totalCompactions += m.compactionsCount;
      totalTruncations += m.truncatedItemsCount;
      totalDropped += m.droppedItemsCount;
    }

    return {
      totalRequests: this.history.length,
      avgEstimatedTokens: Math.round(sumTokens / this.history.length),
      maxEstimatedTokens: maxTokens,
      avgUtilization: Number((sumUtil / this.history.length).toFixed(4)),
      maxUtilization: Number(maxUtil.toFixed(4)),
      totalCompactions,
      totalTruncations,
      totalDroppedItems: totalDropped,
    };
  }

  /**
   * Formats aggregated metrics as a human-readable summary string for CLI/debug.
   */
  formatSummary(): string {
    const summary = this.summarize();
    return [
      `Context Requests: ${summary.totalRequests}`,
      `Avg / Max Estimated Tokens: ${summary.avgEstimatedTokens} / ${summary.maxEstimatedTokens}`,
      `Avg / Max Utilization: ${(summary.avgUtilization * 100).toFixed(1)}% / ${(summary.maxUtilization * 100).toFixed(1)}%`,
      `Total Compactions: ${summary.totalCompactions}`,
      `Total Truncations: ${summary.totalTruncations}`,
      `Total Dropped Items: ${summary.totalDroppedItems}`,
    ].join("\n");
  }

  /**
   * Clears all recorded metrics.
   */
  clear(): void {
    this.history.length = 0;
  }
}

/** Default singleton metrics aggregator */
export const defaultMetricsAggregator = new ContextMetricsAggregator();
