# Browser evidence benchmark

This benchmark measures the same profile-debugging task through individual browser tools and Ratatoskr's real stdio MCP server. Detailed browser evidence stays available locally; we measure what each tool path returns and, optionally, what a real model consumes.

The exact task is stored in [prompt.txt](prompt.txt):

> Open the profile page, change the name to 'Ratatoskr Test', save it, and verify that the change persisted. If it fails, determine the cause and report the relevant evidence.

## Three execution drivers

- **Replay (default, offline):** deterministic scripted browser operations, followed by a diagnosis derived from actual returned observations. This verifies the fixture, transport, evidence selection, and metrics. It invokes no model. Token counts and evidence inserted into model context are `null`, never estimates.
- **Model (optional):** the same prompt and shared instruction template go to the OpenAI Responses API. The model chooses tools and constructs its own plan. `BENCHMARK_MODEL` selects the same model for both modes. This is a standalone browser-agent harness, not a measurement of the Codex application's internal token usage. No production model dependency is added to Ratatoskr.
- **Codex (actual Codex accounting):** a fresh `codex exec --json --ephemeral` process receives the canonical prompt for each task. A benchmark-only MCP transport exposes the same direct observations or forwards the real Ratatoskr responses. Codex chooses the operations. Only this fixture's MCP server is approved for unattended execution; shell, web search, unrelated MCP servers, plugins, and repository instructions are disabled. No global Codex configuration is changed.

In both drivers, baseline uses a benchmark-only direct Playwright adapter: individual navigate/fill/click calls return full accessibility snapshots and input values; explicit network/console tools return observed logs, including response bodies. No synthetic page content or padding is added. This is a documented direct-browser configuration, not an assertion that every browser tool exposes the same observations. Screenshots are not sent by the baseline, so screenshot tokens cannot inflate its score.

Ratatoskr calls the existing compiled MCP server, discovers its real tool definitions, and forwards its actual tool responses. It uses the existing reducer and shared inspector unchanged. The replay submits fill, click Save, and an assertion of the persisted name. The assertion fails and the normal result includes HTTP 500 and the console's `INTERNAL_ERROR`. No extra inspection is needed in this fixture. In model mode, the model can request the real inspection/artifact tools if necessary; their payloads also count.

## Reproducibility and scoring

