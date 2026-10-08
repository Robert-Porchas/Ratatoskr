# Browser evidence benchmark

The [workflow intelligence report](workflow-intelligence/README.md) measures variables, optional login, local recovery, deterministic failure and test conversion with fresh native Codex tasks. Use `BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=10 npm run benchmark:workflow`. `BENCHMARK_MAX_TOOL_CALLS=40` raises both the runner and MCP proxy cap for full-flow comparisons; each configuration records both limits. Preserved capped/unsuccessful tasks remain separate from the complete repeats.

## Session diagnostics experiment

The [session-observability experiment](session-observability/README.md) compares automatic findings off/on and native Playwright MCP cookie/storage investigation. Run `npm run test:session` without model credentials, or `BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=1 BENCHMARK_SESSION_SCENARIOS=missing BENCHMARK_SUITE=my-session-pilot npm run benchmark:session` for three isolated Codex tasks. Actual Codex tokens, safe local session bytes, inspection calls and capture timings are separate measurements. Default repeated coverage uses ten attempts per case, preserving unsuccessful diagnoses.

## Token optimization matrix

The current token-first comparison is `npm run benchmark:tokens`. It uses fresh Codex tasks with shared source-known routes, locators and values, and increasing real form sizes (1, 2, 4, or 9 fields). These facts are supplied identically and counted in both model contexts; setup/source exploration is not measured. Each task must submit every changed field and verify persisted state or correctly diagnose the failure.

Its default baseline is **official `@playwright/mcp@0.0.83`**, not the original simplified adapter. It includes bulk `browser_fill_form` and 16 other fixture-relevant core tools, with native input definitions and responses, isolated headless sessions and the same installed Chromium executable/viewport as Ratatoskr. JavaScript evaluation, shell, upload/installation and caller-supplied file paths are excluded from both modes. Normal generated snapshots/code snippets/file references remain in the native response. The baseline is this explicit configuration, not every possible Codex browser tool. `BENCHMARK_BASELINES=direct,playwright` additionally measures the original six-tool individual-action adapter; comparisons stay separately labeled.

Ratatoskr forwards real MCP responses without JSON-inside-JSON serialization. The wrapper preserves output schemas, titles and annotations; an integration test compares both servers' full discovered tool lists with their wrappers. Terminal Codex `item.completed` MCP events count **every** returned text, structured output, image and transport error, including SDK validation failures before the handler. `toolArgumentBytes`, `toolResultBytes`, `invalidToolCalls` and per-tool input/description/definition sizes supplement authoritative native token totals. `invalidToolCalls` counts malformed/invalid arguments or plans; `failedToolCalls` separately counts all MCP error replies, including valid runtime timeouts. A completed workflow with `success:false` is neither. These are not inference counts. Archived exploratory counters used broader error semantics; final publications are explicitly audited.

```sh
# Requires codex login and network access; no separate API key with ChatGPT login.
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=1 BENCHMARK_SUITE=my-pilot npm run benchmark:tokens
# Ten pairs for the intended medium/large runtime-failure case:
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=10 \
BENCHMARK_SCENARIOS=medium-http_failure,large-http_failure \
BENCHMARK_SUITE=my-primary npm run benchmark:tokens
# All sizes/outcomes (140 model tasks by default):
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=10 BENCHMARK_SUITE=my-matrix npm run benchmark:tokens
npm run benchmark:tokens:summary -- benchmarks/browser-evidence/results/my-primary/results.jsonl
```

`BENCHMARK_SCENARIOS` accepts size (`tiny`, `small`, `medium`, `large`) plus outcome (`http_failure`, `success`, `locator_failure`), separated by a hyphen; comma-separate cases. Default cases are four HTTP failures, medium/large success, and medium locator failure. Missing Publish is a deliberate locator failure, not a permission to click Save instead. Success fixtures really persist in local memory and require a reload; HTTP-failure fixtures retain initial state and return the same 500/INTERNAL_ERROR. The nominal planned-step count covers fill/verify per field plus navigation/submit; executed actions and agent retries are measured separately.

