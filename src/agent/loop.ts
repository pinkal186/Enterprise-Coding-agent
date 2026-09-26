/**
 * Autonomous Agent Execution Loop
 *
 * Implements the core mechanical feedback loop:
 * Context Assembly -> LLM Generation -> Tool Dispatch -> Safety Checks -> Observation -> Verification
 * Refactored in Iteration 2 (FR-24 / AC-11 / DECISION-566cf411):
 * All context preparation is delegated to ContextManager.buildManaged().
 * Enforces iteration caps (INVARIANT-72ddae88), repeated-failure guards (AC-5), and verification requirements (INVARIANT-cd74c5ed).
 */

import type { LLMProvider, GenerateOptions } from "../llm/provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { ContextManager } from "../context/context.js";
import { ManagedContextManager } from "../context/context-manager.js";
import type { ContextBudget } from "../context/types.js";
import { loadContextBudgetFromEnv } from "../context/policies.js";
import { TaskState } from "./state.js";

export const DEFAULT_MAX_ITERATIONS = 20;
export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;

export type AgentEventType =
  | "task_started"
  | "llm_request"
  | "llm_response"
  | "tool_requested"
  | "tool_completed"
  | "tool_failed"
  | "verification_completed"
  | "task_completed"
  | "task_failed"
  | "context_build_started"
  | "context_build_completed"
  | "context_item_truncated"
  | "context_item_dropped"
  | "context_compaction_started"
  | "context_compaction_completed";

function getItemSummary(item: {
  id?: string;
  type?: string;
  content?: string;
  source?: { filePath?: string; command?: string; toolName?: string };
}): string {
  if (item.id === "user-task") return "User task";
  if (item.id === "system-instruction") return "Current task state";
  if (item.source?.filePath) return item.source.filePath;
  if (item.source?.command) return `Latest test result (${item.source.command})`;
  if (item.source?.toolName) return `${item.source.toolName} result`;
  if (item.type === "important_fact") return `Fact: ${(item.content || "").slice(0, 40).trim()}`;
  if (item.type === "summary") return "Compacted summary";
  if (item.type === "tool_result") return "Tool result";
  return `${item.type || "item"}: ${(item.content || "").slice(0, 40).trim()}`;
}

export interface AgentEvent {
  type: AgentEventType;
  taskId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface AgentLoopOptions {
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  workspaceRoot: string;
  contextManager?: ManagedContextManager | ContextManager;
  budget?: ContextBudget;
  maxIterations?: number;
  maxConsecutiveFailures?: number;
  generateOptions?: GenerateOptions;
  verificationCommandPattern?: RegExp;
  onEvent?: (event: AgentEvent) => void;
}

export class AgentLoop {
  private readonly provider: LLMProvider;
  private readonly toolRegistry: ToolRegistry;
  private readonly workspaceRoot: string;
  private readonly managedContextManager: ManagedContextManager;
  private readonly budget: ContextBudget;
  private readonly maxIterations: number;
  private readonly maxConsecutiveFailures: number;
  private readonly generateOptions?: GenerateOptions;
  private readonly verificationCommandPattern: RegExp;
  private readonly onEvent?: (event: AgentEvent) => void;

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.workspaceRoot = options.workspaceRoot;
    this.budget = options.budget || loadContextBudgetFromEnv();

    // Resolve ManagedContextManager (supporting both modern coordinator and legacy shim)
    if (options.contextManager instanceof ManagedContextManager) {
      this.managedContextManager = options.contextManager;
    } else if (
      options.contextManager &&
      "getManagedDelegate" in options.contextManager &&
      typeof options.contextManager.getManagedDelegate === "function"
    ) {
      this.managedContextManager = options.contextManager.getManagedDelegate();
    } else {
      this.managedContextManager = new ManagedContextManager({
        budget: this.budget,
      });
    }

    this.maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
    this.maxConsecutiveFailures =
      options.maxConsecutiveFailures || DEFAULT_MAX_CONSECUTIVE_FAILURES;
    this.generateOptions = options.generateOptions;
    this.verificationCommandPattern =
      options.verificationCommandPattern || /(test|vitest|jest|check|build)/i;
    this.onEvent = options.onEvent;
  }

  private emit(type: AgentEventType, taskId: string, data: Record<string, unknown> = {}): void {
    if (this.onEvent) {
      this.onEvent({
        type,
        taskId,
        timestamp: Date.now(),
        data,
      });
    }
  }

