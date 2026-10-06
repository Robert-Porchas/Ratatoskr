# Ratatoskr

Ratatoskr is a local browser tool for Codex. It batches known multi-step application tests and returns compact diagnostic evidence instead of repeated browser dumps. This reduces model/browser round trips and has measured token savings on the [tested E2E scenarios](#token-first-browser-benchmark); it is not an autonomous browsing agent.

## Install with Codex

### Prerequisites

- **Codex CLI** with plugin commands (tested: **0.160.0**); authenticate with `codex login` to use a model.
- **Node.js 24 recommended** (22.12+ in the 22.x line also supported), npm, and Git. Keep Node on the PATH of the process that starts Codex.
- **Chromium**, downloaded by setup. Linux also needs Playwright's system libraries; if missing, run `npx playwright install --with-deps chromium` after `npm ci` (may require administrator access).
- **Tested:** Linux x86-64 (Ubuntu 26.04), Node 24. Windows/macOS are expected to work but are **not yet installation-tested**. No API key is required for doctor/smoke; model tasks require a Codex account/login.

### Install Ratatoskr

Run these commands in the directory where you want to keep Ratatoskr:

```sh
git clone https://github.com/Robert-Porchas/Ratatoskr.git
cd Ratatoskr
npm ci
npm run setup
codex plugin marketplace add .
codex plugin add ratatoskr@ratatoskr-local
```

Setup builds the runtime, stages a small plugin, downloads Chromium and registers this clone locally. It does **not** change Codex configuration; the two explicit `codex plugin` commands do. Keep the clone: the installed plugin launches its prepared runtime. Don't install from an unbuilt clone or delete/move it without rerunning setup.

This uses Codex's [supported compatibility plugin layout](https://developers.openai.com/plugins/build/plugins), with a skill and stdio MCP bundled together. Unlike the portable MCP schema, this layout supports the environment-name allowlist and 210-second client timeout. It uses a relative plugin `cwd`, not unsupported MCP `${PLUGIN_ROOT}` interpolation. It is a repository marketplace, not a public-directory listing or published npm package.

### Verify

```sh
codex plugin list --json
npm run doctor
npm run smoke
```

The list should show `ratatoskr@ratatoskr-local` installed/enabled. Doctor checks the runtime, writable data directory and Chromium. Smoke connects through stdio, discovers **three tools** and runs a local workflow; expect `"success":true`. Neither needs a model account. Start a **new Codex session**, then `/skills` should include Ratatoskr and `/mcp` should show its browser tools. For a structured discovery check: `node scripts/codex-discovery.mjs`.

### Try it

Start your application normally and ask Codex:

> Use Ratatoskr to test my application's login flow. Sign in with my configured test credentials, verify the dashboard loads, and tell me where it fails. Only request additional browser evidence if the compact result is insufficient.

Codex derives routes/locators from your source and constructs the plan; you do not need to write workflow JSON. Configure credential references as described below first. For a no-credential demo, run `npm run fixture`, then ask Codex to verify `http://127.0.0.1:3000/dashboard` contains the heading “Welcome to the dashboard” and text “Ready”.

## What Ratatoskr does

It executes deterministic app tests: login, forms, CRUD, navigation, regression reproduction and compact browser-side diagnosis. It is best suited to source-known workflows that can be batched. General research, open-ended discovery and a single trivial action may be better served by other tools. There is no proven universal action-count crossover.

## How it works

```text
You → Codex + Ratatoskr skill → one MCP workflow → local executor / Playwright
                                                        ↓
                                                   browser actions
                                                        ↓
                                               rich evidence stored locally
                                                        ↓
                                                   evidence reducer
                                                        ↓
                                               compact result → Codex
```

Codex plans; Ratatoskr executes. Additional evidence is pull-based: `inspect_browser_run` selects bounded categories; `get_browser_artifact` retrieves one explicit artifact. Success normally needs no follow-up.

## Configuration

The plugin stores registration at `~/.ratatoskr/runtime.json` and runs/evidence/screenshots/traces/downloads under `~/.ratatoskr/data/`, **outside its replaceable cache**. `RATATOSKR_HOME` overrides the registration directory; `RATATOSKR_DATA_DIR` overrides run storage. Standalone CLI/MCP defaults remain the current directory's `.ratatoskr/`. Artifacts are not automatically deleted; review and remove only the generated run directories you no longer need. Browser data can be sensitive even with redaction.

For environment-backed values, prepare the plugin with **names**, not secret values:

```sh
npm run setup -- --value-refs TEST_EMAIL,TEST_PASSWORD
```

Define those variables privately in the environment that launches Codex. Bash example: `export TEST_EMAIL='your-test-account'` and `read -rs TEST_PASSWORD; export TEST_PASSWORD`. PowerShell: use `$env:TEST_EMAIL` and `$env:TEST_PASSWORD`, populated from your credential provider. Don't put credentials in prompts, JSON plans, manifests or committed config. Setup adds the names to the plugin's forwarding/allowlist; it never reads or saves their values. No dotenv loader is used. `.env` files are ignored but **not loaded**.

After changing setup options or updating the clone, reinstall the cached plugin:

```sh
codex plugin remove ratatoskr@ratatoskr-local
codex plugin add ratatoskr@ratatoskr-local
```

Then start a new session. Rerun setup with the same `--value-refs` on upgrades; plain `npm run build` restores the default plugin config. Only one prepared runtime per `RATATOSKR_HOME` is selected. `RATATOSKR_UPLOAD_DIR` permits uploads of basenames directly in one configured directory, not filesystem browsing. Codex tool calls may submit forms and mutate applications; review tool approval requests.

## Troubleshooting

| Symptom                       | Action                                                                                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing plugin/skill/tools    | Check `codex --version`, `codex plugin list --json`; enable the plugin if disabled, start a new session, check `/skills` and `/mcp`. Managed policy may disallow local plugins.                |
| MCP won't start               | Run `npm ci`, `npm run setup`, then `npm run doctor`; retain the clone, ensure Node is on PATH. Read stderr, not MCP stdout. Use the manual fallback below if plugin commands are unavailable. |
| Missing Chromium/libraries    | `npx playwright install chromium`; on Linux, `npx playwright install --with-deps chromium`.                                                                                                    |
| Missing/denied valueRef       | Rerun setup with that name in `--value-refs`, define it before launching Codex, reinstall the plugin and restart the session. Never pass its value through MCP.                                |
| Element not found             | Derive exact accessible names/labels/test IDs from source; role locators use exact names. CSS is only an escape hatch.                                                                         |
| No automatic screenshot/trace | Expected: request one artifact only when useful. Traces are disabled for secret-bearing plans.                                                                                                 |
| Permission/path error         | Use writable `RATATOSKR_HOME`/`RATATOSKR_DATA_DIR`; rerun setup after moving the clone. Paths with spaces are supported.                                                                       |

## Manual MCP setup

Use the same clone, `npm ci`, `npm run setup`, doctor and smoke commands above. Register only this server (do not overwrite your existing Codex config):

```sh
codex mcp add ratatoskr -- node "/ABSOLUTE/PATH/TO/Ratatoskr/scripts/mcp.mjs"
codex mcp list
```

Replace the visibly marked path with your clone's absolute path (Windows paths may contain spaces). In the generated `[mcp_servers.ratatoskr]` table in your Codex config, add:

```toml
env_vars = ["RATATOSKR_HOME", "RATATOSKR_DATA_DIR", "RATATOSKR_UPLOAD_DIR", "TEST_EMAIL", "TEST_PASSWORD"]
startup_timeout_sec = 20
tool_timeout_sec = 210
env = { RATATOSKR_ALLOWED_VALUE_REFS = "TEST_EMAIL,TEST_PASSWORD" }
```

Change/omit credential **names** as appropriate. Do not configure both manual and plugin servers at once: duplicate definitions cost context. `npm run mcp` starts the bare compiled stdio server for debugging and waits for an MCP client; stdout must remain protocol-only. See [current official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Uninstall or upgrade

Remove just this plugin with `codex plugin remove ratatoskr@ratatoskr-local`, then optionally `codex plugin marketplace remove ratatoskr-local`. Manual users use `codex mcp remove ratatoskr`. Restart Codex. Once unregistered, you may delete the retained clone and separately review/delete Ratatoskr-owned generated data and `runtime.json`; do not delete your Codex config. To upgrade, update the clone, rerun `npm ci` and setup, reinstall the plugin, then doctor/smoke.

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

## MCP tools and compact workflows

The three tools are:

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

Other normal requests: “Use Ratatoskr to reproduce the profile-save bug; update the display name, save, reload and verify persistence.” “Create a project, open it, rename it and verify the updated name.” “Test checkout; investigate source using compact failure evidence before requesting more browser data.” Only automate actions the user authorized.

## Storage, safety, and limits

`RATATOSKR_DATA_DIR` defaults to `.ratatoskr/`. When upgrading, move a previous local data directory to this location or set `RATATOSKR_DATA_DIR` to its path; old environment-variable names are no longer read. Each run stores metadata, the reference-only workflow, step results, `evidence.jsonl`, extracted values, reduced result, and registered artifacts. Evidence includes request counts/failures, HTTP 4xx/5xx, console and page errors, navigation, dialogs/popups, URLs, and timing. The reducer chooses at most three errors from the failed step or a two-second margin, favoring nearby severe failures. The fixture's tiny HTTP 500 case yields 666 bytes of event evidence and about 421 bytes of reduced JSON; these are bytes, not token counts. Binary artifacts are excluded from the ratio.

Resolved values and observed session values are redacted from ordinary persisted text and results, including messages captured before a value was discovered. Screenshots mask form controls and matching text; traces are disabled for secret-bearing plans and discarded when cookie/storage/authorization state is observed. This cannot reliably hide unknown secrets or secrets drawn into canvas/images, so avoid such pages. URL credentials, `file:` and `javascript:` navigation, arbitrary JavaScript, shell execution, unrestricted filesystem reads, loops, and natural-language plan execution are not supported. Ratatoskr has no domain policy or authentication yet; run it only for trusted local development workflows.

The reducer can miss long asynchronous causes or rank a nearby unrelated error. It captures event metadata, not full network bodies or accessibility trees. Failed text assertions also return at most 200 characters of redacted actual text when available. A timed-out click can report that its target is absent, without returning page content or choosing a replacement. The MCP server allows one active workflow at a time; a concurrent call gets an explicit tool error. Complete tool definitions are now about 4 KB (previously 11.8 KB); schema size alone is not proof of token savings. See [architecture](docs/architecture.md).

## Session diagnostics

Ratatoskr observes cookies and storage locally, without new workflow actions. On a relevant failure it can report that a login returned 200 with Set-Cookie but the cookie was not retained, that a cookie disappeared before a protected request, or that cookies exist despite a nearby 401/403. These are observations, not proof of the underlying cause.

- **Level 1:** at most three sanitized findings, under 750 bytes. Success and unrelated failures return no session subsection.
- **Level 2:** explicitly request `session` through `inspect_browser_run` (or `npm run cli -- inspect run_ID session`). It pages safe cookie attributes, deltas, storage key names and response metadata: default 10 items, hard maximum 25, plus a 6 KB item budget and truncation indicators. Storage changes describe a capture interval, not a fabricated exact mutation step.
- **Level 3:** `RATATOSKR_CAPTURE_AUTH_STATE=1` opts into a protected Playwright storage-state file for relevant failures. It contains cookies/localStorage credentials, **not** sessionStorage, IndexedDB, passkeys or OPFS. Default is off. `get_browser_artifact` returns metadata only; no body or local path. CLI export is also refused. A local internal API can read it; session reuse is not implemented.

**Raw cookie/session values are not automatically returned to Codex.** Ordinary `session.json` contains sanitized metadata/deltas, never values or comparison hashes. Raw Set-Cookie/Authorization headers are not recorded as normal evidence. Comparison uses per-run in-memory HMACs. Full auth-state files are plaintext credentials protected by local permissions where supported, not encryption; never commit/share them. Remove only generated run directories you no longer need.

Observation is bounded and best effort: 200 cookies, 200 storage entries, 100 active-tab sessionStorage keys, 64 retained snapshots and a one-second capture timeout. These are retained metadata limits; Playwright's underlying storageState call reads complete cookies/localStorage transiently. Cross-origin/tab sessionStorage and transient storage writes between captures may be missed. Incomplete captures cannot prove a cookie is absent. Cookies are checked after navigation/click/press/download boundaries; full storage is captured initially, after initial navigation, at first failure and at completion. Extracted/probed text over 16,384 characters is rejected/omitted locally before final redaction; target a narrower element. No new storage-reading, JavaScript or shell capability is exposed to plans.

`RATATOSKR_SESSION_DIAGNOSTICS=off` disables automatic Level 1 findings only, retaining safe observation and explicit inspection; this is the benchmark control. The plugin forwards both configuration variable names after rebuilding/reinstalling; manual MCP users can add them to their `env_vars`. No secret values belong in config. See the [session methodology and results](benchmarks/browser-evidence/session-observability/README.md).

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

The [clean-install plugin validation](docs/distribution.md#authenticated-codex-and-token-check) also records matched fresh medium tasks: 41,000 plugin tokens versus 101,238 direct tokens, with correct diagnoses. That is one sample per configuration, not a repeated benchmark. The plugin/skill adds measured overhead versus manual Ratatoskr MCP; its definitions remain the same size.

## Development and architecture

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks, fixtures, plugin development and clean-install tests. Architecture/dependency boundaries are in [docs/architecture.md](docs/architecture.md). Installation verification and platform limitations are recorded in [docs/distribution.md](docs/distribution.md).

## License

[MIT](LICENSE). Playwright and its downloaded browsers have their own third-party licenses; review them when redistributing a runtime. No npm release or public plugin submission has been made.
