# Browser bridge architecture

This repository is one Node.js package. Modules live under `src/` and can be extracted into packages if independent release boundaries become useful. The CLI is the first consumer; an MCP adapter can later call the same application service.

## Responsibilities and dependencies

- `protocol`: Zod plan schemas and domain records. It does not import Playwright or storage code.
- `browser`: a narrow `BrowserAdapter` interface and its Playwright implementation. Only the implementation imports Playwright.
- `executor`: runs validated steps in order, resolves referenced values, records timing, and turns exceptions into step failures. It does not interpret goals.
- `evidence`: collects timestamped browser events and deterministically selects a few events relevant to a failure. It does not depend on Playwright.
- `storage`: filesystem run and artifact repositories behind interfaces. Large files stay local.
- `cli`: validates input, composes the components, and prints a compact result.

Dependency direction is CLI → executor → protocol/browser interfaces/evidence/storage interfaces. The Playwright and filesystem implementations sit at the edge. A future MCP adapter will depend on the same application service as the CLI, never on Playwright directly.

## Domain and execution flow

`BrowserPlan` has a starting HTTP(S) URL and a discriminated union of bounded steps: navigate, click, fill, press, wait_for, assert_url, assert_text, and assert_visible. `BrowserTarget` prefers role, label, text, and test ID locators; CSS is an escape hatch. A fill step contains only an environment variable name (`valueRef`). The resolver returns the value in memory. Plan persistence never includes the resolved value; event text is redacted before storage.

The CLI validates the plan. The runner allocates a run ID, starts Playwright, then executes steps sequentially. Tracing starts only for plans without fill steps. Each step has start/end timestamps, duration, status, and URL. A failure normally stops the run; `continueOnFailure` permits later steps. Browser errors become concise typed failure records. The runner closes the browser and writes run metadata for completed runs.

## Evidence and disclosure

The browser adapter emits timestamped request, response-error, request-failure, console, page-error, and navigation events. The collector stores those locally as JSONL and counts them for metrics. Successful requests are counted but ordinary response bodies are not captured. The reducer returns only a run ID on success. On failure it considers errors assigned to the failed step or occurring within two seconds on either side, then ranks them by step match, severity, and time. At most three compact errors are returned. This rule is intentionally deterministic and may miss causality across longer asynchronous gaps.

Run inspection exposes selected categories and step details on demand. Screenshots on failure and Playwright traces are stored as artifacts, represented by IDs in the reduced result. Screenshot capture masks inputs and text matching resolved values. Tracing is disabled for plans with fill steps because traces can record typed values. Artifact metadata includes type, MIME type, size, creation time, and local path. Retrieval is a separate CLI operation. There is no arbitrary JavaScript, shell, or filesystem operation in the plan protocol.

## Persistence and future growth

Each run is stored beneath a configurable data directory as `runs/<runId>/` with workflow, metadata, steps, evidence, reduced result, and artifacts. The filesystem repositories can later be replaced without changing the protocol or reducer. Run metrics include counts, duration, serialized event and response sizes, and compression ratio; binary artifacts are excluded from that ratio. The architecture leaves room for an MCP boundary and, later, a desktop capability layer; neither exists in this milestone.