  /**
   * Run the autonomous task loop until completion, iteration limit, or failure.
   */
  async run(userRequest: string, taskId?: string): Promise<TaskState> {
    const state = new TaskState({
      taskId,
      userRequest,
      workspaceRoot: this.workspaceRoot,
    });

    state.status = "running";
    this.emit("task_started", state.taskId, {
      userRequest,
      workspaceRoot: this.workspaceRoot,
    });

    const toolContext: ToolContext = {
      workspaceRoot: this.workspaceRoot,
    };

    let lastFailedCallKey: string | null = null;
    let consecutiveFailureCount = 0;
    let unverifiedFinishAttempts = 0;

    while (state.status === "running") {
      // 1. Enforce iteration cap (INVARIANT-72ddae88 / FR-10 / AC-5)
      if (state.iterationCount >= this.maxIterations) {
        state.fail(
          "iteration_limit",
          `Loop reached hard iteration cap (${this.maxIterations}). Terminating execution.`,
        );
        this.emit("task_failed", state.taskId, {
          reason: state.failureReason,
          iterations: state.iterationCount,
        });
        return state;
      }

      state.iterationCount++;

      // 2. Delegate all context preparation to ContextManager.buildManaged() (DECISION-566cf411 / FR-24)
      this.emit("context_build_started", state.taskId, {
        iteration: state.iterationCount,
      });

      const toolDefinitions = this.toolRegistry.getDefinitions();
      const buildResult = this.managedContextManager.buildManaged(
        state,
        toolDefinitions,
        this.budget
      );
      const messages = buildResult.messages;

      // Update state metrics from context build
      state.updateContextStats({
        totalItems: buildResult.metrics.totalItems,
        estimatedTokens: buildResult.estimatedTokens,
        utilization: buildResult.utilization,
        truncations: buildResult.metrics.truncatedItemsCount,
        compactions: buildResult.metrics.compactionsCount,
        droppedItems: buildResult.metrics.droppedItemsCount,
      });

      // Emit compaction events if compaction occurred
      if (buildResult.compactionEvent) {
        this.emit("context_compaction_started", state.taskId, {
          iteration: state.iterationCount,
          itemsBefore: buildResult.compactionEvent.itemsBefore,
          items_before: buildResult.compactionEvent.itemsBefore,
          tokensBefore: buildResult.compactionEvent.estimatedTokensBefore,
          tokens_before: buildResult.compactionEvent.estimatedTokensBefore,
        });
        this.emit("context_compaction_completed", state.taskId, {
          iteration: state.iterationCount,
          itemsBefore: buildResult.compactionEvent.itemsBefore,
          itemsAfter: buildResult.compactionEvent.itemsAfter,
          tokensBefore: buildResult.compactionEvent.estimatedTokensBefore,
          tokensAfter: buildResult.compactionEvent.estimatedTokensAfter,
          items_before: buildResult.compactionEvent.itemsBefore,
          items_after: buildResult.compactionEvent.itemsAfter,
          tokens_before: buildResult.compactionEvent.estimatedTokensBefore,
          tokens_after: buildResult.compactionEvent.estimatedTokensAfter,
        });
      }

      // Emit for truncated items
      if (buildResult.truncatedItems && buildResult.truncatedItems.length > 0) {
        for (const item of buildResult.truncatedItems) {
          this.emit("context_item_truncated", state.taskId, {
            iteration: state.iterationCount,
            itemId: item.id,
            itemType: item.type,
            originalTokenEstimate: item.originalTokenEstimate,
            finalTokenEstimate: item.finalTokenEstimate ?? item.tokenEstimate,
          });
        }
      }

      // Emit for dropped items
      if (buildResult.droppedItems && buildResult.droppedItems.length > 0) {
        for (const item of buildResult.droppedItems) {
          this.emit("context_item_dropped", state.taskId, {
            iteration: state.iterationCount,
            itemId: item.id,
            itemType: item.type,
            importance: item.importance,
            tokenEstimate: item.tokenEstimate,
          });
        }
      }

      const usableBudget = Math.max(
        1,
        this.budget.maxContextTokens - this.budget.reservedOutputTokens
      );

      // Context items with descriptions and dispositions for debugging / inspection
      const contextItemsDebug = [
        ...(buildResult.selectedItems || []).map((item) => ({
          id: item.id,
          type: item.type,
          importance: item.importance,
          description: getItemSummary(item),
          disposition: item.truncated ? "TRUNCATED" : "INCLUDED",
          tokenEstimate: item.tokenEstimate,
        })),
        ...(buildResult.droppedItems || []).map((item) => ({
          id: item.id,
          type: item.type,
          importance: item.importance,
          description: getItemSummary(item),
          disposition: "DROPPED",
          tokenEstimate: item.tokenEstimate,
        })),
      ];

      this.emit("context_build_completed", state.taskId, {
        iteration: state.iterationCount,
        estimatedTokens: buildResult.estimatedTokens,
        estimated_input_tokens: buildResult.estimatedTokens,
        context_budget: usableBudget,
        contextBudget: usableBudget,
        utilization: buildResult.utilization,
        metrics: buildResult.metrics,
        items: contextItemsDebug,
        selectedItems: buildResult.selectedItems,
        droppedItems: buildResult.droppedItems,
        compaction: buildResult.compactionEvent
          ? {
              itemsBefore: buildResult.compactionEvent.itemsBefore,
              itemsAfter: buildResult.compactionEvent.itemsAfter,
              tokensBefore: buildResult.compactionEvent.estimatedTokensBefore,
              tokensAfter: buildResult.compactionEvent.estimatedTokensAfter,
            }
          : null,
      });

      this.emit("llm_request", state.taskId, {
        iteration: state.iterationCount,
        messageCount: messages.length,
        toolCount: toolDefinitions.length,
        estimatedTokens: buildResult.estimatedTokens,
        estimated_input_tokens: buildResult.estimatedTokens,
        context_budget: usableBudget,
        contextBudget: usableBudget,
        utilization: buildResult.utilization,
        context_items: buildResult.metrics.totalItems,
        contextItems: buildResult.metrics.totalItems,
        truncated_items: buildResult.metrics.truncatedItemsCount,
        truncatedItems: buildResult.metrics.truncatedItemsCount,
        compactions: buildResult.metrics.compactionsCount,
        metrics: buildResult.metrics,
      });

      // 3. Call LLM provider
      let response;
      try {
        response = await this.provider.generate(
          messages,
          toolDefinitions,
          this.generateOptions,
        );
      } catch (err: unknown) {
        state.fail(
          "llm_error",
          `LLM provider failure: ${err instanceof Error ? err.message : String(err)}`,
        );
        this.emit("task_failed", state.taskId, {
          reason: state.failureReason,
          error: err instanceof Error ? err.message : String(err),
        });
        return state;
      }

      // Record token usage
      state.recordTokenUsage(response.usage);

      this.emit("llm_response", state.taskId, {
        iteration: state.iterationCount,
        responseType: response.type,
        hasToolCall: Boolean(response.toolCall),
        usage: response.usage,
      });

      // 4. Handle Decision
      if (response.type === "tool_call" && response.toolCall) {
        const toolCall = response.toolCall;

        // Record model's assistant turn with tool call
        state.addMessage({
          role: "assistant",
          content: response.text || "",
          toolCall,
        });

        this.emit("tool_requested", state.taskId, {
          toolName: toolCall.toolName,
          toolCallId: toolCall.id,
          arguments: toolCall.arguments,
        });

        // 5. Execute Tool via registry
        const toolResult = await this.toolRegistry.execute(
          toolCall.toolName,
          toolCall.arguments,
          toolContext,
          toolCall.id,
        );

        // Track modified files
        if (toolCall.toolName === "edit_file" && toolResult.success) {
          const filePath = (toolCall.arguments as { path?: string }).path;
          if (filePath) {
            state.recordFileModification(filePath);
          }
        }

        // Track executed commands and verify outcome
        if (toolCall.toolName === "run_command") {
          const cmd = (toolCall.arguments as { command?: string }).command || "";
          state.recordCommandExecution(cmd, toolResult.success ? 0 : 1, toolResult.success);

          if (this.verificationCommandPattern.test(cmd)) {
            const passed = toolResult.success;
            state.markVerified(passed);
            this.emit("verification_completed", state.taskId, {
              command: cmd,
              passed,
            });
          }
        }

        // Handle failure detection / loop breaker (AC-5)
        const callKey = `${toolCall.toolName}:${JSON.stringify(toolCall.arguments)}`;
        if (!toolResult.success) {
          this.emit("tool_failed", state.taskId, {
            toolName: toolCall.toolName,
            error: toolResult.error,
          });

          if (callKey === lastFailedCallKey) {
            consecutiveFailureCount++;
          } else {
            lastFailedCallKey = callKey;
            consecutiveFailureCount = 1;
          }

          if (consecutiveFailureCount >= this.maxConsecutiveFailures) {
            state.fail(
              "repeated_failure",
              `Identical tool action failed ${this.maxConsecutiveFailures} consecutive times: ${toolCall.toolName}`,
            );
            this.emit("task_failed", state.taskId, {
              reason: state.failureReason,
              repeatedAction: toolCall.toolName,
            });
            return state;
          }
        } else {
          this.emit("tool_completed", state.taskId, {
            toolName: toolCall.toolName,
            outputLength: toolResult.output.length,
          });
          lastFailedCallKey = null;
          consecutiveFailureCount = 0;
        }

        // 6. Append Tool Result to State
        state.addMessage({
          role: "tool",
          content: toolResult.output,
          toolResult,
        });
      } else {
        // Case B: Final text response produced by model
        const finalText = response.text || "";

        // Verification guard (INVARIANT-cd74c5ed / AC-6)
        // If files were modified or commands run, verification is mandatory
        if (state.modifiedFiles.size > 0 && !state.verificationPassed) {
          unverifiedFinishAttempts++;

          if (unverifiedFinishAttempts <= 2 && state.iterationCount < this.maxIterations) {
            // Prompt the model to verify its changes
            state.addMessage({
              role: "assistant",
              content: finalText,
            });
            state.addMessage({
              role: "user",
              content:
                "You have made file changes, but no verification command (e.g. 'npm test') has passed yet. Please run verification using 'run_command' to confirm your changes before completing the task.",
            });
            continue;
          }

          state.fail(
            "verification_failed",
            "Task finished without successful test/build verification.",
          );
          this.emit("task_failed", state.taskId, {
            reason: state.failureReason,
            finalText,
          });
          return state;
        }

        // Successfully completed
        state.complete(finalText);
        this.emit("task_completed", state.taskId, {
          iterations: state.iterationCount,
          modifiedFiles: Array.from(state.modifiedFiles),
          verified: state.verificationPassed,
        });
        return state;
      }
    }

    return state;
  }
}
