# Product specification — Engineering Agent (Iteration 2)

> Status: draft — Pinkal must approve through Genesis before implementation begins.
> Extends SPEC.md (Iteration 1, approved 2026-09-05). All Iteration 1 IDs (FR-1-FR-13, AC-1-AC-10, NFR-1-NFR-5) are preserved unchanged.

## Functional requirements (Iteration 2)

- FR-14: Context Data Model — Define ContextItem, ContextState, ContextBudget, ContextMetrics, ImportantFact, CompactionEvent types in src/context/types.ts.
- FR-15: Token Estimator — Deterministic, provider-independent TokenEstimator in src/context/token-estimator.ts (char/4 approximation).
- FR-16: Context Budget — Configurable via env vars: MODEL_CONTEXT_TOKENS=32000, MODEL_OUTPUT_TOKENS=4096, CONTEXT_COMPACTION_THRESHOLD=0.80, MAX_TOOL_OUTPUT_TOKENS=4000, MAX_FILE_READ_TOKENS=6000, MAX_SEARCH_RESULT_TOKENS=2000, MAX_COMMAND_OUTPUT_TOKENS=4000.
- FR-17: Truncator — Type-aware strategies in src/context/truncator.ts with truncated/originalTokenEstimate/finalTokenEstimate metadata.
- FR-18: Context Priority and Selection Policy — Deterministic algorithm in src/context/policies.ts: CRITICAL always first, then HIGH, then recent NORMAL, then LOW. Drop LOW first on budget excess.
- FR-19: Duplicate Detection — Normalized content hash deduplication. No embeddings.
- FR-20: Context Builder — src/context/context-builder.ts producing BuildContextResult with messages, estimatedTokens, utilization, truncated, compacted, metrics.
- FR-21: Deterministic Compactor — src/context/compactor.ts with 8-turn window and structured deterministic summary. No LLM summarization.
- FR-22: Context Manager Coordinator — src/context/context-manager.ts as single entry point for Agent Loop.
- FR-23: Important Facts Store — ImportantFact[] in TaskState. Survives compaction.
- FR-24: Agent Loop Integration — loop.ts delegates to ContextManager; no context-selection logic in loop.
- FR-25: Agent State Extension — Add importantFacts, contextStats to state.ts. Backward-compatible.
- FR-26: Context Metrics and Logging — 6 new log events; estimated tokens in llm_request logs.
- FR-27: CLI Debug Context Mode — --debug-context flag showing per-item priority and disposition.
- FR-28: README and Documentation Update — Context management section, env vars, architecture.

## Non-functional requirements (additions)
- NFR-6: Backward Compatibility — All Iteration 1 tests and behaviors unchanged.

## Acceptance criteria (Iteration 2)
- AC-11: Architecture — context/ subsystem complete; loop delegates entirely.
- AC-12: Token Management — deterministic estimator, configurable budget, utilization logged.
- AC-13: Context Selection — CRITICAL never dropped, duplicates removed, recency tiebreaker.
- AC-14: Compaction — deterministic compaction on threshold; task/facts/state preserved; events logged.
- AC-15: Observability — 6 log events emitted; --debug-context works; no key leaks.
- AC-16: Unit Tests — all tests/unit/context/ tests pass.
- AC-17: Stress Test — 100+ tool results, bounded context, no crash.
- AC-18: Long-running Integration — growth->threshold->compaction->continued correct work.
- AC-19: Iteration 1 Regression — all existing tests pass unmodified.
- AC-20: Evaluation — tasks task-6..task-12 run, baseline comparison table produced, failures classified.