Each task has a fresh process/thread, fixture and browser, 180-second deadline and 24-call cap. Runs default to ten, concurrency to one (`BENCHMARK_CONCURRENCY=2` is supported and recorded); mode order alternates per pair. Reasoning defaults to medium. Both modes use the same authoritative accounting. Setup/build/report generation are outside the task. Summaries include median/min/max/mean/population standard deviation and all failures, reject mixed configurations/unpaired tasks, and show unavailable totals as N/A. Negative `(Rat − direct) / direct` percentages are improvement.

The checked-in [optimization record](optimization/README.md) and [final sprint report](optimization/report.md) document pre/post measurements and limitations. Ten fresh pairs each demonstrate 59.2% and 65.2% median total-token reductions for the measured medium/large HTTP-failure scenarios; all diagnoses are correct. Secondary three-pair samples cover smaller tasks, actual successful persistence and absent controls. Their unfavorable attempts remain included. The older sample below is historical: its handler-only byte/call counter missed a 13,950-byte SDK rejection. Its Codex token totals remain valid, but its returned-byte and call-count comparison is not a reliable current benchmark. `optimization/pre.json` preserves a new pre-optimization pair with corrected event accounting.

This benchmark measures the same profile-debugging task through individual browser tools and Ratatoskr's real stdio MCP server. Detailed browser evidence stays available locally; we measure what each tool path returns and, optionally, what a real model consumes.

The exact task is stored in [prompt.txt](prompt.txt):

> Open the profile page, change the name to 'Ratatoskr Test', save it, and verify that the change persisted. If it fails, determine the cause and report the relevant evidence.

## Three execution drivers

- **Replay (default, offline):** deterministic scripted browser operations, followed by a diagnosis derived from actual returned observations. This verifies the fixture, transport, evidence selection, and metrics. It invokes no model. Token counts and evidence inserted into model context are `null`, never estimates.
- **Model (optional):** the same prompt and shared instruction template go to the OpenAI Responses API. The model chooses tools and constructs its own plan. `BENCHMARK_MODEL` selects the same model for both modes. This is a standalone browser-agent harness, not a measurement of the Codex application's internal token usage. No production model dependency is added to Ratatoskr.
- **Codex (actual Codex accounting):** a fresh `codex exec --json --ephemeral` process receives the canonical prompt for each task. A benchmark-only MCP transport exposes the same direct observations or forwards the real Ratatoskr responses. Codex chooses the operations. Only this fixture's MCP server is approved for unattended execution; shell, web search, unrelated MCP servers, plugins, and repository instructions are disabled. No global Codex configuration is changed.

In the original profile runner, baseline uses a benchmark-only direct Playwright adapter: individual navigate/fill/click calls return full accessibility snapshots and input values; explicit network/console tools return observed logs, including response bodies. No synthetic page content or padding is added. This is a documented direct-browser configuration, not an assertion that every browser tool exposes the same observations. Screenshots are not sent by the baseline, so screenshot tokens cannot inflate its score.

Ratatoskr calls the existing compiled MCP server, discovers its real tool definitions, and forwards its actual tool responses. It uses the existing reducer and shared inspector unchanged. The replay submits fill, click Save, and an assertion of the persisted name. The assertion fails and the normal result includes HTTP 500 and the console's `INTERNAL_ERROR`. No extra inspection is needed in this fixture. In model mode, the model can request the real inspection/artifact tools if necessary; their payloads also count.

## Reproducibility and scoring

