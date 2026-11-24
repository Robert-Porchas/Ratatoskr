# Verification and regression coverage

Examples below are illustrative tool arguments. Substitute the authorized application URL, source-known locators and actual returned run IDs. They are not evidence that an application was tested.

## Construct an explicit application check

`run_browser_workflow` accepts compact `url`/`steps`, including explicit assertions:

```json
{
  "url": "http://127.0.0.1:3000/dashboard",
  "steps": [
    { "do": "visible", "role": "heading", "name": "Welcome to the dashboard" },
    { "do": "has", "testId": "ready", "contains": "Ready" }
  ]
}
```

For editing flows, fill with configured `valueRef` names, submit once, then assert persisted state through the application's supported navigation. Do not confuse an edited input or successful click with persisted success. A new run starts with a fresh context; a login must be part of that workflow when required.

Bounded branches describe known alternatives: `{ "if": "visible", "testId": "dashboard", "then": [], "else": [] }`. Other conditions are `if:"url"` + `contains`, `if:"exists"` + `variable`, and `if:"equals"` + `variable`/`equals`; `not:true` negates. Maximum depth is two; visibility checks observe at most 250 ms. Prefer required waits for expected readiness. `derive-workflow <test.ts> --base-url URL` converts supported sequential Playwright source into a validated workflow; inspect unsupported warnings before execution.

`retry` is total attempts, at most three, for supported transient navigation/waits/hover/extraction or click readiness before dispatch. `recover:"reloadOnce"` requires a wait/extraction with `retry:2`. There are at most 360 executed nodes/attempts/reloads and 60 retries. Never use retries for uncertain side effects. Success traces stay local; do not inspect them routinely.

## Diagnose a failure with minimal evidence

Read the failed step, error code, relevant requests and available session findings first. Inspect application source using that evidence. If a specific fact remains missing, select only relevant `inspect_browser_run` categories, such as `failed_requests`, `page_errors`, `console_errors` or `steps`. Use `offset` for another bounded page only when needed. Request one registered artifact if it will resolve the uncertainty; do not automatically retrieve screenshots or traces.

`diagnose_browser_run` adds explicit local application mappings when the operator configured `RATATOSKR_APPLICATION_CONFIG`:

```json
{
  "runId": "run_11111111111111111111111111111111",
  "sourceFrame": {
    "url": "http://127.0.0.1:3000/assets/app.js",
    "line": 12,
    "column": 8
  }
}
```

`sourceFrame` is optional; use a generated location actually observed in application evidence. Positions are one-indexed. Route mappings identify explicitly configured source candidates; request IDs are observed header values. Neither proves the mapped function caused a failure. Maps must be explicitly configured local files; missing, malformed, escaping or stale maps can limit conclusions. Backend logs are unavailable. No framework source scan or remote map retrieval occurs.

## Compare before and after a fix

Retain both actual run IDs and use the same workflow definition, target, browser settings and assertions. Before replaying submissions or mutations, establish that repeating the authorized workflow is safe. Do not retry uncertain side effects merely to obtain a cleaner comparison.

```json
{
  "baselineRunId": "run_11111111111111111111111111111111",
  "candidateRunId": "run_22222222222222222222222222222222",
  "include": ["assertions", "network", "console", "navigation"],
  "maxDifferences": 10
}
```

Call `compare_browser_runs` with those arguments. Default categories match the example; opt into `timing` only when relevant. `maxDifferences` bounds displayed details to 1–50 without changing the complete summary.

Read `comparability`, `limitations`, `summary` and the evidence together. Workflow changes, different executed branches, truncated or pending evidence, and omitted URL query values can make a comparison inconclusive. An absent failed request is not a confirmed successful response. Persistent failures still matter when other observations improve. Describe exactly which assertions/errors changed; do not claim universal remediation.

## Export a stable workflow

Call `export_browser_workflow` using a persisted run:

```json
{
  "runId": "run_22222222222222222222222222222222",
  "testName": "dashboard is ready"
}
```

Read `ready`, `unsupported`, `unsupportedCount`, `warnings`, `assertionCount` and `requiredEnvironment`. Unsupported semantics prevent runnable export rather than disappearing silently. Supported operations cover ordinary navigation, semantic interactions, form controls, waits and explicit visibility/text/URL assertions. Branches, extraction, discovery, uploads/downloads, dialog/popup policies, continuation and explicit retries/recovery need manual review and are rejected. Navigation URLs with queries/fragments are rejected to avoid embedding sensitive URL data.

The result references a generated Playwright Test artifact; retrieve it only when needed with `get_browser_artifact`. Tests use `@playwright/test`; provide that test framework and any reviewed fixture setup in the target repository. `valueRef` becomes a required environment lookup; workflow parameters become `RATATOSKR_PARAM_<name>` environment lookups. Parameter values are not embedded. Review `requiredEnvironment` and supply values privately. Never copy authentication state into committed tests.

Preserve user-defined assertions. A workflow without assertions exports with a limited-coverage warning; add intended assertions from source or requirements rather than inventing them from a passing trace. Run the generated test against the controlled application before presenting it as regression coverage. A persisted workflow containing redacted fields requires review of its original definition through CLI export.

## Recover an unknown or renamed locator

Append discovery to a safe workflow that reaches the relevant page:

```json
{
  "url": "http://127.0.0.1:3000/profile",
  "steps": [
    {
      "do": "discover",
      "query": "save profile",
      "roles": ["button", "link"],
      "maxResults": 5
    }
  ]
}
```

Discovery is a workflow action, not a separate tool. It observes the active main-frame page once per workflow; it performs no clicks or submissions. It scans at most 1,000 elements, bounds observation time and returns about 8 KB at most. `visibleOnly` defaults to true. Names use a subset of accessible-name rules; frames and shadow content can remain unavailable. Read `truncated` and `limitations` before interpreting missing candidates as absence.

Prefer a returned verified `locator` and inspect `matchCount`; multiple matches remain ambiguous. A candidate lacking a locator is not a validated replacement. Do not automatically execute the highest-ranked candidate. Derive intended behavior from source or user requirements, then construct the corrected workflow when it is safe to replay.

## CLI equivalents

The prepared runtime exposes the same executor through:

```sh
ratatoskr validate tests/dashboard.flow.json
ratatoskr run tests/dashboard.flow.json --report json
ratatoskr run tests/dashboard.flow.json --report junit --artifacts test-results
ratatoskr compare BASELINE_RUN_ID CANDIDATE_RUN_ID --max-differences 10
ratatoskr export tests/dashboard.flow.json --out tests/dashboard.spec.ts
ratatoskr diagnose RUN_ID
ratatoskr source http://127.0.0.1:3000/assets/app.js 12 8
ratatoskr doctor --json
```

These are command shapes; substitute actual files and IDs. Output parent directories must already exist within the workspace; export refuses overwrites. Use `ratatoskr --help` for current flags. CLI comparison reads the same local run store; keep `RATATOSKR_DATA_DIR` consistent between runs and comparison.

For general web research, open-ended browsing or an unsupported interaction, choose an appropriate available tool instead of forcing a misleading workflow/export. If Ratatoskr tools are unavailable, report that execution did not occur and use the project's installation diagnostics.
