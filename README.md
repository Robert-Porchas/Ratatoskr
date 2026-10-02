# Ratatoskr

Ratatoskr runs a structured Playwright workflow locally, stores browser evidence locally, and returns a compact result to Codex. One workflow can batch many browser actions, avoiding repeated model/browser round trips and routine DOM, console, and network dumps. Codex plans the steps; Ratatoskr executes them deterministically. It is not an autonomous browser agent.

## Install and verify

Requires Node.js 22+, npm, and Chromium:

```sh
npm install
npx playwright install chromium
npm test
npm run typecheck
npm run lint
npm run format:check
npm run test:e2e
npm run test:mcp
```

`test:e2e` and `test:mcp` start their own small local website. `test:mcp` builds the server, spawns it over stdio with the official MCP client, and checks discovery, successful and failing workflows, selected inspection, explicit screenshot retrieval, trace metadata, and response-size budgets. Unit tests need no browser.

## Use the CLI without Codex

Start the fixture in one terminal:

```sh
npm run fixture
```

In another terminal, set local test credentials and run both examples:

```sh
export TEST_EMAIL=demo@example.test TEST_PASSWORD=password123
npm run cli -- run ./examples/login-success.json
npm run cli -- run ./examples/login-failure.json
```

The success result is approximately `{"success":true,"runId":"run_..."}`. The failure fixture deliberately returns HTTP 500; the CLI exits 1 and reports the failed step, nearby HTTP/console errors, and a screenshot ID. Inspect or copy an artifact separately:

```sh
npm run cli -- inspect run_ID
npm run cli -- inspect run_ID steps,failed_requests,console_errors
npm run cli -- artifact run_ID artifact_ID
npm run cli -- artifact run_ID artifact_ID --out ./failure.png
```

Inspection categories are `summary`, `steps`, `failed_requests`, `console_errors`, `page_errors`, `navigation`, `artifacts`, `extracted_values`, and `metrics`. Inspection is bounded and paged: default 10 items, hard maximum 25 per category, messages shortened to 300 characters. The CLI's legacy `network`, `console`, and `all` aliases still work.

## Canonical BrowserPlan capabilities (CLI)

Plans contain an HTTP(S) `startUrl`, up to 300 typed steps, and a default 180-second workflow deadline. The CLI's optional `timeoutMs` can override that deadline (maximum 10 minutes). Each step can override the default 5-second timeout (maximum 2 minutes). Playwright auto-waits for actionability; assertions wait for their conditions. Supported actions:

`navigate`, `click`, `fill`, `press`, `wait_for`, `assert_url`, `assert_text`, `assert_visible`, `select_option`, `check`, `uncheck`, `hover`, `upload_file`, `expect_download`, `extract_text`, and `extract_attribute`.

Prefer targets by role/accessibility name, label, text, or test ID; CSS is an escape hatch. `select_option` chooses a typed value, label, or index. `click` can declare an expected alert/confirm/prompt policy or `expectPopup: true` to switch to a new page. Unexpected dialogs or popups fail clearly. `upload_file` accepts only a basename found directly in `RATATOSKR_UPLOAD_DIR`; symlinks escaping that directory are rejected. `expect_download` stores the file as an artifact and returns only its ID. No plan can enumerate files.

`fill` uses `valueRef` (an environment variable name), never a plaintext value. The MCP server resolves only names listed in `RATATOSKR_ALLOWED_VALUE_REFS`; an unset list allows no MCP value references. The CLI retains its existing local resolver behavior. Canonical extraction actions require unique `saveAs` names and cap each value at 1,000 characters. Extracted values remain local unless named in the plan's `outputs` array (at most five outputs and 2,000 total output characters). Completed requested outputs return even when a later step fails. CLI example:

```json
{
  "startUrl": "http://127.0.0.1:3000/form",
  "steps": [
    {
      "action": "select_option",
      "target": { "kind": "label", "label": "State" },
      "option": { "kind": "label", "label": "Nevada" }
    },
    { "action": "check", "target": { "kind": "label", "label": "Agree" } },
    {
      "action": "uncheck",
      "target": { "kind": "label", "label": "Subscribe" }
    },
    {
      "action": "click",
      "target": { "kind": "role", "role": "button", "name": "Save item" }
    },
    {
      "action": "extract_text",
      "target": { "kind": "testId", "testId": "order-number" },
      "saveAs": "orderNumber",
      "maxChars": 40
    }
  ],
  "outputs": ["orderNumber"]
}
```

