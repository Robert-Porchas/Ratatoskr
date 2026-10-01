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

`BrowserPlan` has an HTTP(S) start URL, up to 100 discriminated steps, optional plan/step timeouts, and optional explicit output names. Actions cover navigation, semantic targeting, form controls, hover, bounded uploads/downloads, assertions, and targeted text/attribute extraction. Targets prefer role, label, text, or test ID; CSS is an escape hatch. There is no arbitrary JavaScript, shell, filesystem traversal, looping, or autonomous planning. URL credentials and non-HTTP(S) navigation are rejected.

The executor allocates a unique run ID, starts an isolated browser/context, performs the initial navigation, and executes steps in order. Playwright auto-waits for actionability; condition assertions wait to a bounded timeout. A failure stops the plan unless that step permits continuation. Each step records timing, status, and URL. A plan-level deadline caps further steps. MCP cancellation closes the browser best-effort and persists the run as `aborted`. The MCP process permits one active workflow; additional calls receive an explicit tool error.

`valueRef` resolves locally through the value resolver. Only the reference name persists. The MCP adapter restricts names to `RATATOSKR_ALLOWED_VALUE_REFS` (empty by default); the CLI retains its local resolver behavior. An upload accepts a basename inside a configured directory, not an arbitrary plan path. A download is saved through the artifact store; no plan-supplied write path exists. Extraction values are capped, persisted separately, and returned on success only when named in `outputs`. Unexpected dialogs/popups fail; a click can declare one dialog policy or an expected popup, after which the popup becomes the active page.

## Evidence and progressive disclosure

The Playwright adapter emits request, HTTP error, request failure, console, page error, navigation, dialog, and popup events. The collector assigns timestamps/step indexes and redacts resolved values before persistence. The reducer ranks errors occurring in the failed step or within two seconds around it, favoring severe and same-step events; it returns at most three. This heuristic is deterministic, but does not establish causality for delayed asynchronous effects. Successful requests are counted, not returned. Network bodies and accessibility snapshots are not captured in this milestone.

Level 0 is a tiny success result (`success`, `runId`, plus only explicitly requested outputs/download IDs). Level 1 is a compact failure with step, reason, useful URL/errors, and artifact IDs. Level 2 uses shared `inspectRun` categories with a default of 10 and hard limit of 25 items per category, 300-character message limits, deterministic order, and truncation metadata. Level 3 explicitly retrieves one registered artifact. MCP screenshots use image content; small text files can be text; traces and large binary downloads return metadata plus a local path rather than inline bytes. The MCP server does not expose a general filesystem resource.

Failure screenshots and safe traces are registered by ID. Tracing is disabled for plans containing fills, uploads, or prompt value references because traces can retain secrets. Screenshots mask form controls and matching resolved text; canvas/image-rendered secrets remain a limitation. The artifact store verifies IDs against its registry before reading. MCP stdout is reserved for protocol traffic; diagnostics go to stderr without resolved values.

## Persistence and measurement

Runs live beneath `RATATOSKR_DATA_DIR` (default `.ratatoskr/`): `runs/<runId>/metadata.json`, `workflow.json`, `steps.json`, `evidence.jsonl`, `extractions.json`, `reduced-result.json`, and `artifacts/`. Artifact metadata is also indexed by ID for MCP lookup. Metrics track step/action/error counts, duration, serialized event bytes, reduced response bytes, artifact count, and compression ratio. These are byte counts, not token counts; binary artifacts and MCP schema overhead are measured separately in integration tests.

The stdio MCP adapter uses the official SDK, exposes exactly three tools, and uses the same BrowserPlan and inspector as the CLI. Future desktop-agent integration should treat this as one capability behind a permission boundary, not as the planner or event bus. Next work should measure end-to-end Codex token savings and add domain permissions before broadening browser access.
