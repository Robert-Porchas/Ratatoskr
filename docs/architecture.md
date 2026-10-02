# Ratatoskr architecture

This is one TypeScript package, not a monorepo. The modules form a browser capability that can later be hosted by a desktop agent without making Playwright the domain model.

## Dependency boundaries

```text
CLI ─┐
     ├─> application composition ─> executor ─> BrowserAdapter ─> Playwright adapter
MCP ─┘             │                    │
                   ├─> RunInspector      ├─> evidence collector/reducer
                   └─> stores/resolvers  └─> protocol types
```

`src/protocol.ts` owns Zod schemas and domain records, with no Playwright imports. `src/browser.ts` defines the narrow browser port; only `src/playwright-adapter.ts` imports Playwright. `src/executor.ts` executes validated steps sequentially; it does not interpret goals. `src/evidence.ts` timestamps, redacts, counts, and deterministically reduces evidence. `src/storage.ts` implements run/artifact interfaces on the filesystem. `src/inspection.ts` provides bounded, deterministic run inspection for both transports. `src/application.ts` composes these parts. `src/cli.ts` and `src/mcp/server.ts` are thin input/output adapters. Removing `src/mcp/` does not affect CLI execution or inspection.

## Plan and execution

`BrowserPlan` has an HTTP(S) start URL, up to 300 discriminated steps, optional plan/step timeouts, and optional explicit output names. The shared default workflow deadline is 180 seconds; CLI plans can explicitly override it, while compact MCP plans use the server default. The step cap and default deadline are defined in `src/protocol.ts` and reused by validation/execution to prevent drift. Actions cover navigation, semantic targeting, form controls, hover, bounded uploads/downloads, assertions, and targeted text/attribute extraction. Targets prefer role, label, text, or test ID; CSS is an escape hatch. There is no arbitrary JavaScript, shell, filesystem traversal, looping, or autonomous planning. URL credentials and non-HTTP(S) navigation are rejected.

The executor allocates a unique run ID, starts an isolated browser/context, performs the initial navigation, and executes steps in order. Playwright auto-waits for actionability; condition assertions wait to a bounded timeout. A failure stops the plan unless that step permits continuation. Each step records timing, status, and URL. A plan-level deadline caps further steps. MCP cancellation closes the browser best-effort and persists the run as `aborted`. The MCP process permits one active workflow; additional calls receive an explicit tool error.

`valueRef` resolves locally through the value resolver. Only the reference name persists. The MCP adapter restricts names to `RATATOSKR_ALLOWED_VALUE_REFS` (empty by default); the CLI retains its local resolver behavior. An upload accepts a basename inside a configured directory, not an arbitrary plan path. A download is saved through the artifact store; no plan-supplied write path exists. Extraction values are capped, persisted separately, and returned on either success or failure when named in `outputs` and completed before the failure. Unexpected dialogs/popups fail; a click can declare one dialog policy or an expected popup, after which the popup becomes the active page.

## Evidence and progressive disclosure

The Playwright adapter emits request, HTTP error, request failure, console, page error, navigation, dialog, and popup events. The collector assigns timestamps/step indexes and redacts resolved values before persistence. The reducer ranks errors occurring in the failed step or within two seconds around it, favoring severe and same-step events; it returns at most three. This heuristic is deterministic, but does not establish causality for delayed asynchronous effects. Successful requests are counted, not returned. Network bodies and accessibility snapshots are not captured in this milestone.

Level 0 is a tiny success result (`success`, `runId`, plus only explicitly requested outputs/download IDs). Level 1 is a compact failure with step, reason, useful URL/errors, and artifact IDs. Level 2 uses shared `inspectRun` categories with a default of 10 and hard limit of 25 items per category, 300-character message limits, deterministic order, and truncation metadata. Level 3 explicitly retrieves one registered artifact. MCP screenshots use image content; small text files can be text; traces and large binary downloads return metadata plus a local path rather than inline bytes. The MCP server does not expose a general filesystem resource.

Failure screenshots and safe traces are registered by ID. Tracing is disabled for plans containing fills, uploads, or prompt value references because traces can retain secrets. Screenshots mask form controls and matching resolved text; canvas/image-rendered secrets remain a limitation. The artifact store verifies IDs against its registry before reading. MCP stdout is reserved for protocol traffic; diagnostics go to stderr without resolved values.

