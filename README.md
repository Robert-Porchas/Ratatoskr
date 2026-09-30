# Browser Bridge

Browser Bridge executes a structured browser workflow locally and returns a small result. It keeps network, console, navigation, step, and artifact evidence on disk for later inspection. This reduces the repeated browser snapshots and tool round trips a coding agent needs to consume during an end-to-end task.

The current milestone is a CLI, not an MCP server or an autonomous browser agent. Codex or a person writes the plan; the bridge executes bounded steps deterministically.

## Architecture

The protocol defines validated plans and records. The executor runs steps through a browser interface. The Playwright adapter is the only module that imports Playwright. An evidence collector stores timestamped events; a pure reducer selects nearby failures. Filesystem stores persist runs and artifacts. The CLI composes these parts. See [architecture](docs/architecture.md) for boundaries and the future MCP seam.

## Install and verify

Requires Node.js 22 or newer and npm.

```sh
npm install
npx playwright install chromium
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

The end-to-end test starts its own local website and browser. Unit tests do not require a browser download.

## Run the examples

In one terminal, start the local fixture:

```sh
npm run fixture
```

In another terminal:

```sh
export TEST_EMAIL=demo@example.test TEST_PASSWORD=password123
npm run cli -- run ./examples/login-success.json
npm run cli -- run ./examples/login-failure.json
```

The successful command prints only `{"success":true,"runId":"..."}`. The failure command prints a short JSON diagnosis with the failed zero-based step index, nearby errors, and a screenshot artifact ID; it exits with status 1 intentionally. The fixture returns HTTP 500 for the failing login.

Inspect a previous run or retrieve its artifact in a separate command:

```sh
npm run cli -- inspect run_ID
npm run cli -- inspect run_ID steps,network,console,navigation
npm run cli -- artifact run_ID artifact_ID
npm run cli -- artifact run_ID artifact_ID --out ./failure.png
```

`BROWSER_BRIDGE_DATA_DIR` changes the storage root; it defaults to `.browser-bridge/` in the current working directory. Each run has `metadata.json`, `workflow.json`, `steps.json`, `evidence.jsonl`, `reduced-result.json`, and an `artifacts/` directory. The workflow stores references such as `TEST_PASSWORD`, never their resolved values. Screenshots mask input fields and text matching resolved values. Traces are disabled for plans with fill steps because traces may contain typed values. Pages that draw secrets into canvas or images are outside the current screenshot redaction capability; avoid running secret-bearing plans against pages that do that.

## Plan format and limits

Plans use an HTTP(S) `startUrl` and up to 100 steps. Supported actions are `navigate`, `click`, `fill`, `press`, `wait_for`, `assert_url`, `assert_text`, and `assert_visible`. Targets use role and accessible name, label, text, test ID, or CSS. A fill step requires `valueRef` naming an environment variable. Steps accept optional `timeoutMs` and `continueOnFailure`. Browser operations have a five-second default timeout. The fixture also has delayed, missing, unexpected, console-error, and page-error routes for further testing.

The reducer ranks error events within the failed step or a two-second margin by proximity and severity, returning at most three. It suppresses Chromium's generic load-error message when an HTTP error is already present. This can miss errors from long asynchronous chains or pick a nearby but unrelated event. The bridge currently captures event metadata rather than full network bodies or accessibility snapshots. The reported compression ratio compares serialized event bytes with the reduced JSON response and excludes binary artifacts. It has no domain policy, authentication, MCP endpoint, or desktop service yet.

Next, the executor and stores can be exposed through a small MCP API: run a workflow, inspect a run, and retrieve an artifact. Benchmarking direct browser interaction against this bridge should then measure context size, round trips, task outcomes, and duration.
