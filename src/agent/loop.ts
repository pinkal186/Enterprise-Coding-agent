/**
 * Autonomous Agent Execution Loop
 *
 * Implements the core mechanical feedback loop:
 * Context Assembly -> LLM Generation -> Tool Dispatch -> Safety Checks -> Observation -> Verification
 * Enforces iteration caps (FR-10), repeated-failure guards (AC-5), and verification requirements (AC-6).
 */

import type { LLMProvider, GenerateOptions } from "../llm/provider.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolContext } from "../tools/types.js";
import { ContextManager } from "../context/context.js";
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
  | "task_failed";

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
  contextManager?: ContextManager;
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
  private readonly contextManager: ContextManager;
  private readonly maxIterations: number;
  private readonly maxConsecutiveFailures: number;
  private readonly generateOptions?: GenerateOptions;
  private readonly verificationCommandPattern: RegExp;
  private readonly onEvent?: (event: AgentEvent) => void;

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.workspaceRoot = options.workspaceRoot;
    this.contextManager = options.contextManager || new ContextManager();
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
      // 1. Enforce iteration cap (FR-10 / AC-5)
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

      // 2. Assemble context
      const messages = this.contextManager.assemble(state.userRequest, state.messages);
      const toolDefinitions = this.toolRegistry.getDefinitions();

      this.emit("llm_request", state.taskId, {
        iteration: state.iterationCount,
        messageCount: messages.length,
        toolCount: toolDefinitions.length,
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
        const toolMessage = this.contextManager.createToolResultMessage(toolResult);
        state.addMessage(toolMessage);
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