## Persistence and measurement

Runs live beneath `RATATOSKR_DATA_DIR` (default `.ratatoskr/`): `runs/<runId>/metadata.json`, `workflow.json`, `steps.json`, `evidence.jsonl`, `extractions.json`, `reduced-result.json`, and `artifacts/`. Artifact metadata is also indexed by ID for MCP lookup. Metrics track step/action/error counts, duration, serialized event bytes, reduced response bytes, artifact count, and compression ratio. These are byte counts, not token counts; binary artifacts and MCP schema overhead are measured separately in integration tests.

The stdio MCP adapter uses the official SDK and exposes exactly three tools. It shares the executor and inspector with CLI, but not the input syntax. `src/mcp/wire-plan.ts` advertises a small flat schema, normalizes `url`/`do` steps and inferred locators into the strict canonical BrowserPlan, and validates that canonical plan before execution. Removing MCP still leaves CLI behavior intact. Future desktop-agent integration should treat this as one capability behind a permission boundary, not as the planner or event bus.

## Model-facing efficiency boundary

SDK input validation passes unknown input to application validation deliberately: the guiding JSON schema describes the compact syntax, while the normalizer owns concise semantic errors. No input reaches the executor without canonical Zod validation. Invalid locators, actions, URLs, output names, and unsupported fields return one bounded repair (under 750 serialized bytes), not union issue arrays. The same protection applies to inspection and artifact arguments. Schemas omit rarely needed timeout, evidence, continuation, and output-list knobs; these remain available internally/through CLI.

MCP extraction `save` requests an output automatically, capped at five identifiers and 200 characters each. Completed requested values survive a later failure (canonical `outputs`, MCP `values`). Text assertion failures can include a best-effort 250 ms reread, redacted before truncation to 200 characters; missing targets have no fabricated actual text. This reduces inspection calls without adding an exploration capability. An unambiguous `has` step with another locator and `text` is normalized as expected text; other ambiguous locators remain invalid.

After a click timeout, the adapter may perform a bounded 150 ms existence probe. An absent target gets an `element_not_found` classification and a redacted, capped reason. Present but disabled/covered controls retain timeout semantics. Probe failure never masks the original failure. This returns neither page content nor suggested replacement targets; it addressed a measured three-call locator diagnosis without adding browser capabilities.

Inspection keeps shared hard bounds (25 items/category, 300-character messages) and MCP defaults to 10 items. Its public API exposes categories and offset, not unbounded dumps or size knobs. Images and trace bytes remain explicit artifact retrieval only.

## Browser evidence benchmark

`benchmarks/browser-evidence/` is an experimental harness outside the production dependency graph. Its original direct adapter uses individual Playwright actions and uncompressed observations. The token matrix also uses pinned official Playwright MCP with its native discovery metadata, bulk fill and default observations; arbitrary code execution is excluded from this explicitly scoped baseline. The Ratatoskr session spawns the actual compiled MCP server with isolated local storage. The harness does not substitute a custom executor, reducer or inspector. Local fixtures supply identical real persistence, deterministic HTTP 500 or absent-control scenarios to both modes, with shared source facts and fresh browser state.

Offline replay validates browser/evidence behavior without model usage claims. An optional Responses API loop records every provider response's usage. The Codex driver launches a fresh ephemeral CLI task per run, exposing the same benchmark browser sessions over MCP and recording native `turn.completed.usage` totals. It disables unrelated tools/instructions, scopes unattended approval to the fixture server, and never resumes the development conversation. Cached input and reasoning output are subsets, not extra tokens. Missing accounting remains unavailable; exec does not expose per-inference counts. Both model integrations are benchmark-only; production remains a deterministic executor. Summaries use paired configurations, matching accounting sources, medians, and explicit missing metrics. Raw event evidence, local binaries, returned tool payloads, and model token usage are distinct measurements. See the benchmark README for methodology and reproducibility limits. Domain permissions remain future work.

Terminal MCP events, including pre-handler validation and transport failures, account for every model-visible tool reply. Invalid arguments and valid runtime failures have separate counters. Immutable audit files verify native usage, method/path diagnosis and the call budget without replacing original evidence or excluding unsuccessful tasks. Published summaries regenerate from per-run records and are tested against the original native completion events.
