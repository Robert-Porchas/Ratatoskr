# Browser evidence benchmark

This benchmark measures the same profile-debugging task through individual browser tools and Ratatoskr's real stdio MCP server. Detailed browser evidence stays available locally; we measure what each tool path returns and, optionally, what a real model consumes.

The exact task is stored in [prompt.txt](prompt.txt):

> Open the profile page, change the name to 'Ratatoskr Test', save it, and verify that the change persisted. If it fails, determine the cause and report the relevant evidence.

## Two execution drivers

- **Replay (default, offline):** deterministic scripted browser operations, followed by a diagnosis derived from actual returned observations. This verifies the fixture, transport, evidence selection, and metrics. It invokes no model. Token counts and evidence inserted into model context are `null`, never estimates.
- **Model (optional):** the same prompt and shared instruction template go to the OpenAI Responses API. The model chooses tools and constructs its own plan. `BENCHMARK_MODEL` selects the same model for both modes. This is a standalone browser-agent harness, not a measurement of the Codex application's internal token usage. No production model dependency is added to Ratatoskr.

In both drivers, baseline uses a benchmark-only direct Playwright adapter: individual navigate/fill/click calls return full accessibility snapshots and input values; explicit network/console tools return observed logs, including response bodies. No synthetic page content or padding is added. This is a documented direct-browser configuration, not an assertion that every browser tool exposes the same observations. Screenshots are not sent by the baseline, so screenshot tokens cannot inflate its score.

Ratatoskr calls the existing compiled MCP server, discovers its real tool definitions, and forwards its actual tool responses. It uses the existing reducer and shared inspector unchanged. The replay submits fill, click Save, and an assertion of the persisted name. The assertion fails and the normal result includes HTTP 500 and the console's `INTERNAL_ERROR`. No extra inspection is needed in this fixture. In model mode, the model can request the real inspection/artifact tools if necessary; their payloads also count.

## Reproducibility and scoring

