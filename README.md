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
   | `--debug-context` | Print detailed context items, token estimates, priorities, and inclusion status to stderr | `false` |
   | `--help`, `-h` | Show usage options | - |

#### Context Debug Mode (`--debug-context`)

Inspect how the context engine prioritizes, truncates, deduplicates, and compacts information before each model call:

```bash
npx tsx src/cli/main.ts "Fix bug in calculator.js" --workspace ./tests/fixtures/test-project --debug-context
```

Sample debug output on stderr:
```text
[CONTEXT DEBUG] Available: 27,904 / 32,000 tokens (usable budget: 27,904, estimated: 1,420, util: 5.1%)
  [CRITICAL] [INCLUDED] system_instruction (340 tokens)
  [CRITICAL] [INCLUDED] user_request (45 tokens)
  [CRITICAL] [INCLUDED] important_fact:bug-location (28 tokens)
  [HIGH]     [INCLUDED] recent_tool:read_file:calculator.js (215 tokens)
  [HIGH]     [INCLUDED] verification_failure:npm test (310 tokens)
  [NORMAL]   [TRUNCATED] file_content:large-file.ts (2,000 tokens, truncated from 4,800)
  [LOW]      [DROPPED]  old_search_result:glob (450 tokens)
```

---

## 🧠 Context Management & Token Efficiency Subsystem (Iteration 2)

The agent incorporates an autonomous, deterministic context management engine designed to keep multi-turn coding sessions strictly within model context limits without losing critical task state.

### Architecture

```
                 Agent Loop / State
                         │
                         ▼
        ┌─────────────────────────────────┐
        │     ManagedContextManager       │
        └─────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
┌──────────────────┐           ┌──────────────────┐
│  Token Estimator │           │ Policy Evaluator │
│  (char/heuristic)│           │ (Priority+Budget)│
└──────────────────┘           └──────────────────┘
         │                               │
         ▼                               ▼
┌──────────────────┐           ┌──────────────────┐
│ Head/Tail Trunc  │           │   Compactor      │
│ (Preserves Trace)│           │ (Deterministic)  │
└──────────────────┘           └──────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │     Selected Context Window   │
         │     (<= Usable Token Budget)  │
         └───────────────────────────────┘
```

### Prioritization Hierarchy (FR-18)

Items are categorized into 4 strict priority levels:
- **`CRITICAL` (Weight 4)**: User task instructions, system framing, important discovered facts, unverified status. **Never dropped or pruned.**
- **`HIGH` (Weight 3)**: Recent tool execution results, recent assistant decisions, verification test failures.
- **`NORMAL` (Weight 2)**: File inspection contents, workspace search results.
- **`LOW` (Weight 1)**: Older duplicate tool results, stale discovery data. Dropped first when approaching budget headroom.

### Truncation & Compaction (FR-17, FR-20)
- **Head/Tail Truncation**: When tool outputs exceed specific limits, truncators preserve the opening context and the critical ending (where error traces, stack traces, and exit statuses reside), inserting a clear omitted token count banner.
- **Deduplication**: Tool results with identical content hashes are deduplicated to eliminate wasteful repeated file reads.
- **Deterministic Compaction**: When context token utilization exceeds the configurable compaction threshold (default `80%`), deterministic structured summarization compresses older history into concise state summaries (files modified, test outcomes, discovered facts) while preserving the active user task and recent turns.

---

## ⚙️ Environment Variables & Configuration

Configure token limits, model settings, and safety policies via `.env` or system environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Google Gemini API key *(required for live LLM execution)* | None |
| `GEMINI_MODEL` | Default Gemini model identifier | `gemini-2.5-flash` |
| `MAX_AGENT_ITERATIONS` | Hard iteration cap before autonomous exit | `20` |
| `MAX_REPEATED_FAILURES` | Consecutive identical failing actions before exit | `3` |
| `COMMAND_TIMEOUT_MS` | Safe command execution timeout in milliseconds | `30000` |
| `MODEL_CONTEXT_TOKENS` | Maximum allowable context window tokens | `32000` |
| `MODEL_OUTPUT_TOKENS` | Tokens reserved exclusively for model completion | `4096` |
| `CONTEXT_COMPACTION_THRESHOLD`| Context utilization fraction (0.0 - 1.0) triggering compaction | `0.8` (80%) |
| `MAX_TOOL_OUTPUT_TOKENS` | Generic cap per individual tool result | `2000` |
| `MAX_FILE_READ_TOKENS` | Maximum tokens retained from a single file read | `2000` |
| `MAX_SEARCH_RESULT_TOKENS` | Maximum tokens retained from file search output | `1000` |
| `MAX_COMMAND_OUTPUT_TOKENS` | Maximum tokens retained from command execution stdout/stderr | `1500` |

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

  // 3. Initialize the Autonomous Loop with Guardrails & Context Management
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

### 1. Run All Tests (178 tests across 23 test suites)
```bash
npx vitest run
```

### 2. Run Specific Test Groups
- **Context Management Subsystem (Iteration 2)**:
  ```bash
  npx vitest run tests/unit/context/
  ```
- **Context Stress & Token Budgeting (AC-16, AC-17)**:
  ```bash
  npx vitest run tests/unit/context/stress.test.ts
  ```
- **Context Management Lifecycle Integration (AC-18)**:
  ```bash
  npx vitest run tests/integration/context-management.test.ts
  ```
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

Run the standalone coding evaluation tasks:

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
6. **Token Budget Headroom Enforcement (NFR-6 / FR-18)**:
   Context management strictly enforces model budget limits with priority-based selection, preventing context window overflow.
7. **Zero External Frameworks (NFR-3)**:
   Pure Node.js and TypeScript. No LangChain, CrewAI, or AutoGen abstractions.