## Use from Codex through MCP

Build first, then the stdio server can be started manually with `npm run mcp` (it waits for an MCP client; stdout is protocol-only). Restart Codex after upgrading/building to refresh its cached MCP definitions. This repository has been registered locally as `ratatoskr`. For another machine, build and register with absolute paths:

```sh
npm run build
codex mcp add ratatoskr --env RATATOSKR_DATA_DIR=/absolute/path/to/repo/.ratatoskr --env RATATOSKR_ALLOWED_VALUE_REFS=TEST_EMAIL,TEST_PASSWORD -- /absolute/path/to/node /absolute/path/to/repo/dist/src/mcp/server.js
codex mcp list
```

In `~/.codex/config.toml`, add the following fields to the generated `[mcp_servers.ratatoskr]` table; do not put secret values in committed config:

```toml
cwd = "/absolute/path/to/repo"
env_vars = ["TEST_EMAIL", "TEST_PASSWORD", "RATATOSKR_UPLOAD_DIR"]
startup_timeout_sec = 20
tool_timeout_sec = 660
```

Set the allowlisted reference variables in the local environment that launches Codex; `env_vars` forwards only their names and current values to the server. The MCP tools are:

- `run_browser_workflow`: accepts the compact MCP format below, normalizes it into the strict canonical BrowserPlan, and returns a compact structured result.
- `inspect_browser_run`: returns only requested, bounded categories for one run.
- `get_browser_artifact`: returns one registered screenshot as MCP image content, a small text artifact as text, or metadata plus a local path for a trace/large binary.

Try asking Codex: “Use Ratatoskr to test the login flow with the test account, verify the dashboard, and investigate source code using the compact failure result. Request more browser evidence only if needed.” Codex derives routes and locators from source/tests, then constructs one workflow. It should not automatically fetch screenshots or traces after every run.

### Compact MCP format

The MCP input deliberately differs from CLI JSON. Locators are flat; exactly one of `label`, `text`, `testId`, `css`, or `role` identifies the target (`name` accompanies `role`). Actions use `do`:

`navigate`, `click`, `fill`, `press`, `wait`, `url`, `has`, `visible`, `select`, `check`, `uncheck`, `hover`, `upload`, `download`, `extractText`, `extractAttribute`.

```json
{
  "url": "http://127.0.0.1:3000/login",
  "steps": [
    { "do": "fill", "label": "Email", "valueRef": "TEST_EMAIL" },
    { "do": "fill", "label": "Password", "valueRef": "TEST_PASSWORD" },
    { "do": "click", "role": "button", "name": "Sign in" },
    { "do": "url", "contains": "/dashboard" }
  ]
}
```

`has` checks target text against `contains`; `url` checks the URL against `contains`. `select` accepts one of `option` (value), `optionLabel`, or `optionIndex`. `press` needs `key`; `upload` needs an allowed `fileName`. `download` expects a download from clicking its target. Extraction uses `save` (and `attribute` for `extractAttribute`), implicitly requesting an output: up to five unique identifiers, 200 characters each. Completed values return as `values` on success **and failure**, without a separate `outputs` field. Default success remains just `success` and `runId`.

MCP supports up to 300 steps with 5-second actions and a 180-second workflow deadline, without model-facing timeout/evidence knobs. Invalid calls receive a short repair rather than raw schema errors; CLI remains independently strict and configurable.

## Storage, safety, and limits

`RATATOSKR_DATA_DIR` defaults to `.ratatoskr/`. When upgrading, move a previous local data directory to this location or set `RATATOSKR_DATA_DIR` to its path; old environment-variable names are no longer read. Each run stores metadata, the reference-only workflow, step results, `evidence.jsonl`, extracted values, reduced result, and registered artifacts. Evidence includes request counts/failures, HTTP 4xx/5xx, console and page errors, navigation, dialogs/popups, URLs, and timing. The reducer chooses at most three errors from the failed step or a two-second margin, favoring nearby severe failures. The fixture's tiny HTTP 500 case yields 666 bytes of event evidence and about 421 bytes of reduced JSON; these are bytes, not token counts. Binary artifacts are excluded from the ratio.