Every run gets a new fixture server, browser context/process, and model conversation. Both modes use Chromium from the same installed Playwright, a 1280×720 viewport (Ratatoskr's current default), identical initial data, immutable persisted state, and the same deterministic API failure. Only the ephemeral localhost port differs. Both get the same prompt and instructions, with their own fixture URL substituted. All drivers enforce 24 browser tool calls and a 120-second task timeout. The API driver additionally limits 16 model turns and 4,096 output tokens per turn; Codex does not expose equivalent CLI limits, so these configuration fields are explicitly null. The shared instructions recommend bounded condition waits; the replay assertion uses 500 ms. There are no sleeps. The combined runner alternates execution order across pairs.

`configuration.json` records prompt, limits, model, Node/platform, lockfile hash, configuration hash, Git commit, and whether the tree was dirty. Each result records browser version; each model turn records the provider's resolved model ID. Pin a model snapshot for comparisons when available. The fixture is deterministic; model tool choices and remote service latency are not.

The request audit verifies a GET of `/profile` and a POST containing the desired name. The final structured `report_diagnosis` and actually returned evidence must identify persistence failure, `POST /api/profile`, HTTP 500, and `INTERNAL_ERROR`, without claiming persistence. All seven criteria are recorded per run. A benchmark success means the failing application was correctly investigated, not that saving succeeded. These checks validate the final structured verdict and evidence availability; they are not a general evaluator of arbitrary narrative claims.

## Measurements

Browser evidence bytes and model tokens are independent measurements. There is **no bytes-to-tokens conversion or external tokenizer**. Codex totals include its own instructions, tool definitions, reasoning, repeated context, and final diagnosis, not just browser evidence.

### Codex-native token provenance and boundary

The installed validation version is `codex-cli 0.159.2`. Its official JSON stream ends with `turn.completed.usage`: `input_tokens`, `output_tokens`, `cached_input_tokens`, and `reasoning_output_tokens`. This is the cumulative completed user-task total, including internal model/tool round trips, not the last individual inference. Each measured process accepts exactly one canonical task in a neutral temporary directory; it never resumes another thread. Setup, compilation, this development conversation, and report generation occur outside that process. We require exactly one thread start, one task start, and one completion, rejecting missing/duplicate/failed usage rather than double-counting it.

Normalized records identify `tokenSource: "codex-json-events"`, `tokenAuthoritative: true`, and `tokenScope: "isolated-codex-task"`. `totalTokens` uses the reported total when present, validating it against input plus output; this CLI version supplies only the two components, so their sum is used. Cached tokens are a subset of input: `uncachedInputTokens = inputTokens - cachedInputTokens`. Reasoning tokens are a subset of output. Neither subset is added again to the total. Unknown optional fields remain null. Raw usage retains additional fields such as `cache_write_input_tokens`; these are not independently added to token totals or treated as cache hits.

Codex does not expose per-inference usage/counts in this exec stream. `modelCalls` and `cumulativeContextEvidenceBytes` therefore remain null, and we do not fabricate a per-model-turn growth chart. `modelEvidenceBytes` is the unchanged sum of browser reply payloads delivered to Codex, excluding its protocol wrapping; it is not a measurement of Codex's internal context serialization. Raw events preserve actual MCP calls and the final diagnosis for auditing.

- `inputTokens`, `outputTokens`, `totalTokens`: authoritative isolated Codex task totals, or sums of Responses API usage from **every** model response. In API mode, full history, tool schemas, tool calls, and outputs are resent on each turn, including encrypted reasoning items. Missing/failed usage makes totals unavailable; no final-transcript tokenization substitutes for usage. Cached input tokens remain included in provider input totals; this is context usage, not a billing estimate.
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

The offline benchmark needs **no API key, external account, Codex installation, or internet access after dependencies/browser are installed**. Codex mode requires a current Codex CLI supporting the recorded flags, `codex login`, network access, and an accessible model. ChatGPT-based Codex login requires no separate API key. API model mode instead requires `OPENAI_API_KEY`. Keep authentication local; never commit credentials. Optional tooling: a Markdown viewer for reports.

```sh
codex --version
codex login status
# One real task per mode, identical accounting and configuration:
BENCHMARK_DRIVER=codex BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=1 BENCHMARK_SUITE=my-codex-check npm run benchmark:browser:baseline
BENCHMARK_DRIVER=codex BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=1 BENCHMARK_SUITE=my-codex-check npm run benchmark:browser:ratatoskr
# Final repeated comparison (ten pairs, remote model usage):
BENCHMARK_DRIVER=codex BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=10 BENCHMARK_SUITE=my-codex-ten npm run benchmark:browser
```

Choose a model your Codex account supports and use the same model for both modes. Reasoning defaults to `medium`; configure both with `BENCHMARK_CODEX_REASONING_EFFORT` (`low`, `medium`, or `high`) if needed. Model execution consumes account usage; the local fixture never needs an external service.

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

Codex runs additionally retain `codex-events.jsonl`, the unmodified terminal events in `codex-usage.json`, `codex-final.json`, diagnostic stderr, launch options, and browser transport metrics. The final summary refuses to compare different token sources or Codex versions. Do not combine replay, API, and Codex runs into one suite. The validation sample retains original and corrected scoring records; its [audit notes](codex-sample/README.md) explain the reproducible correction. No token or byte measurements changed during regrading.

The checked-in [sample summary](sample/summary.md) is generated from [20 individual records](sample/results.jsonl), ten per mode. [Direct run 1](sample/baseline-1/run.md) and [Ratatoskr run 1](sample/ratatoskr-1/run.md) include actual sequences and observations. All full run data, including screenshots, is preserved locally when you execute the runner; the published sample contains representative text logs and all result records, without binary artifacts.

This original sample is **offline replay**, not measured model-token savings. The separate [Codex validation sample](codex-sample/summary.md) records one live task per mode, with raw native usage and interaction logs. It validates the accounting pipeline, not statistical reliability or universal savings. Provider-loop tests use a test double; those numbers never become benchmark results. The separate Responses API path remains unverified against a live API account. This small fixture cannot establish savings for arbitrary applications, other direct-browser tools, or multimodal workloads. Codex's relatively large shared instruction overhead and caching are included, not subtracted.

Accounting follows [Codex non-interactive JSON events](https://learn.chatgpt.com/docs/non-interactive-mode), [Responses function calling](https://developers.openai.com/api/docs/guides/function-calling), and [Responses usage metadata](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).
