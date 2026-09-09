# Enterprise Coding Agent (Iteration 1)

A minimal, transparent, provider-agnostic coding agent built from scratch in TypeScript without bloated multi-agent frameworks. Implements the core mechanical feedback loop:

$$\text{Context Assembly} \longrightarrow \text{Model Decision} \longrightarrow \text{Tool Dispatch} \longrightarrow \text{Observation} \longrightarrow \text{Verification}$$

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher (v22+ recommended)
- **npm**: v9.0.0 or higher
- **Gemini API Key**: (Optional for unit/integration tests; required for live model execution)

### 2. Install Dependencies
```bash
npm install
```

---

## 🚀 How to Run the Agent

### Method A: Via Command Line Interface (CLI)

1. **Set your API Key** (Windows PowerShell):
   ```powershell
   $env:GEMINI_API_KEY="your-gemini-api-key-here"
   ```
   *(On macOS/Linux: `export GEMINI_API_KEY="your-gemini-api-key-here"`)*

2. **Execute on a target repository**:
   ```bash
   npx tsx src/cli/main.ts "Fix the failing tests in calculator.test.js" --workspace ./tests/fixtures/test-project
   ```

3. **CLI Options**:
   ```bash
   npx tsx src/cli/main.ts --help
   ```
   | Flag | Description | Default |
   | :--- | :--- | :--- |
   | `--workspace`, `-w` | Target workspace directory path | Current working directory (`.`) |
   | `--model`, `-m` | Gemini model name | `gemini-2.5-flash` |
   | `--help`, `-h` | Show usage options | - |

---

### Method B: Programmatic TypeScript Execution

You can embed and invoke the coding agent directly within your own Node.js/TypeScript applications.

A ready-to-run example is available at [`examples/demo.ts`](examples/demo.ts):

```bash
$env:GEMINI_API_KEY="your-gemini-api-key-here"
npx tsx examples/demo.ts
```

#### Sample Code:

```typescript
import path from "path";
import { GeminiProvider } from "./src/llm/gemini.js";
import { ToolRegistry } from "./src/tools/registry.js";
import { ReadFileTool } from "./src/tools/read-file.js";
import { SearchTool } from "./src/tools/search.js";
import { EditFileTool } from "./src/tools/edit-file.js";
import { RunCommandTool } from "./src/tools/run-command.js";
import { AgentLoop } from "./src/agent/loop.js";

async function main() {
  const workspaceRoot = path.resolve("./my-project");

  // 1. Initialize Safety-Sandboxed Tools
  const registry = new ToolRegistry();
  registry.register(new ReadFileTool());
  registry.register(new SearchTool());
  registry.register(new EditFileTool());
  registry.register(new RunCommandTool());

  // 2. Initialize the LLM Provider
  const provider = new GeminiProvider({
    apiKey: process.env.GEMINI_API_KEY,
    defaultModel: "gemini-2.5-flash",
  });

  // 3. Initialize the Autonomous Loop with Guardrails
  const loop = new AgentLoop({
    provider,
    toolRegistry: registry,
    workspaceRoot,
    maxIterations: 20, // Hard iteration cap (FR-10)
    onEvent: (event) => console.log(`[${event.type}]`, event.data),
  });

  // 4. Run Task
  const state = await loop.run("Fix the addition bug in src/math.ts and run npm test");

  console.log("Status:", state.status);
  console.log("Verified by tests:", state.verificationPassed);
  console.log("Modified files:", Array.from(state.modifiedFiles));
  console.log("Solution:", state.finalAnswer);
}

main();
```

---

## 🧪 How to Run Tests

No API key is required to run the automated test suites:

### 1. Run All Tests (98 tests across 13 test suites)
```bash
npx vitest run
```

### 2. Run Specific Test Groups
- **LLM Types & Provider Isolation (NFR-1)**:
  ```bash
  npx vitest run tests/unit/llm-types.test.ts
  ```
- **Gemini Adapter (with Mocked SDK)**:
  ```bash
  npx vitest run tests/unit/gemini-adapter.test.ts
  ```
- **File System Tools & Sandboxing (Read, Search, Edit)**:
  ```bash
  npx vitest run tests/unit/read-file.test.ts
  npx vitest run tests/unit/search.test.ts
  npx vitest run tests/unit/edit-file.test.ts
  ```
- **Command Safety Policy (AC-4)**:
  ```bash
  npx vitest run tests/unit/run-command.test.ts
  ```
- **Agent Loop, Iteration Limit & Repeated-Failure Detection (AC-5, AC-6)**:
  ```bash
  npx vitest run tests/unit/agent-loop.test.ts
  ```
- **Autonomous End-to-End Bug Fix Integration Test (AC-8)**:
  ```bash
  npx vitest run tests/integration/agent-integration.test.ts
  ```

---

## 📊 Run Real Evaluation Suites (AC-9)

Run the 5 standalone coding evaluation tasks:

```bash
# Run all 5 tasks sequentially
node eval/run.mjs --all

# Or run an individual task (task 1 through 5)
node eval/run.mjs --task 1
```

Each task automatically saves its verified execution outcome to `eval/tasks/task-X/result.json`.

---

## 🛡️ Built-in Guardrails & Invariants

1. **Workspace Sandboxing (INVARIANT-7e79919c / NFR-2)**:
   All file operations (`read_file`, `search_files`, `edit_file`) and command executions strictly reject paths outside the designated workspace root.
2. **Command Safety Policy (AC-4)**:
   Non-allowlisted or destructive commands (`rm -rf`, `curl`, `wget`, `del /s`, etc.) are automatically denied with a structured error.
3. **Mandatory Verification (INVARIANT-cd74c5ed / AC-6)**:
   The agent cannot declare success without an executed, passing verification command (`npm test`, `vitest`, etc.).
4. **Hard Iteration Cap (INVARIANT-72ddae88 / FR-10)**:
   Execution terminates after 20 iterations to prevent infinite thrashing or runaway token costs.
5. **Repeated Failing Action Loop Breaker (AC-5)**:
   3 consecutive identical failing tool actions automatically stop the agent with a `repeated_failure` error.
6. **Zero External Frameworks (NFR-3)**:
   Pure Node.js and TypeScript. No LangChain, CrewAI, or AutoGen abstractions.
