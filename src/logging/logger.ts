/**
 * Structured Event Logger
 *
 * Writes structured JSON event logs for observability (FR-12).
 * Strictly redacts API keys and sensitive tokens before writing.
 */

import fs from "fs";
import path from "path";

export type EventType =
  | "task_started"
  | "llm_request"
  | "llm_response"
  | "tool_requested"
  | "tool_started"
  | "tool_completed"
  | "tool_failed"
  | "verification_started"
  | "verification_completed"
  | "task_completed"
  | "task_failed"
  | "context_build_started"
  | "context_build_completed"
  | "context_item_truncated"
  | "context_item_dropped"
  | "context_compaction_started"
  | "context_compaction_completed";

export interface LogEvent {
  type: EventType;
  taskId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface LoggerOptions {
  /** Optional file path to append JSONL logs to */
  logFilePath?: string;
  /** Optional stream/writer function (defaults to process.stderr.write) */
  writer?: (line: string) => void;
  /** Extra sensitive tokens to explicitly redact */
  sensitiveTokens?: string[];
}

export class StructuredLogger {
  private readonly logFilePath?: string;
  private readonly writer: (line: string) => void;
  private readonly sensitiveTokens: string[];

  constructor(options: LoggerOptions = {}) {
    this.logFilePath = options.logFilePath;
    this.writer = options.writer || ((line) => process.stderr.write(line + "\n"));

    const tokens: string[] = [...(options.sensitiveTokens || [])];
    if (process.env.GEMINI_API_KEY) {
      tokens.push(process.env.GEMINI_API_KEY);
    }
    this.sensitiveTokens = tokens.filter((t) => t && t.length > 0);

    if (this.logFilePath) {
      const dir = path.dirname(this.logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Logs a structured event.
   */
  log(type: EventType, taskId: string, data: Record<string, unknown> = {}): LogEvent {
    const event: LogEvent = {
      type,
      taskId,
      timestamp: new Date().toISOString(),
      data: this.redactSensitive(data) as Record<string, unknown>,
    };

    const line = JSON.stringify(event);

    // Write to stream
    this.writer(line);

    // Append to file if configured
    if (this.logFilePath) {
      try {
        fs.appendFileSync(this.logFilePath, line + "\n", "utf-8");
      } catch {
        // Silently continue if file write fails
      }
    }

    return event;
  }

  /**
   * Recursively traverses and redacts sensitive keys or token values.
   */
  redactSensitive(obj: unknown): unknown {
    if (typeof obj === "string") {
      let cleaned = obj;
      for (const token of this.sensitiveTokens) {
        if (token && cleaned.includes(token)) {
          cleaned = cleaned.replaceAll(token, "[REDACTED]");
        }
      }
      // Pattern-based API key redaction (e.g. Google Gemini keys: AIzaSy...)
      cleaned = cleaned.replace(/AIza[0-9A-Za-z-_]{30,50}/g, "[REDACTED]");
      return cleaned;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactSensitive(item));
    }

    if (obj !== null && typeof obj === "object") {
      const result: Record<string, unknown> = {};
      const sensitiveKeys = new Set([
        "apikey",
        "api_key",
        "key",
        "secret",
        "password",
        "token",
        "authorization",
        "auth",
        "bearer",
        "gemini_api_key",
      ]);

      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const lowerKey = key.toLowerCase();
        if (
          sensitiveKeys.has(lowerKey) ||
          lowerKey.endsWith("_key") ||
          lowerKey.endsWith("_token") ||
          lowerKey.endsWith("_secret")
        ) {
          result[key] = "[REDACTED]";
        } else {
          result[key] = this.redactSensitive(value);
        }
      }
      return result;
    }

    return obj;
  }
}
