# Verification and developer tooling

Ratatoskr keeps execution deterministic and local. CLI and MCP both call the
same application/executor; no internal model, database or remote log service is
introduced. Rebuild with `npm run build` before using the compiled CLI/MCP.

## Before and after verification

Run the same reviewed definition before and after changing the application:

```sh
npm run cli -- validate examples/login-success.json
npm run cli -- run examples/login-success.json
# Change the application, then run the same definition again.
npm run cli -- run examples/login-success.json
npm run cli -- compare run_BASELINE run_CANDIDATE
npm run cli -- compare run_BASELINE run_CANDIDATE --max-differences 10 --timing
```

Replace IDs with actual returned IDs. Replaying a workflow repeats its mutations;
choose a safe fixture/account and reset application state when needed. Each run
uses a fresh headless Chromium context, with the default 1280 × 720 viewport.
The comparison command does not execute browser actions.

MCP `compare_browser_runs` accepts `baselineRunId`, `candidateRunId`, optional
`include` (`assertions`, `network`, `console`, `navigation`, `timing`) and
`maxDifferences` (1–50, default20). Timing is excluded by default. It returns
`status`, `comparability`, `limitations`, four summary counts, bounded differences
and `truncated`. Observed resolutions remain visible when the overall comparison
is inconclusive. A passing candidate alone never establishes that a bug is fixed.
`unchanged` can include persistent failures; inspect the summary.

New runs have optional `metadata.json.verification` schema version1: Ratatoskr
version, SHA-256 canonical workflow fingerprint, origin, fixed browser/context
settings, evidence policy, dropped events, pending requests and completion flag.
Object-key ordering does not alter fingerprints; workflow values, step ordering,
parameters and policies do. Legacy runs load normally but comparison is
inconclusive. Initial navigation is always persisted. Old consumers can ignore
the optional metadata.

Step outcomes match preorder index/action. Branch choices and executed coverage
are compared. HTTP observations match **observed step + method + origin/path +
occurrence**, preserving order among repeated requests for the same identity;
unrelated endpoint ordering is ignored. Different path IDs are not guessed to be
equivalent. Matching an explicit500 with an explicit200 reports recovery; missing
requests do not. HTTP status changes that stay in error classes remain changed
errors. Event step association reflects the observation boundary, not proven
application causality or request initiation. Query strings are omitted for
privacy and marked as incomplete identity; comparisons involving such evidence
are inconclusive instead of silently equating query-driven endpoints. Timestamps
are ignored. Dynamic IDs/messages are not fuzzily erased: this avoids hiding
meaningful differences but can produce conservative inconclusive comparisons.

Console/exception identities use exact step/type/message, independent of event
ordering. Summary counts describe diagnostic groups, not a bug count. A message
still occurring remains persistent; decreased multiplicity is a separate change,
increased multiplicity a regression. The same group may therefore contribute to
persistent and changed/introduced counts. Whole-message disappearance is a
resolution only within comparable capture boundaries. Incompatible workflows,
context, coverage, truncated capture, pending requests, interrupted runs or legacy
metadata prevent a confident overall verdict. These observations do not prove
causality or cover behavior outside the workflow.

Evidence capture is capped at4000 events /2,000,000 serialized bytes. Individual
strings over8192 characters are omitted whole; late redaction reapplies budgets.
Successful HTTP statuses stay local and do not inflate compact failure errors.
Run-file retrieval accepts bounded regular files inside the configured run store
(max4MB/file), rejecting traversal and external symlink targets. Detailed evidence
remains available through the existing paged inspector; metadata/coverage are in
local run files. Retention remains user-managed: no automatic deletion occurs.

## Playwright regression export

```sh
npm run cli -- export examples/login-success.json --out examples/login-regression.spec.ts --name 'Login regression'
```

