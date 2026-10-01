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

## BrowserPlan capabilities

Plans contain an HTTP(S) `startUrl`, up to 100 typed steps, and optional `timeoutMs` (maximum 10 minutes). Each step can override the default 5-second timeout (maximum 2 minutes). Playwright auto-waits for actionability; assertions wait for their conditions. Supported actions:

`navigate`, `click`, `fill`, `press`, `wait_for`, `assert_url`, `assert_text`, `assert_visible`, `select_option`, `check`, `uncheck`, `hover`, `upload_file`, `expect_download`, `extract_text`, and `extract_attribute`.

Prefer targets by role/accessibility name, label, text, or test ID; CSS is an escape hatch. `select_option` chooses a typed value, label, or index. `click` can declare an expected alert/confirm/prompt policy or `expectPopup: true` to switch to a new page. Unexpected dialogs or popups fail clearly. `upload_file` accepts only a basename found directly in `RATATOSKR_UPLOAD_DIR`; symlinks escaping that directory are rejected. `expect_download` stores the file as an artifact and returns only its ID. No plan can enumerate files.

`fill` uses `valueRef` (an environment variable name), never a plaintext value. The MCP server resolves only names listed in `RATATOSKR_ALLOWED_VALUE_REFS`; an unset list allows no MCP value references. The CLI retains its existing local resolver behavior. Extraction actions require unique `saveAs` names and cap each value at 1,000 characters. Extracted values remain local unless named in the plan's `outputs` array (at most five outputs and 2,000 total output characters). For example:

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

Build first, then the stdio server can be started manually with `npm run mcp` (it waits for an MCP client; stdout is protocol-only). This repository has been registered locally as `ratatoskr`. For another machine, build and register with absolute paths:

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

- `run_browser_workflow`: accepts the same BrowserPlan as the CLI and returns a compact structured result.
- `inspect_browser_run`: returns only requested, bounded categories for one run.
- `get_browser_artifact`: returns one registered screenshot as MCP image content, a small text artifact as text, or metadata plus a local path for a trace/large binary.

Try asking Codex: “Use Ratatoskr to test the login flow with the test account, verify the dashboard, and investigate source code using the compact failure result. Request more browser evidence only if needed.” Codex must convert that request into a BrowserPlan. It should not automatically fetch screenshots or traces after every run.

## Storage, safety, and limits

`RATATOSKR_DATA_DIR` defaults to `.ratatoskr/`. When upgrading, move a previous local data directory to this location or set `RATATOSKR_DATA_DIR` to its path; old environment-variable names are no longer read. Each run stores metadata, the reference-only workflow, step results, `evidence.jsonl`, extracted values, reduced result, and registered artifacts. Evidence includes request counts/failures, HTTP 4xx/5xx, console and page errors, navigation, dialogs/popups, URLs, and timing. The reducer chooses at most three errors from the failed step or a two-second margin, favoring nearby severe failures. The fixture's tiny HTTP 500 case yields 666 bytes of event evidence and about 421 bytes of reduced JSON; these are bytes, not token counts. Binary artifacts are excluded from the ratio.

Secrets are not written to workflows or normal results. Evidence text is redacted against resolved values. Screenshots mask form controls and matching text; traces are disabled for plans with fills, uploads, or prompt value references because traces can capture secrets. This cannot reliably hide secrets drawn into canvas or images, so avoid such pages. URL credentials, `file:` and `javascript:` navigation, arbitrary JavaScript, shell execution, unrestricted filesystem reads, loops, and natural-language plan execution are not supported. Ratatoskr has no domain policy or authentication yet; run it only for trusted local development workflows.

The reducer can miss long asynchronous causes or rank a nearby unrelated error. It captures event metadata, not full network bodies or accessibility trees. The MCP server allows one active workflow at a time; a concurrent call gets an explicit tool error. Tool definitions are about 11.8 KB serialized, so schema overhead is still a meaningful context cost. Next work should benchmark real Codex token/round-trip savings, improve long-latency failure correlation, and add domain permissions before broader use. See [architecture](docs/architecture.md).
