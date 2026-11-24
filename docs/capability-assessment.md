# Capability expansion assessment

Starting state: clean `autoGen/retry/branchFeature` at `ea73c35`. The feature
branch retains this branch's variables, branching, retry safety and benchmarks;
starting from the older local `main` would lose required functionality. No remote
write is authorized. Existing history uses conventional commits.

## Existing foundations

`application.ts` already shares `executePlan` across CLI and MCP. `protocol.ts`
validates the canonical workflow; `mcp/wire-plan.ts` normalizes compact input.
`workflow-structure.ts` supplies stable preorder indexes. `executor.ts` owns
deadlines, cancellation, redaction, browser cleanup and persistence. `storage.ts`
stores runs/artifacts locally; `inspection.ts` pages evidence. `session.ts`
already sanitizes authentication diagnostics. No new database or executor is
needed. CLI run/inspect/artifact/derive-workflow, installation Doctor and the
packaged Codex skill already exist.

Missing: versioned comparison metadata, semantic comparison, forward export,
CLI validation/reporting/help/doctor, source/route correlation and bounded page
discovery. Browser response capture currently omits successful status codes;
evidence arrays have no event cap. Run records omit browser identity, workflow
fingerprint and completeness. These must precede trustworthy comparison.

## Contracts and order

1. Optional `RunRecord.verification` version 1; existing records remain readable.
   Capture bounded responses, preserve compact failure filtering, persist initial
   navigation, fingerprint the validated workflow and record capture limitations.
2. Pure comparison over loaded runs, stable step indexes and endpoint occurrence
   matching. Return observed changes separately from comparability limitations.
3. Pure strict Playwright exporter. Unsupported semantics prevent source output.
   Environment references never resolve secrets during export.
4. Reuse application services for MCP/CLI. Add CI JSON/JUnit, interrupts and
   exclusive workspace-contained export writes.
5. Optional explicit application metadata with safe local source maps; read-only
   discovery through the existing browser port. Update Doctor/skill/references.
6. Controlled fixture integration, independent review and byte-size evaluation.

Root owns protocol, persistence/comparison and transports; independent modules
own export, browser discovery/response observation and local diagnostics. Changes
to shared interfaces are coordinated before integration.

## Constraints and validation

Do not infer HTTP recovery from error absence. Origin/path are safe identities;
query values are intentionally excluded, so query-driven endpoints may be
inconclusive. Event step association observes a time boundary, not causality.
Unknown secrets in page content remain a limitation. Generated code uses literal
escaping and environment lookups, never arbitrary execution from workflow text.
Exports use exclusive writes, source references require workspace containment,
source maps never download remotely, and capture/comparison/discovery have hard
budgets. Retention stays user-managed; no automatic deletion is introduced.

Baseline: `npm test` passed 25 files / 118 tests; `npm run typecheck` passed.
Use unit cases for deterministic matching, metadata, normalization, unsupported
exports, escaping, diagnostics and budgets; controlled local browser/MCP/CLI
cases for before/after runs, generated tests, discovery and cleanup. Run existing
browser/session/workflow regressions and distribution/style/build checks.

Research: [Playwright assertions](https://playwright.dev/docs/test-assertions)
support auto-waiting exported assertions; [Playwright MCP](https://github.com/microsoft/playwright-mcp)
already offers browser snapshots and CLI/skill alternatives, so this initiative
focuses on reusable workflow evidence. [ECMA-426](https://ecma-international.org/publications-and-standards/standards/ecma-426/)
defines source maps; [W3C Trace Context](https://www.w3.org/TR/trace-context/)
defines traceparent. [MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
retain client-controlled execution; annotations are hints. [OpenAI skills](https://learn.chatgpt.com/docs/build-skills)
use concise SKILL.md metadata and progressive disclosure. Preserve the existing
working plugin package and add portable skill-copy guidance instead of inventing
another installer.
