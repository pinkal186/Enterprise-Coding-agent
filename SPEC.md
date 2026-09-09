# Product specification — Engineering Agent (Iteration 1)

> Status: draft. A coding agent must not implement product code until this specification is approved through Genesis.

## Problem

Software developers and researchers need a transparent, minimal, provider-agnostic coding agent built from scratch to understand the core mechanical feedback loop of AI-assisted engineering (Model → Tool Request → Tool Execution → Observation → Verification). Existing commercial coding agents hide runtime mechanics, couple tightly to specific proprietary APIs, or rely on bloated multi-agent frameworks that obscure basic failure modes.

## Users

- Software Engineers & AI Researchers: Individuals running coding tasks against local repositories through a CLI to inspect agent reasoning, observe tool interactions, measure token/context efficiency, and diagnose failure modes.
- System Evaluators: Developers benchmarking coding agent reliability across repeatable task suites using automated evaluation fixtures and structured failure classification.

## Functional requirements

- FR-1: CLI Entry Point — The CLI must accept a coding task string, optional workspace path (`--workspace`), and optional model configuration (`--model`), stream progress/actions to stdout, and exit with an appropriate status code.
- FR-2: Provider-Agnostic LLM Interface — The core agent runtime must interface with LLMs exclusively via an internal protocol (`generate(messages, tools, options) -> LLMResponse`) that normalizes messages, tool definitions, tool calls, token usage, and provider errors.
- FR-3: Gemini Provider Adapter — A concrete provider adapter must translate internal types to/from Google Gemini API requests/responses, authenticate via `GEMINI_API_KEY`, and handle API errors cleanly.
- FR-4: Tool Registry & Protocol — A centralized tool registry must register, validate, and invoke tools implementing a standard contract (`name`, `description`, `inputSchema`, `execute(input, context)`).
- FR-5: File Search Tool — The agent must locate files and code occurrences inside the workspace by query string/pattern without loading entire files, returning structured file paths, line numbers, and matching text snippets.
- FR-6: Read File Tool — The agent must read full or partial line ranges (`startLine`, `endLine`) of workspace files, enforcing output size limits with clear truncation notices.
- FR-7: Edit / Write File Tool — The agent must create new files or modify existing files inside the workspace using deterministic text replacement or complete file writes, recording modified paths in task state.
- FR-8: Run Command Tool — The agent must execute shell commands within the workspace under a configurable timeout, capturing exit code, stdout, stderr, and execution status.
- FR-9: Agent Execution Loop — The runtime must execute an autonomous loop: Build Context -> Send to Model -> Parse Decision -> (If Tool: Safety Check -> Execute -> Observe -> Update Context -> Repeat; If Final Text: Run Verification -> Return Status).
- FR-10: Loop Bounds & Repeated-Failure Guard — The loop must terminate with a failed status if `MAX_AGENT_ITERATIONS` (default 20) is reached or if identical failing actions repeat consecutively past a configured threshold.
- FR-11: Task State & Verification — The runtime must maintain in-memory task state (task ID, user request, iteration count, modified files, executed commands, verification outcome, completion status) and require verification command execution before declaring success.
- FR-12: Structured Observability & Logging — The agent must log structured JSON events (`task_started`, `llm_request`, `llm_response`, `tool_requested`, `tool_completed`, `tool_failed`, `verification_completed`, `task_completed`, `task_failed`) without leaking sensitive API keys.
- FR-13: Progress Checklist Tracking — The project must maintain `IMPLEMENTATION_PROGRESS.md` at the repository root detailing real-time status across all setup, implementation, testing, and evaluation steps.

## Non-functional requirements

- NFR-1: Provider Isolation — Zero imports or direct dependencies on `@google/genai` or any provider SDK outside the `src/llm/` provider adapters.
- NFR-2: Strict Workspace Sandboxing — All file and command operations must strictly reject paths or targets outside the designated workspace root directory.
- NFR-3: Zero Agent Framework Dependency — Built using standard TypeScript / Node.js standard libraries and lightweight utilities (`zod` for schemas, `vitest` for testing) without LangChain, AutoGen, CrewAI, or similar abstractions.
- NFR-4: Bounded Context & Output Protection — All tool outputs (search results, file reads, command stdout/stderr) must enforce strict character/byte caps to prevent context blowout.
- NFR-5: Cross-Platform Execution — Must run deterministically on Windows, macOS, and Linux without platform-specific shell quirks.