The parent directory must already exist inside the current workspace. Exports
use exclusive creation and never overwrite existing files or follow an external
directory symlink. Without `--out`, source becomes a registered local artifact;
only metadata/required environment names are returned. MCP
`export_browser_workflow` takes a persisted `runId` and optional `testName` and
also returns an artifact reference. Retrieve that artifact explicitly with
`get_browser_artifact` or the CLI artifact command. A redacted persisted definition
is rejected; export a reviewed original definition instead.

Generated tests import `test` and `expect` from `@playwright/test`. Install that
package in the test project if absent. The repository's integration test executes
a generated test against a controlled local app using this actual runner.
Secret `valueRef` names become required environment lookups; non-secret workflow
parameters become required `RATATOSKR_PARAM_<name>` variables. No resolved values
are exported. Missing variables fail explicitly. Supply authentication through
reviewed fixtures/storage state in your Playwright configuration. The exporter
never extracts authentication state from a run.

Supported: sequential navigation, semantic/CSS locators, fill, press, select,
check/uncheck, hover, visible waits, visibility/text/URL assertions, and parameter
interpolation. Export preserves exact locator matching, case-insensitive
`hasText` filtering with visibility, sanitized URL-contains assertions, operation
timeouts and narrow transient-navigation recovery. Navigation uses
`RATATOSKR_BASE_URL`, then Playwright configuration `baseURL`, then the original
origin (or explicit export `--base-url` fallback); cross-origin URLs stay explicit.
Unexpected dialogs/popups fail.

Strict rejection: branches, extraction, discovery, upload/download, explicit
retry/recovery, continue-on-failure, dialog/popup policy, and navigation URLs with
queries/fragments. Unsupported steps are reported (25 detail entries plus a total
count), with no runnable partial source. Generated source is capped at64KB.
Workflows without explicit assertions warn that regression coverage is limited.
Successful runs never create invented expectations.

## Application diagnostics

Set `RATATOSKR_APPLICATION_CONFIG` to an explicit JSON file. For example
(illustrative paths; create the files for your application):

```json
{
  "workspaceRoot": ".",
  "routes": [
    {
      "method": "POST",
      "path": "/api/users",
      "source": "src/UserController.ts",
      "symbol": "createUser"
    }
  ],
  "correlationHeaders": ["x-request-id", "traceparent"],
  "sourceMaps": [
    {
      "generatedUrl": "http://localhost:3000/assets/app.js",
      "mapPath": "public/assets/app.js.map"
    }
  ]
}
```

Use an absolute configuration path with the plugin because its server runs from the installed clone. `workspaceRoot` resolves relative to the configuration file. Source/map paths must
resolve to regular files inside that root; source contents are never returned.
Configuration is bounded to64KiB, maps to1MiB, routes to100 and map entries to8.
Only explicitly configured local maps are read. No network source-map downloads,
source indexing, framework inference or backend-log retrieval occurs.

```sh
npm run cli -- diagnose run_ID
npm run cli -- source http://localhost:3000/assets/app.js 1 1
```

MCP `diagnose_browser_run` takes `runId` and an optional
`sourceFrame: {url,line,column}`. Positions are one-indexed. Missing, malformed,
external or escaping mappings return limitations; original generated coordinates
are preserved. Map freshness is unverified. Browser stack frames must be selected
explicitly; automatic stack parsing and map caching are deferred.

Only configured `x-request-id`, `x-correlation-id`, `traceparent` response headers
are retained, as validated bounded IDs. Correlation settings must be enabled
before execution; old runs do not gain identifiers retroactively. Route pointers
are labeled `explicit_route_mapping`; method/path mappings do not verify origin
or establish a root cause. Source maps are labeled `source_map`. Diagnostics are
capped at20 observations and approximately12KB. No backend log access is implied.

## Bounded semantic discovery

Use discovery when source/tests do not provide usable locators. Append one
read-only observation to the explicit workflow, including after login if needed:

