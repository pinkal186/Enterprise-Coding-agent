/**
 * CLI Runner and Argument Parser
 *
 * Configures the tool registry, LLM provider, and agent loop,
 * streaming progress and formatting results for the terminal (FR-1 / AC-1).
 */

import path from "path";
import { GeminiProvider, DEFAULT_GEMINI_MODEL } from "../llm/gemini.js";
import { ToolRegistry } from "../tools/registry.js";
import { ReadFileTool } from "../tools/read-file.js";
import { SearchTool } from "../tools/search.js";
import { EditFileTool } from "../tools/edit-file.js";
import { RunCommandTool } from "../tools/run-command.js";
import { AgentLoop, type AgentEvent } from "../agent/loop.js";
import type { TaskState } from "../agent/state.js";

export interface ParsedCliArgs {
  task: string;
  workspace: string;
  model: string;
  showHelp: boolean;
}

export function parseCliArgs(args: string[]): ParsedCliArgs {
  let task = "";
  let workspace = process.cwd();
  let model = DEFAULT_GEMINI_MODEL;
  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      showHelp = true;
    } else if (arg === "--workspace" || arg === "-w") {
      if (i + 1 < args.length) {
        workspace = path.resolve(args[++i]);
      }
    } else if (arg === "--model" || arg === "-m") {
      if (i + 1 < args.length) {
        model = args[++i];
      }
    } else if (!arg.startsWith("-") && !task) {
      task = arg;
    }
  }

  return {
    task,
    workspace,
    model,
    showHelp,
  };
}

export function formatEventMessage(event: AgentEvent): string | null {
  const time = new Date(event.timestamp).toLocaleTimeString();

  switch (event.type) {
    case "task_started":
      return `[${time}] 🚀 Task started: "${event.data.userRequest}" (Workspace: ${event.data.workspaceRoot})`;
    case "llm_request":
      return `[${time}] 🧠 Iteration ${event.data.iteration}: Requesting LLM decision (${event.data.messageCount} messages, ${event.data.toolCount} tools)...`;
    case "llm_response":
      return `[${time}] 💡 Model responded (${event.data.responseType})${event.data.usage ? ` [Tokens: ${(event.data.usage as { totalTokens?: number }).totalTokens || 0}]` : ""}`;
    case "tool_requested":
      return `[${time}] 🔧 Tool Call -> ${event.data.toolName}(${JSON.stringify(event.data.arguments)})`;
    case "tool_completed":
      return `[${time}] ✅ Tool Success -> ${event.data.toolName}`;
    case "tool_failed":
      return `[${time}] ❌ Tool Failure -> ${event.data.toolName}: ${event.data.error}`;
    case "verification_completed":
      return `[${time}] 🧪 Verification (${event.data.command}): ${event.data.passed ? "PASSED" : "FAILED"}`;
    case "task_completed":
      return `[${time}] 🎉 Task completed successfully in ${event.data.iterations} iterations!`;
    case "task_failed":
      return `[${time}] 🛑 Task failed: ${event.data.reason}`;
    default:
      return null;
  }
}

export async function runCli(
  args: string[],
  env: Record<string, string | undefined> = process.env,
  logger: { log: (msg: string) => void; error: (msg: string) => void } = console,
): Promise<{ exitCode: number; state?: TaskState }> {
  const parsed = parseCliArgs(args);

  if (parsed.showHelp || (!parsed.task && args.length === 0)) {
    logger.log(`
Enterprise Coding Agent — Autonomous Engineering Loop (Iteration 1)

Usage:
  npx tsx src/cli/main.ts "<task_description>" [options]

Options:
  --workspace, -w <dir>   Path to the workspace root directory (default: current working directory)
  --model, -m <model>     Gemini model identifier (default: ${DEFAULT_GEMINI_MODEL})
  --help, -h              Show this help message

Environment Variables:
  GEMINI_API_KEY          Required API key for Google Gemini API
`);
    return { exitCode: 0 };
  }

  if (!parsed.task) {
    logger.error("Error: Task description is required. Run with --help for usage instructions.");
    return { exitCode: 1 };
  }

  if (!env.GEMINI_API_KEY) {
    logger.error("Error: GEMINI_API_KEY environment variable is not set.");
    return { exitCode: 1 };
  }

  logger.log("==================================================================");
  logger.log("🚀 Enterprise Coding Agent — Iteration 1 Runtime");
  logger.log(`🎯 Task:      ${parsed.task}`);
  logger.log(`📂 Workspace: ${parsed.workspace}`);
  logger.log(`🤖 Model:     ${parsed.model}`);
  logger.log("==================================================================\n");

  // 1. Initialize Tools
  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new SearchTool());
  registry.register(new EditFileTool());
  registry.register(new RunCommandTool());

  // 2. Initialize Provider
  const provider = new GeminiProvider({
    apiKey: env.GEMINI_API_KEY,
    defaultModel: parsed.model,
  });

  // 3. Initialize Agent Loop
  const loop = new AgentLoop({
    provider,
    toolRegistry: registry,
    workspaceRoot: parsed.workspace,
    generateOptions: { model: parsed.model },
    onEvent: (event) => {
      const msg = formatEventMessage(event);
      if (msg) logger.log(msg);
    },
  });

  // 4. Run Task Loop
  const state = await loop.run(parsed.task);

  logger.log("\n==================================================================");
  logger.log(`📋 Execution Summary for Task: ${state.taskId}`);
  logger.log(`Status:            ${state.status.toUpperCase()}`);
  logger.log(`Iterations:        ${state.iterationCount}`);
  logger.log(`Modified Files:    ${Array.from(state.modifiedFiles).join(", ") || "none"}`);
  logger.log(`Commands Executed: ${state.executedCommands.length}`);
  logger.log(`Verified:          ${state.verificationPassed ? "YES (Tests Passed)" : "NO"}`);
  logger.log(
    `Token Usage:       In: ${state.tokenUsage.inputTokens}, Out: ${state.tokenUsage.outputTokens}, Total: ${state.tokenUsage.totalTokens}`,
  );

  if (state.status === "completed" && state.finalAnswer) {
    logger.log(`\n💬 Final Answer:\n${state.finalAnswer}`);
  } else if (state.status === "failed") {
    logger.log(`\n❌ Failure Reason: ${state.failureReason || "unknown"}`);
    if (state.finalAnswer) {
      logger.log(`Details: ${state.finalAnswer}`);
    }
  }
  logger.log("==================================================================");

  return {
    exitCode: state.status === "completed" ? 0 : 1,
    state,
  };
}