## Constraints

- Runtime environment is Node.js 18+ and TypeScript (ESNext / NodeNext modules).
- Package management through npm.
- Primary SDK is the official Google Gen AI SDK (`@google/genai`) for the Gemini adapter.
- Authentication via environment variable `GEMINI_API_KEY`.
- No interactive shell prompts during automated evaluation runs.

## Non-goals

- Deferred to Iteration 2: Complex context compaction, conversation pruning, relevance-based file ranking, token budget managers.
- Deferred to Iteration 3: Repository AST indexing, symbol jump graphizer, file tree caching.
- Deferred to Iteration 5: Multi-step hierarchical planning engines.
- Deferred to Iteration 6-7: External skill loading, dynamic plugin marketplace, MCP protocol integration.
- Deferred to Iteration 8: Automatic git commit / git push tools.
- Deferred to Iteration 9: Sub-agent spawning and delegation.
- Deferred to Iteration 10-11: RAG, vector databases, embeddings, long-term cross-session memory.
- Deferred to Future: Graphical Web UI or IDE extensions.

## Acceptance criteria

- AC-1: CLI Execution — Executing `npx tsx src/cli/main.ts "Fix the bug"` against a target repository runs the full autonomous loop and outputs structured terminal progress and exit code.
- AC-2: Gemini Adapter & Tool Protocol — The Gemini provider adapter successfully translates model function calls into internal `ToolCall` types and sends back `ToolResult` messages.
- AC-3: Workspace Boundary Enforcement — Attempts to read, search, or edit paths outside the workspace fail with immediate safety rejection errors.
- AC-4: Command Policy Enforcement — Disallowed destructive commands are blocked by the safety policy with a `DENY` response.
- AC-5: Loop Termination on Limits — Tasks exceeding iteration caps or trapped in repeating identical failures terminate deterministically with explicit reason codes (`iteration_limit`, `repeated_failure`).
- AC-6: Verification Required — Tasks cannot return `success: true` unless a verification command was executed and returned exit code 0.
- AC-7: Unit Test Suite — 100% pass rate on unit tests covering LLM translation, tool registry, Read File, Search, Edit File, Run Command, Agent Loop, Safety Policy, and Context.
- AC-8: Integration Test Fixture — Automated end-to-end integration test runs against a local test fixture repository (`tests/fixtures/test-project`), fixing a failing calculator test autonomously.
- AC-9: Real Agent Evaluation Tasks — At least 5 distinct coding task evaluation suites are implemented (`eval/tasks/task-1` through `task-5`), executed, independently verified, and logged with failure classifications.
- AC-10: Durable Progress Tracking — `IMPLEMENTATION_PROGRESS.md` accurately tracks every phase, step, test group, and commit status.

## Risks

- Risk 1: Model Non-Determinism in Tool Calling — LLM might emit invalid JSON arguments or hallucinated tool names. Mitigation: Tool registry validates inputs via Zod schemas and returns structured error messages to the model for automatic correction.
- Risk 2: Infinite Loop / API Cost Blowout — Model may get stuck in repetitive reasoning or execution loops. Mitigation: Hard iteration limit (20) and repeated-action detection halt execution immediately.
- Risk 3: Destructive Command Execution — Model might attempt file deletions or system commands. Mitigation: Command safety policy allowlists safe development commands and denies unverified commands by default.

## Open questions

- Question 1: Should the default Gemini model for Iteration 1 be `gemini-2.5-flash` with `@google/genai`? : Yes
- Question 2: In the file editing tool, should we support both search-and-replace editing (`replace`) and whole-file overwrite (`write`) in a single tool? : Yes
- Question 3: For the search tool, should we implement a pure Node.js recursive directory walker with regex matching to avoid external ripgrep/grep binary dependencies on Windows/Linux? : Yes
- Question 4: For command safety in non-interactive mode, should any command outside the allowlist (`npm test`, `npm run build`, `npm run lint`, `node ...`) be immediately denied with a structured error? : Yes
