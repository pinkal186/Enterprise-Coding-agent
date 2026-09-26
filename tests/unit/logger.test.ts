import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { StructuredLogger, type EventType } from "../../src/logging/logger.js";

describe("StructuredLogger (TASK-11 & TASK-25)", () => {
  let tempDir: string;
  let logFile: string;
  let outputLines: string[];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
    logFile = path.join(tempDir, "events.jsonl");
    outputLines = [];
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  it("writes valid structured JSON event lines for all 17 lifecycle and context event types", () => {
    const logger = new StructuredLogger({
      writer: (line) => outputLines.push(line),
      logFilePath: logFile,
    });

    const eventTypes: EventType[] = [
      "task_started",
      "llm_request",
      "llm_response",
      "tool_requested",
      "tool_started",
      "tool_completed",
      "tool_failed",
      "verification_started",
      "verification_completed",
      "task_completed",
      "task_failed",
      "context_build_started",
      "context_build_completed",
      "context_item_truncated",
      "context_item_dropped",
      "context_compaction_started",
      "context_compaction_completed",
    ];

    for (const type of eventTypes) {
      logger.log(type, "task_123", { detail: `Detail for ${type}` });
    }

    expect(outputLines).toHaveLength(eventTypes.length);

    // Verify written JSON lines
    for (let i = 0; i < eventTypes.length; i++) {
      const parsed = JSON.parse(outputLines[i]);
      expect(parsed.type).toBe(eventTypes[i]);
      expect(parsed.taskId).toBe("task_123");
      expect(parsed.timestamp).toBeDefined();
      expect(parsed.data.detail).toBe(`Detail for ${eventTypes[i]}`);
    }

    // Verify file output
    const fileContent = fs.readFileSync(logFile, "utf-8");
    const fileLines = fileContent.trim().split("\n");
    expect(fileLines).toHaveLength(eventTypes.length);
  });

  it("logs context metrics in llm_request payload (FR-26, AC-12)", () => {
    const logger = new StructuredLogger({
      writer: (line) => outputLines.push(line),
    });

    logger.log("llm_request", "task_metric", {
      iteration: 3,
      estimated_input_tokens: 8420,
      context_budget: 28000,
      utilization: 0.301,
      context_items: 19,
      truncated_items: 1,
      compactions: 0,
    });

    expect(outputLines).toHaveLength(1);
    const parsed = JSON.parse(outputLines[0]);
    expect(parsed.type).toBe("llm_request");
    expect(parsed.taskId).toBe("task_metric");
    expect(parsed.data.estimated_input_tokens).toBe(8420);
    expect(parsed.data.context_budget).toBe(28000);
    expect(parsed.data.utilization).toBe(0.301);
    expect(parsed.data.context_items).toBe(19);
    expect(parsed.data.truncated_items).toBe(1);
    expect(parsed.data.compactions).toBe(0);
  });

  it("logs context compaction events with before and after item and token counts (AC-15)", () => {
    const logger = new StructuredLogger({
      writer: (line) => outputLines.push(line),
    });

    logger.log("context_compaction_started", "task_comp", {
      iteration: 5,
      items_before: 24,
      tokens_before: 28100,
    });

    logger.log("context_compaction_completed", "task_comp", {
      iteration: 5,
      items_before: 24,
      items_after: 9,
      tokens_before: 28100,
      tokens_after: 7400,
    });

    expect(outputLines).toHaveLength(2);
    const started = JSON.parse(outputLines[0]);
    expect(started.type).toBe("context_compaction_started");
    expect(started.data.items_before).toBe(24);
    expect(started.data.tokens_before).toBe(28100);

    const completed = JSON.parse(outputLines[1]);
    expect(completed.type).toBe("context_compaction_completed");
    expect(completed.data.items_before).toBe(24);
    expect(completed.data.items_after).toBe(9);
    expect(completed.data.tokens_before).toBe(28100);
    expect(completed.data.tokens_after).toBe(7400);
  });

  it("logs context item truncated and dropped events (AC-15)", () => {
    const logger = new StructuredLogger({
      writer: (line) => outputLines.push(line),
    });

    logger.log("context_item_truncated", "task_trunc", {
      itemId: "tool-res-1",
      originalTokenEstimate: 5000,
      finalTokenEstimate: 2000,
    });

    logger.log("context_item_dropped", "task_trunc", {
      itemId: "old-search-2",
      importance: "low",
      tokenEstimate: 800,
    });

    expect(outputLines).toHaveLength(2);
    const trunc = JSON.parse(outputLines[0]);
    expect(trunc.type).toBe("context_item_truncated");
    expect(trunc.data.originalTokenEstimate).toBe(5000);
    expect(trunc.data.finalTokenEstimate).toBe(2000);

    const drop = JSON.parse(outputLines[1]);
    expect(drop.type).toBe("context_item_dropped");
    expect(drop.data.importance).toBe("low");
    expect(drop.data.tokenEstimate).toBe(800);
  });

  it("strictly redacts API keys and sensitive tokens from log data (AC-15)", () => {
    const fakeKey = "AIzaSyD-SecretApiKey12345678901234";
    const logger = new StructuredLogger({
      writer: (line) => outputLines.push(line),
      sensitiveTokens: [fakeKey],
    });

    logger.log("llm_request", "task_sec", {
      apiKey: fakeKey,
      gemini_api_key: fakeKey,
      nested: {
        authorization: "Bearer secret-token-xyz",
        url: `https://api.gemini.com/v1?key=${fakeKey}`,
        auth_token: "secret-token-123",
      },
    });

    expect(outputLines).toHaveLength(1);
    const rawLine = outputLines[0];

    // Ensure raw secret key string is NOT in the output anywhere
    expect(rawLine).not.toContain(fakeKey);
    expect(rawLine).not.toContain("secret-token-xyz");
    expect(rawLine).not.toContain("secret-token-123");

    const parsed = JSON.parse(rawLine);
    expect(parsed.data.apiKey).toBe("[REDACTED]");
    expect(parsed.data.gemini_api_key).toBe("[REDACTED]");
    expect(parsed.data.nested.authorization).toBe("[REDACTED]");
    expect(parsed.data.nested.auth_token).toBe("[REDACTED]");
    expect(parsed.data.nested.url).toContain("[REDACTED]");
  });

  it("redacts pattern-matched API keys even when not in sensitiveTokens list (AC-15)", () => {
    const unlistedKey = "AIzaSyB12345678901234567890123456789";
    const logger = new StructuredLogger({
      writer: (line) => outputLines.push(line),
      sensitiveTokens: [],
    });

    logger.log("context_item_truncated", "task_leak_check", {
      content: `Prompt with unlisted API key: ${unlistedKey} inside tool result`,
    });

    expect(outputLines).toHaveLength(1);
    const rawLine = outputLines[0];
    expect(rawLine).not.toContain(unlistedKey);
    expect(rawLine).toContain("[REDACTED]");
  });
});