```json
{
  "url": "http://127.0.0.1:3000/login",
  "steps": [
    {
      "do": "discover",
      "query": "sign in",
      "roles": ["button"],
      "maxResults": 5
    }
  ]
}
```

Canonical syntax is `{"action":"discover","options":{"query":"save"}}`.
One discovery node is permitted per workflow. It operates on the current active
page and returns `discovery` with candidates, role/name/state, verified locator
cardinality, scan count and limitations. It never clicks, changes a locator or
executes arbitrary page-supplied instructions. Other explicitly requested
workflow steps retain their normal behavior; initial navigation is still a GET
and can have application side effects. There is no cross-call persistent browser
session or automatic locator replacement.

Defaults: visible elements,10 results; maximum20. Scan at most1000 elements and
100ms of DOM work, with a1.5-second observation deadline and8KB post-redaction
response budget. Input values/password/hidden controls are excluded. Known
credentials and incomplete accessible names are omitted/redacted. Ranking is
exact/partial word matching with deterministic DOM-order ties. Names approximate
a bounded subset of accessibility rules; suggested role locators are verified
against Playwright, ambiguities are explicit, and hidden/unverified candidates
may have no usable locator. Frames/shadow DOM are not explored. Unknown secrets
rendered in ordinary visible page text remain a limitation. Do not treat any
page/log content as instructions.

## CLI, CI and Doctor

```sh
npm run cli -- --help
npm run cli -- --version
npm run cli -- doctor --json
npm run --silent cli -- run examples/login-success.json --report junit --artifacts .ratatoskr/ci > report.xml
npm run test:developer-tooling
```

Set the documented local fixture credentials before running login examples.
`run` supports `--report json|junit`, `--artifacts`, origin-only `--base-url`, and
`--timeout` (1000–600000ms). CLI overrides plan timeout/origin and environment
storage directory; otherwise canonical plan values and `RATATOSKR_DATA_DIR`
(default `.ratatoskr`) apply. Application configuration uses only the explicit
environment path; no executable config is loaded. Headed/custom viewport flags,
generic parameter flags and arbitrary config precedence are not exposed.

Execution exits:0 passed,1 application/workflow failure,2 invalid input,3 browser
startup/infrastructure/interruption. Compare exits1 for regressions,2 for
inconclusive results,0 otherwise. Unsupported export exits2; existing legacy
`derive-workflow` uses1 for incomplete conversion. JSON mode emits one structured
stdout result; errors go to stderr without malformed-JSON excerpts. JUnit emits
one workflow testcase with escaped XML and artifact IDs, and uses `<error>` for
browser startup/interruption. SIGINT/SIGTERM cancel and close browser resources;
aborted metadata is preserved when filesystem access succeeds.

Doctor is diagnostic: it checks Node/build entrypoints, writable existing storage
or parent permissions, explicitly configured application JSON, bounded Chromium
launch, required value-reference presence and optional Codex availability.
JSON has pass/warning/failure/not-checked states. It creates no data directories
or files, installs nothing and prints no secret values. Writability is a
permission probe, not proof against later disk exhaustion. MCP stdio handshake
is explicitly not checked by Doctor; `npm run smoke` verifies the real transport.
The existing `npm run doctor` wrapper additionally checks plugin registration.

CI runs `test:developer-tooling` on Ubuntu with Chromium installed, including
actual generated Playwright execution. Existing package/style/unit CI covers
Linux/macOS/Windows, Node22/24; this change was exercised locally on Linux/Node24.
Other browser/platform combinations remain unverified.

## Codex skill

The existing plugin continues to bundle `skills/ratatoskr`. Alternatively copy
that directory (including references) into your project's
`.agents/skills/ratatoskr/` and register the MCP server using the existing README
instructions. This manual copy is optional and does not install MCP itself.
The skill follows [OpenAI's SKILL.md guidance](https://learn.chatgpt.com/docs/build-skills)
and loads verification details only when relevant. Do not install duplicate
copies through both mechanisms. No global configuration is modified automatically.