Secrets are not written to workflows or normal results. Evidence text is redacted against resolved values. Screenshots mask form controls and matching text; traces are disabled for plans with fills, uploads, or prompt value references because traces can capture secrets. This cannot reliably hide secrets drawn into canvas or images, so avoid such pages. URL credentials, `file:` and `javascript:` navigation, arbitrary JavaScript, shell execution, unrestricted filesystem reads, loops, and natural-language plan execution are not supported. Ratatoskr has no domain policy or authentication yet; run it only for trusted local development workflows.

The reducer can miss long asynchronous causes or rank a nearby unrelated error. It captures event metadata, not full network bodies or accessibility trees. Failed text assertions also return at most 200 characters of redacted actual text when available. A timed-out click can report that its target is absent, without returning page content or choosing a replacement. The MCP server allows one active workflow at a time; a concurrent call gets an explicit tool error. Complete tool definitions are now about 4 KB (previously 11.8 KB); schema size alone is not proof of token savings. See [architecture](docs/architecture.md).

## Token-first browser benchmark

The benchmark measures **actual Codex task tokens**, separately from browser evidence bytes. Ratatoskr is intended for source-known, multi-step software tests—not autonomous page discovery. Earlier live measurements showed a token regression despite smaller returned evidence; those unfavorable records remain available in the [original sample](benchmarks/browser-evidence/codex-sample/README.md) and [pre-optimization baseline](benchmarks/browser-evidence/optimization/pre.json).

The optimization harness compares fresh Codex tasks on identical local fixtures. Its primary direct baseline is pinned official Playwright MCP, including bulk form fill and normal observations; a second `direct` baseline uses the original individual-action adapter. Each mode receives identical task/source facts. No byte-to-token conversion is used.

Measured on October 2, 2026 with Codex CLI 0.160.0, `gpt-6.1-sol`, medium reasoning and Chromium 153.0.8010.12. The table comes from [all 40 individual task records](benchmarks/browser-evidence/optimization/production-results.jsonl), with ten fresh tasks per mode/scenario. Token accounting is Codex's cumulative `turn.completed.usage`, including cached input; this is not a billing estimate.

| Scenario            | Planned steps | Direct median tokens | Ratatoskr median tokens | Token reduction | Correct diagnoses, each mode |
| ------------------- | ------------: | -------------------: | ----------------------: | --------------: | ---------------------------: |
| Medium HTTP failure |            10 |               78,372 |                31,959.5 |           59.2% |                        10/10 |
| Large HTTP failure  |            20 |             94,542.5 |                  32,868 |           65.2% |                        10/10 |

Ratatoskr needed one browser-tool call per task and no invalid calls in these cases. The baseline exposes 17 safe core Playwright MCP tools, excludes arbitrary JavaScript/code execution, and retains native bulk fill and default observations. These measurements **do not compare against unrestricted code-capable browser tools or Codex's built-in browser tool**. See the [full sprint report](benchmarks/browser-evidence/optimization/report.md) for smaller samples, success/locator cases, distributions, remaining bottlenecks and preserved regressions.

```sh
npm run test:benchmark
# Offline fixture/replay checks: no account or API key
BENCHMARK_RUNS=10 npm run benchmark:browser
# Real Codex tokens: ten fresh sessions per mode/scenario; consumes account usage
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=10 \
BENCHMARK_SCENARIOS=medium-http_failure,large-http_failure \
BENCHMARK_SUITE=my-token-comparison npm run benchmark:tokens
```

See the [benchmark guide](benchmarks/browser-evidence/README.md) for prerequisites, token provenance, and complete commands. Results use medians across all attempts, with success/diagnosis counts and token distributions. Fixed overhead, retries, and additional inspection can still erase batching benefits; measurements do not establish universal savings.
