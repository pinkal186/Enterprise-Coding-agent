/**
 * Task Execution State Management
 *
 * Tracks the complete runtime state of an autonomous agent task (FR-11, FR-25).
 * Extended in Iteration 2 with importantFacts and contextStats tracking.
 */

import type { Message, UsageInfo } from "../llm/types.js";
import type { ContextStats, ImportantFact } from "../context/types.js";

export type TaskStatus = "idle" | "running" | "completed" | "failed";

export type TaskFailureReason =
  | "iteration_limit"
  | "repeated_failure"
  | "verification_failed"
  | "safety_denied"
  | "llm_error"
  | "unhandled_error";

export interface ExecutedCommandRecord {
  command: string;
  exitCode: number;
  success: boolean;
  timestamp: number;
}

export class TaskState {
  readonly taskId: string;
  readonly userRequest: string;
  readonly workspaceRoot: string;

  status: TaskStatus = "idle";
  failureReason?: TaskFailureReason;
  iterationCount = 0;
  messages: Message[] = [];
  modifiedFiles = new Set<string>();
  executedCommands: ExecutedCommandRecord[] = [];
  verificationPassed = false;
  finalAnswer?: string;

  // Context management extensions (FR-25)
  importantFacts: ImportantFact[] = [];
  contextStats: ContextStats = {
    totalItems: 0,
    estimatedTokens: 0,
    utilization: 0,
    truncations: 0,
    compactions: 0,
    droppedItems: 0,
  };

  tokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  constructor(opts: {
    taskId?: string;
    userRequest: string;
    workspaceRoot: string;
  }) {
    this.taskId =
      opts.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.userRequest = opts.userRequest;
    this.workspaceRoot = opts.workspaceRoot;
  }

  addMessage(message: Message): void {
    this.messages.push(message);
  }

  recordFileModification(filePath: string): void {
    this.modifiedFiles.add(filePath);
  }

  recordCommandExecution(command: string, exitCode: number, success: boolean): void {
    this.executedCommands.push({
      command,
      exitCode,
      success,
      timestamp: Date.now(),
    });
  }

  recordTokenUsage(usage?: UsageInfo): void {
    if (!usage) return;
    this.tokenUsage.inputTokens += usage.inputTokens || 0;
    this.tokenUsage.outputTokens += usage.outputTokens || 0;
    this.tokenUsage.totalTokens += usage.totalTokens || 0;
  }

  /**
   * Adds an important fact to the structured store (FR-25).
   */
  addImportantFact(
    fact: ImportantFact | string,
    importance: ImportantFact["importance"] = "normal"
  ): void {
    if (typeof fact === "string") {
      this.importantFacts.push({
        id: `fact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        content: fact,
        importance,
        createdAt: Date.now(),
      });
    } else {
      this.importantFacts.push(fact);
    }
  }

  /**
   * Updates context stats summary metrics (FR-25).
   */
  updateContextStats(stats: Partial<ContextStats>): void {
    this.contextStats = {
      ...this.contextStats,
      ...stats,
    };
  }

  markVerified(passed: boolean): void {
    this.verificationPassed = passed;
  }

  complete(finalAnswer: string): void {
    this.status = "completed";
    this.finalAnswer = finalAnswer;
  }

  fail(reason: TaskFailureReason, finalAnswer?: string): void {
    this.status = "failed";
    this.failureReason = reason;
    if (finalAnswer) {
      this.finalAnswer = finalAnswer;
    }
  }
}
