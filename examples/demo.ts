/**
 * Programmatic Usage Example
 *
 * Demonstrates how to instantiate and execute the Enterprise Coding Agent directly from TypeScript/JavaScript code.
 *
 * Usage:
 *   $env:GEMINI_API_KEY="your-api-key"
 *   npx tsx examples/demo.ts
 */

import path from "path";
import { GeminiProvider } from "../src/llm/gemini.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { ReadFileTool } from "../src/tools/read-file.js";
import { SearchTool } from "../src/tools/search.js";
import { EditFileTool } from "../src/tools/edit-file.js";
import { RunCommandTool } from "../src/tools/run-command.js";
import { AgentLoop } from "../src/agent/loop.js";

async function runCodingAgent() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: Please set GEMINI_API_KEY environment variable before running.");
    console.error("Example: $env:GEMINI_API_KEY=\"your_key_here\"");
    process.exit(1);
  }

  // 1. Choose the workspace directory the agent can operate within
  const targetWorkspace = path.resolve("./tests/fixtures/test-project");

  console.log("==================================================================");
  console.log("🚀 Starting Enterprise Coding Agent");
  console.log(`📂 Target Workspace: ${targetWorkspace}`);
  console.log("==================================================================\n");

  // 2. Set up the Tool Registry with safety-sandboxed tools
  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new SearchTool());
  registry.register(new EditFileTool());
  registry.register(new RunCommandTool());

  // 3. Initialize the Gemini LLM Provider (provider-agnostic abstraction)
  const provider = new GeminiProvider({
    apiKey,
    defaultModel: "gemini-2.5-flash",
  });

  // 4. Initialize the Autonomous Agent Loop with event hooks
  const loop = new AgentLoop({
    provider,
    toolRegistry: registry,
    workspaceRoot: targetWorkspace,
    maxIterations: 15,
    onEvent: (event) => {
      const time = new Date(event.timestamp).toLocaleTimeString();
      switch (event.type) {
        case "task_started":
          console.log(`[${time}] 🚀 Task: "${event.data.userRequest}"`);
          break;
        case "llm_request":
          console.log(`[${time}] 🧠 Iteration ${event.data.iteration}: Requesting model decision...`);
          break;
        case "tool_requested":
          console.log(`[${time}] 🔧 Tool Call -> ${event.data.toolName}(${JSON.stringify(event.data.arguments)})`);
          break;
        case "tool_completed":
          console.log(`[${time}] ✅ Tool Result -> ${event.data.toolName} succeeded`);
          break;
        case "tool_failed":
          console.log(`[${time}] ❌ Tool Failed -> ${event.data.toolName}: ${event.data.error}`);
          break;
        case "verification_completed":
          console.log(`[${time}] 🧪 Verification (${event.data.command}): ${event.data.passed ? "PASSED" : "FAILED"}`);
          break;
        case "task_completed":
          console.log(`[${time}] 🎉 Task completed in ${event.data.iterations} iterations!`);
          break;
        case "task_failed":
          console.log(`[${time}] 🛑 Task failed: ${event.data.reason}`);
          break;
      }
    },
  });

  // 5. Run the task
  const userRequest = "Inspect calculator.js and calculator.test.js, fix any bugs in calculator.js, and run the tests to verify the fix.";
  const state = await loop.run(userRequest);

  // 6. Inspect the result
  console.log("\n==================================================================");
  console.log("📋 Execution Summary");
  console.log(`Status:            ${state.status.toUpperCase()}`);
  console.log(`Total Iterations:  ${state.iterationCount}`);
  console.log(`Modified Files:    ${Array.from(state.modifiedFiles).join(", ") || "none"}`);
  console.log(`Commands Run:      ${state.executedCommands.length}`);
  console.log(`Verified:          ${state.verificationPassed ? "YES" : "NO"}`);
  console.log(`Token Usage:       Total ${state.tokenUsage.totalTokens} tokens`);

  if (state.status === "completed") {
    console.log(`\n💬 Solution:\n${state.finalAnswer}`);
  } else {
    console.log(`\n❌ Failed with reason: ${state.failureReason}`);
  }
  console.log("==================================================================");
}

runCodingAgent().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
