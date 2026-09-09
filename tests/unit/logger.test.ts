import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { StructuredLogger, type EventType } from "../../src/logging/logger.js";

describe("StructuredLogger (TASK-11)", () => {
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

  it("writes valid structured JSON event lines for all lifecycle event types", () => {
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

  it("strictly redacts API keys and sensitive tokens from log data", () => {
    const fakeKey = "AIzaSyD-SecretApiKey12345";
    const logger = new StructuredLogger({
      writer: (line) => outputLines.push(line),
      sensitiveTokens: [fakeKey],
    });

    logger.log("llm_request", "task_sec", {
      apiKey: fakeKey,
      nested: {
        authorization: "Bearer secret-token-xyz",
        url: `https://api.gemini.com/v1?key=${fakeKey}`,
      },
    });

    expect(outputLines).toHaveLength(1);
    const rawLine = outputLines[0];

    // Ensure raw secret key string is NOT in the output anywhere
    expect(rawLine).not.toContain(fakeKey);
    expect(rawLine).not.toContain("secret-token-xyz");

    const parsed = JSON.parse(rawLine);
    expect(parsed.data.apiKey).toBe("[REDACTED]");
    expect(parsed.data.nested.authorization).toBe("[REDACTED]");
    expect(parsed.data.nested.url).toContain("[REDACTED]");
  });
});