Every run gets a new fixture server, browser context/process, and model conversation. Both modes use Chromium from the same installed Playwright, a 1280×720 viewport (Ratatoskr's current default), identical initial data, immutable persisted state, and the same deterministic API failure. Only the ephemeral localhost port differs. Both get the same prompt and instructions, with their own fixture URL substituted. Limits are 16 model turns, 24 tool calls, 4,096 output tokens per turn, and 120 seconds per run. The shared instructions recommend bounded condition waits; the replay assertion uses 500 ms. There are no sleeps. The combined runner alternates execution order across pairs.

`configuration.json` records prompt, limits, model, Node/platform, lockfile hash, configuration hash, Git commit, and whether the tree was dirty. Each result records browser version; each model turn records the provider's resolved model ID. Pin a model snapshot for comparisons when available. The fixture is deterministic; model tool choices and remote service latency are not.

The request audit verifies a GET of `/profile` and a POST containing the desired name. The final structured `report_diagnosis` and actually returned evidence must identify persistence failure, `POST /api/profile`, HTTP 500, and `INTERNAL_ERROR`, without claiming persistence. All seven criteria are recorded per run. A benchmark success means the failing application was correctly investigated, not that saving succeeded. These checks validate the final structured verdict and evidence availability; they are not a general evaluator of arbitrary narrative claims.

## Measurements

- `inputTokens`, `outputTokens`, `totalTokens`: sums of provider-reported usage from **every** model response. Full history, tool schemas, tool calls, and outputs are resent on each turn, including encrypted reasoning items. Missing/failed usage makes totals unavailable; no final-transcript tokenization substitutes for usage. Cached input tokens remain included in provider input totals; this is context usage, not a billing estimate.
- `modelCalls`: actual provider request attempts. `model-turns.jsonl` retains every received response's usage and the request/output for inspection.
- `toolInteractions`: actual browser/MCP calls, including errors and additional inspection. The common final diagnosis tool is excluded.
- `browserInteractions`: high-level browser API operations, including snapshot/log reads for direct mode and assertions/initial navigation for Ratatoskr. It does not count internal polling or protocol messages. These differ from model/tool round trips.
- `returnedEvidenceBytes`: UTF-8 tool response text plus any explicitly requested image base64. It excludes tool arguments and schemas, which have their own overhead. The normal Ratatoskr response retains the real MCP text and structured output. Images use model image inputs without a second copy in text.
- `modelEvidenceBytes`: returned evidence actually supplied to at least one model request, counted once. `cumulativeContextEvidenceBytes` counts it again each time it reappears in growing history. Both are unavailable in replay.
- `rawEvidenceBytes`: serialized locally retained browser events/observations. Baseline captures network bodies and snapshots; production Ratatoskr captures event metadata. These are different capture scopes, so their ratio is not a compression claim. `artifactBytes` separately counts Ratatoskr's registered binaries. Fills disable traces under existing secret policy; failure screenshots remain local unless requested.
- `toolDefinitionsBytes`: serialized function definitions actually offered to the model, including the shared diagnosis tool. Ratatoskr's larger schema is included in every model request. Time includes browser/MCP startup and cleanup, excluding fixture startup and the suite's browser-version probe.

Aggregation uses medians across **all** runs, including failed runs, and reports success counts separately. It rejects mixed suites/configurations, duplicate/unpaired runs, malformed records, and incomplete token coverage. Savings are `(1 - ratatoskrMedian / baselineMedian) * 100`; a zero/missing baseline yields no percentage. A reduction in returned bytes alone does not establish a reduction in total model tokens.

## Run from a fresh clone

Normal development requirements: Node.js 22+, npm, Git. Browser requirements: Playwright Chromium and its OS libraries. On supported Linux systems, `npx playwright install --with-deps chromium` can install the browser and required OS packages; installing OS packages may require elevated permission.

```sh
git clone https://github.com/Robert-Porchas/Ratatoskr.git
cd Ratatoskr
npm ci
npx playwright install chromium
npm test
npm run typecheck
npm run lint
npm run test:benchmark
BENCHMARK_RUNS=10 npm run benchmark:browser
```

The offline benchmark needs **no API key, external account, Codex installation, or internet access after dependencies/browser are installed**. Model mode requires an OpenAI API key, an accessible model, and network access. Set the key locally; do not put it in committed files. Codex authentication does not substitute for an API key in this harness.

```sh
# OPENAI_API_KEY is already set locally.
# First validate a small paid experiment with a model your account supports:
BENCHMARK_DRIVER=model BENCHMARK_MODEL=YOUR_MODEL_ID BENCHMARK_RUNS=1 npm run benchmark:browser
# Then collect the final ten-run comparison:
BENCHMARK_DRIVER=model BENCHMARK_MODEL=YOUR_MODEL_ID BENCHMARK_RUNS=10 npm run benchmark:browser
```

Run modes independently using a new shared suite identifier and the same environment/configuration:

```sh
BENCHMARK_SUITE=my-comparison BENCHMARK_RUNS=10 npm run benchmark:browser:baseline
BENCHMARK_SUITE=my-comparison BENCHMARK_RUNS=10 npm run benchmark:browser:ratatoskr
```

Suite IDs cannot contain paths. Existing run directories are never overwritten. Use a new ID for each experiment. The summary can be regenerated without a browser/model:

```sh
npm run benchmark:browser:summary -- benchmarks/browser-evidence/results/my-comparison/results.jsonl benchmarks/browser-evidence/results/my-comparison/summary.md
npm run benchmark:browser:summary -- benchmarks/browser-evidence/sample/results.jsonl
```

## Output and recorded sample

Generated data lives in ignored `results/<suite>/`: `configuration.json`, append-only `results.jsonl`, generated `summary.md`, and one directory per mode/run. Each directory has `interactions.jsonl`, `run.md`, `report.json`, and `fixture-audit.json`; model runs add `model-turns.jsonl`. Direct runs retain `direct-evidence.json`; Ratatoskr runs retain its normal run/artifact store plus MCP stderr. Nothing needs to be fetched from a cloud analytics service. Failed benchmark runs exit nonzero after preserving their records.

The checked-in [sample summary](sample/summary.md) is generated from [20 individual records](sample/results.jsonl), ten per mode. [Direct run 1](sample/baseline-1/run.md) and [Ratatoskr run 1](sample/ratatoskr-1/run.md) include actual sequences and observations. All full run data, including screenshots, is preserved locally when you execute the runner; the published sample contains representative text logs and all result records, without binary artifacts.

This sample is **offline replay**, not measured model-token savings. A real provider experiment was not run because no API key was available in the implementation environment. Provider-loop tests use a test double to check history and cumulative accounting; those test numbers never become benchmark results. The real provider path remains unverified against a live account. This small fixture also cannot establish savings for arbitrary applications, other direct-browser tools, multimodal workloads, or Codex's client-specific schema-loading/context policies.

Provider behavior follows [Responses function calling](https://developers.openai.com/api/docs/guides/function-calling) and [Responses usage metadata](https://developers.openai.com/api/reference/cli/resources/responses/methods/create). Optional tooling: Codex can help interpret a result, but is not needed to run or summarize this benchmark.
