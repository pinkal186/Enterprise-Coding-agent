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

---

## Iteration 2 — Context Management and Token Efficiency

> Status: draft for Pinkal's approval. Iteration 1 (AC-1..AC-10, FR-1..FR-13, NFR-1..NFR-5) is complete and preserved.

### Iteration 2 functional requirements

- FR-14: Context Data Model — Define ContextItem, ContextState, ContextBudget, ContextMetrics, ImportantFact, CompactionEvent types in src/context/types.ts.
- FR-15: Token Estimator — Deterministic, provider-independent TokenEstimator in src/context/token-estimator.ts using a clearly documented approximation (e.g. chars / 4). Must not import any provider SDK.
- FR-16: Context Budget Configuration — Configurable via environment variables: MODEL_CONTEXT_TOKENS (default 32000), MODEL_OUTPUT_TOKENS (default 4096), CONTEXT_COMPACTION_THRESHOLD (default 0.80), MAX_TOOL_OUTPUT_TOKENS (default 4000), MAX_FILE_READ_TOKENS (default 6000), MAX_SEARCH_RESULT_TOKENS (default 2000), MAX_COMMAND_OUTPUT_TOKENS (default 4000). No budget value hardcoded outside the configuration layer.
- FR-17: Truncator — Type-aware truncation strategies in src/context/truncator.ts. File content prefers requested line range + surrounding lines. Search prefers highest-relevance matches. Command output prefers errors + tail. Every truncated item carries truncated:true, originalTokenEstimate, finalTokenEstimate metadata.
- FR-18: Context Priority and Selection Policy — Deterministic selection algorithm in src/context/policies.ts: always include CRITICAL, include HIGH, add recent NORMAL, add LOW only if budget remains. On excess: truncate oversized items, drop LOW, drop older NORMAL, compact if still over threshold. Never drop CRITICAL. Recency breaks ties within equal priority.
- FR-19: Duplicate Detection — Normalized content hash deduplication within context items. Retain only the most recent copy of identical results. No semantic similarity or embedding computation.
- FR-20: Context Builder — ContextBuilder in src/context/context-builder.ts. Accepts BuildContextInput and returns BuildContextResult with messages[], estimatedTokens, utilization, truncated, compacted, metrics. Context ordering: system -> user task -> task state/facts -> recent tool results -> recent interaction -> older context -> summaries.
- FR-21: Deterministic Compactor — Compactor in src/context/compactor.ts. Stage 1: items older than most recent 8 interaction turns are eligible. Stage 2: produce deterministic structured summary preserving user task, modified files, commands, test results, important facts, errors. Record CompactionEvent. LLM-based summarization is explicitly deferred.
- FR-22: Context Manager Coordinator — ContextManager in src/context/context-manager.ts as the single entry point for the Agent Loop. Coordinates token estimation, policy application, truncation, compaction, and managed message production.
- FR-23: Important Facts Store — ImportantFact[] within TaskState for the current task only. Facts survive compaction. Examples: discovered file paths, critical constraints, failed approaches.
- FR-24: Agent Loop Integration — src/agent/loop.ts delegates all context preparation to ContextManager. No context-selection logic remains in loop.ts. All existing safety, iteration-cap, repeated-failure, and verification invariants are preserved.
- FR-25: Agent State Extension — src/agent/state.ts gains importantFacts[] and contextStats (totalItems, estimatedTokens, utilization, truncations, compactions, droppedItems). All Iteration 1 fields preserved unchanged.
- FR-26: Context Metrics and Logging — Six new structured log events: context_build_started, context_build_completed, context_item_truncated, context_item_dropped, context_compaction_started, context_compaction_completed. Each llm_request log entry includes estimated_input_tokens, context_budget, utilization, context_items, truncated_items, compactions.
- FR-27: CLI Debug Context Mode — --debug-context flag in src/cli/main.ts prints per-call human-readable context summary and per-item priority/disposition view.
- FR-28: README and Documentation Update — README.md updated with context management section, --debug-context documentation, all new env vars, architecture diagram. IMPLEMENTATION_PROGRESS.md updated with Iteration 2 section.

### Iteration 2 non-functional requirements

- NFR-6: Backward Compatibility — All Iteration 1 CLI commands, tool behaviors, provider abstractions, and tests must continue to pass unchanged after Iteration 2 integration.

### Iteration 2 acceptance criteria

- AC-11: Architecture — src/context/ subsystem complete with all 7 files. Agent Loop uses ContextManager exclusively. No context-selection logic in loop.ts. Provider independence preserved.
- AC-12: Token Management — Token estimation is deterministic and provider-independent. Context budget is fully configurable via env vars. Utilization is computed and logged for every LLM request.
- AC-13: Context Selection — CRITICAL items are never dropped. LOW items are dropped first. Duplicate tool results are deduplicated. Recency is used as tiebreaker within equal-priority items.
- AC-14: Compaction — Deterministic compaction reduces estimated tokens when utilization >= threshold. After compaction: user task, important facts, current task state, and recent context remain. CompactionEvent is logged with before/after metrics.
- AC-15: Observability — All six context log events are emitted. --debug-context mode shows per-item priority and disposition. No API keys or sensitive content in any log or debug output.
- AC-16: Unit Test Suite — All tests in tests/unit/context/ pass (types, token-estimator, truncator, policies, context-builder, compactor, context-manager, context-metrics).
- AC-17: Context Stress Test — Artificial context with 100+ tool results and 50+ file reads stays within budget, does not crash, preserves critical information, and reports truncation/compaction.
- AC-18: Long-Running Integration Test — Task deliberately forcing context growth triggers threshold, truncation, compaction, and continued correct agent operation through to verification.
- AC-19: Iteration 1 Regression — All existing unit tests and tests/integration/agent-integration.test.ts pass without modification.
- AC-20: Evaluation — Iteration 2 evaluation tasks task-6 through task-12 executed, independently verified, and logged. Baseline comparison table (Iteration 1 vs Iteration 2) produced. All failures classified using Iteration 2 taxonomy.
