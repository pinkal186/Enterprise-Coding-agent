import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { ContextMetricsAggregator } from "../../../src/context/context-metrics.js";
import type { ContextMetrics } from "../../../src/context/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---------------------------------------------------------------------------
// Provider isolation (NFR-1 / FR-23)
// ---------------------------------------------------------------------------

describe("Context Metrics — Provider Isolation (NFR-1)", () => {
  it("has zero imports from @google/genai or any other provider SDK", () => {
    const filePath = resolve(__dirname, "../../../src/context/context-metrics.ts");
    const content = readFileSync(filePath, "utf-8");

    expect(content).not.toContain("@google/genai");
    expect(content).not.toContain("google");
    expect(content).not.toContain("openai");
    expect(content).not.toContain("anthropic");
  });
});

// ---------------------------------------------------------------------------
// Metrics Aggregation (FR-23)
// ---------------------------------------------------------------------------

describe("Context Metrics Aggregator (FR-23)", () => {
  it("handles empty history cleanly", () => {
    const aggregator = new ContextMetricsAggregator();
    const summary = aggregator.summarize();

    expect(summary.totalRequests).toBe(0);
    expect(summary.avgEstimatedTokens).toBe(0);
    expect(summary.maxEstimatedTokens).toBe(0);
    expect(summary.avgUtilization).toBe(0);
    expect(summary.maxUtilization).toBe(0);
    expect(summary.totalCompactions).toBe(0);
    expect(summary.totalTruncations).toBe(0);
    expect(summary.totalDroppedItems).toBe(0);
  });

  it("records metrics and accurately computes averages and totals", () => {
    const aggregator = new ContextMetricsAggregator();

    const m1: ContextMetrics = {
      iteration: 1,
      estimatedInputTokens: 4000,
      contextUtilization: 0.2,
      totalItems: 5,
      toolResultsCount: 1,
      truncatedItemsCount: 0,
      droppedItemsCount: 0,
      compactionsCount: 0,
    };

    const m2: ContextMetrics = {
      iteration: 2,
      estimatedInputTokens: 8000,
      contextUtilization: 0.4,
      totalItems: 9,
      toolResultsCount: 3,
      truncatedItemsCount: 1,
      droppedItemsCount: 2,
      compactionsCount: 1,
    };

    aggregator.record(m1);
    aggregator.record(m2);

    expect(aggregator.getHistory()).toHaveLength(2);
    expect(aggregator.getLatest()).toEqual(m2);

    const summary = aggregator.summarize();
    expect(summary.totalRequests).toBe(2);
    expect(summary.avgEstimatedTokens).toBe(6000);
    expect(summary.maxEstimatedTokens).toBe(8000);
    expect(summary.avgUtilization).toBe(0.3);
    expect(summary.maxUtilization).toBe(0.4);
    expect(summary.totalCompactions).toBe(1);
    expect(summary.totalTruncations).toBe(1);
    expect(summary.totalDroppedItems).toBe(2);
  });

  it("formats summary string for observability", () => {
    const aggregator = new ContextMetricsAggregator();
    aggregator.record({
      estimatedInputTokens: 10000,
      contextUtilization: 0.35,
      totalItems: 8,
      toolResultsCount: 2,
      truncatedItemsCount: 1,
      droppedItemsCount: 3,
      compactionsCount: 1,
    });

    const formatted = aggregator.formatSummary();
    expect(formatted).toContain("Context Requests: 1");
    expect(formatted).toContain("10000");
    expect(formatted).toContain("35.0%");
    expect(formatted).toContain("Total Compactions: 1");
    expect(formatted).toContain("Total Truncations: 1");
  });

  it("clears recorded history on clear()", () => {
    const aggregator = new ContextMetricsAggregator();
    aggregator.record({
      estimatedInputTokens: 100,
      contextUtilization: 0.05,
      totalItems: 1,
      toolResultsCount: 0,
      truncatedItemsCount: 0,
      droppedItemsCount: 0,
      compactionsCount: 0,
    });
    expect(aggregator.getHistory()).toHaveLength(1);
    aggregator.clear();
    expect(aggregator.getHistory()).toHaveLength(0);
  });
});