Every run gets a new fixture server, browser context/process, and model conversation. Both modes use Chromium from the same installed Playwright, a 1280×720 viewport (Ratatoskr's current default), identical initial data, immutable persisted state, and the same deterministic API failure. Only the ephemeral localhost port differs. Both get the same prompt and instructions, with their own fixture URL substituted. The profile drivers enforce 24 browser tool calls and a 120-second task timeout (the size matrix uses 180 seconds). The API driver additionally limits 16 model turns and 4,096 output tokens per turn; Codex does not expose equivalent CLI limits, so these configuration fields are explicitly null. The shared instructions recommend bounded condition waits; current compact MCP assertions use the server's 5-second default. The historical replay sample used 500 ms. There are no sleeps. The combined runner alternates execution order across pairs.

`configuration.json` records prompt, limits, model, Node/platform, lockfile hash, configuration hash, Git commit, and whether the tree was dirty. Each result records browser version; each model turn records the provider's resolved model ID. Pin a model snapshot for comparisons when available. The fixture is deterministic; model tool choices and remote service latency are not.

The request audit verifies a GET of `/profile` and a POST containing the desired name. The final structured `report_diagnosis` and actually returned evidence must identify persistence failure, `POST /api/profile`, HTTP 500, and `INTERNAL_ERROR`, without claiming persistence. All seven criteria are recorded per run. A benchmark success means the failing application was correctly investigated, not that saving succeeded. These checks validate the final structured verdict and evidence availability; they are not a general evaluator of arbitrary narrative claims.

## Measurements

Browser evidence bytes and model tokens are independent measurements. There is **no bytes-to-tokens conversion or external tokenizer**. Codex totals include its own instructions, tool definitions, reasoning, repeated context, and final diagnosis, not just browser evidence.

### Codex-native token provenance and boundary

The historical validation used `codex-cli 0.159.2`; this optimization sprint uses `codex-cli 0.160.0`. Its official JSON stream ends with `turn.completed.usage`: `input_tokens`, `output_tokens`, `cached_input_tokens`, and `reasoning_output_tokens`. This is the cumulative completed user-task total, including internal model/tool round trips, not the last individual inference. Each measured process accepts exactly one canonical task in a neutral temporary directory; it never resumes another thread. Setup, compilation, this development conversation, and report generation occur outside that process. We require exactly one thread start, one task start, and one completion, rejecting missing/duplicate/failed usage rather than double-counting it.

Normalized records identify `tokenSource: "codex-json-events"`, `tokenAuthoritative: true`, and `tokenScope: "isolated-codex-task"`. `totalTokens` uses the reported total when present, validating it against input plus output; this CLI version supplies only the two components, so their sum is used. Cached tokens are a subset of input: `uncachedInputTokens = inputTokens - cachedInputTokens`. Reasoning tokens are a subset of output. Neither subset is added again to the total. Unknown optional fields remain null. Raw usage retains additional fields such as `cache_write_input_tokens`; these are not independently added to token totals or treated as cache hits.

Codex does not expose per-inference usage/counts in this exec stream. `modelCalls` and `cumulativeContextEvidenceBytes` therefore remain null, and we do not fabricate a per-model-turn growth chart. `modelEvidenceBytes` is the unchanged sum of browser reply payloads delivered to Codex, excluding its protocol wrapping; it is not a measurement of Codex's internal context serialization. Raw events preserve actual MCP calls and the final diagnosis for auditing.

- `inputTokens`, `outputTokens`, `totalTokens`: authoritative isolated Codex task totals, or sums of Responses API usage from **every** model response. In API mode, full history, tool schemas, tool calls, and outputs are resent on each turn, including encrypted reasoning items. Missing/failed usage makes totals unavailable; no final-transcript tokenization substitutes for usage. Cached input tokens remain included in provider input totals; this is context usage, not a billing estimate.
- `modelCalls`: actual provider request attempts. `model-turns.jsonl` retains every received response's usage and the request/output for inspection.
- `toolInteractions`: actual browser/MCP calls, including errors and additional inspection. The common final diagnosis tool is excluded.
- `browserInteractions`: scoped supporting counts, not directly interchangeable. Ratatoskr counts attempted plan steps plus initial navigation, excluding URL/text/existence diagnostics, screenshots and polling. The custom direct adapter counts its browser/log/snapshot operations. Standard Playwright MCP counts tool calls, so bulk form fill remains one call rather than one per field. These differ from model/tool round trips and must not determine token-savings claims.
- `returnedEvidenceBytes`: UTF-8 tool response text plus any explicitly requested image base64. It excludes tool arguments and schemas, which have their own overhead. The normal Ratatoskr response retains the real MCP text and structured output. Images use model image inputs without a second copy in text.
- `modelEvidenceBytes`: returned evidence actually supplied to at least one model request, counted once. `cumulativeContextEvidenceBytes` counts it again each time it reappears in growing history. Both are unavailable in replay.
- `rawEvidenceBytes`: serialized locally retained browser events/observations. Baseline captures network bodies and snapshots; production Ratatoskr captures event metadata. These are different capture scopes, so their ratio is not a compression claim. `artifactBytes` separately counts Ratatoskr's registered binaries. Fills disable traces under existing secret policy; failure screenshots remain local unless requested.
- `toolDefinitionsBytes`: serialized function definitions actually offered to the model, including the diagnosis tool for the API driver only. Codex definitions are measured from discovered input schemas/descriptions; production full definitions (also output schemas and annotations) are recorded separately. Time includes browser/MCP startup and cleanup, excluding fixture startup and the suite's browser-version probe.

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

For native size-matrix runs, `npm run benchmark:tokens:audit -- benchmarks/browser-evidence/results/my-primary` verifies original usage/counters and writes new `audited-results.jsonl` and `audited-summary.md`, without overwriting originals. It distinguishes invalid arguments from expected runtime failures and checks method/path and the 24-call budget. One published boundary baseline task exceeded that budget: its tokens remain included, while its audited success becomes false. The live runner now counts `item.started` MCP requests, so retries rejected before the handler cannot bypass the cap.

Generated data lives in ignored `results/<suite>/`: `configuration.json`, append-only `results.jsonl`, generated `summary.md`, and one directory per mode/run. Each directory has `interactions.jsonl`, `run.md`, `report.json`, and `fixture-audit.json`; model runs add `model-turns.jsonl`. Direct runs retain `direct-evidence.json`; Ratatoskr runs retain its normal run/artifact store plus MCP stderr. Nothing needs to be fetched from a cloud analytics service. Failed benchmark runs exit nonzero after preserving their records.

Codex runs additionally retain `codex-events.jsonl`, the unmodified terminal events in `codex-usage.json`, `codex-final.json`, diagnostic stderr, launch options, and browser transport metrics. The final summary refuses to compare different token sources or Codex versions. Do not combine replay, API, and Codex runs into one suite. The validation sample retains original and corrected scoring records; its [audit notes](codex-sample/README.md) explain the reproducible correction. No token or byte measurements changed during regrading.

The checked-in [sample summary](sample/summary.md) is generated from [20 individual records](sample/results.jsonl), ten per mode. [Direct run 1](sample/baseline-1/run.md) and [Ratatoskr run 1](sample/ratatoskr-1/run.md) include actual sequences and observations. All full run data, including screenshots, is preserved locally when you execute the runner; the published sample contains representative text logs and all result records, without binary artifacts.

This original sample is **offline replay**, not measured model-token savings. The separate [Codex validation sample](codex-sample/summary.md) records one live task per mode, with raw native usage and interaction logs. It validates the accounting pipeline, not statistical reliability or universal savings. Provider-loop tests use a test double; those numbers never become benchmark results. The separate Responses API path remains unverified against a live API account. This small fixture cannot establish savings for arbitrary applications, other direct-browser tools, or multimodal workloads. Codex's relatively large shared instruction overhead and caching are included, not subtracted.

Accounting follows [Codex non-interactive JSON events](https://learn.chatgpt.com/docs/non-interactive-mode), [Responses function calling](https://developers.openai.com/api/docs/guides/function-calling), and [Responses usage metadata](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).
