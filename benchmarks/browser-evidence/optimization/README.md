# Ratatoskr token optimization record

## Published measurements

The [final sprint report](report.md) explains the token regression, optimizations, measured scope and remaining bottlenecks. Conclusion: Ratatoskr uses fewer authoritative total Codex tokens on the measured source-known, multi-step workflows—not necessarily on every browser task/tool configuration.

- [Production summary](production-summary.md): ten fresh pairs each, medium/large HTTP failures; 59.2%/65.2% median token reductions, all correct. [40 rows](production-results.jsonl), [native usage/verdicts](production-usage.json), [metadata](production-metadata.json).
- [Boundary summary](boundaries-summary.md): three pairs each for tiny/small failures, medium/large successful persistence and locator failure. [30 rows](boundaries-results.jsonl), [native usage/verdicts](boundaries-usage.json), [metadata](boundaries-metadata.json). One baseline task exceeded the call budget and remains included as unsuccessful; no tokens removed.
- [Custom baseline summary](custom-summary.md): three pairs each against the older six-tool direct harness, including its smaller schema. [12 rows](custom-results.jsonl), [native usage/verdicts](custom-usage.json), [metadata](custom-metadata.json).
- [Focused locator remeasurement](locator-repair-summary.md): three fresh pairs after a bounded absent-click diagnostic; Ratatoskr falls from three calls to one, with 47.9% paired median token reduction. [Six rows](locator-repair-results.jsonl), [native usage/verdicts](locator-repair-usage.json), [metadata](locator-repair-metadata.json).

Tests regenerate all summaries from the records and validate every normalized total against native completion usage. These publications contain 88 unique isolated tasks, excluding exploratory stages. Primary runs were performed before the click-absence change, which affects the locator-failure path only. The smaller secondary samples do not establish a universal crossover; two/three-action successes remain untested.

## What is measured

The primary metric is cumulative **Codex-reported input plus output tokens for one complete browser task**. A new `codex exec --json --ephemeral` process/thread receives one task and finishes with a structured verdict. `turn.completed.usage.input_tokens` and `output_tokens` cover internal model/tool round trips. `cached_input_tokens` is included in input; `reasoning_output_tokens` is included in output. They are not added again. Uncached input is input minus cached input. No tokenizer or byte conversion supplies these numbers.

The recorded environment uses Codex CLI 0.160.0, `gpt-6.1-sol`, medium reasoning, Chromium 153.0.8010.12 and 1280×720. The model alias is not an immutable provider snapshot. Provider behavior, latency, caching and tool choices can vary. Per-inference counts/usage and exact attribution of token savings to schemas versus retries are unavailable; we do not fabricate those metrics.

## Baselines and scope

`playwright` is pinned official Playwright MCP 0.0.83: 17 safe fixture-relevant tools, including bulk form fill, with native definitions/responses. It uses normal defaults rather than artificial full observations or mandatory screenshots. `direct` is the earlier six-tool individual-action harness with uncompressed snapshots/logs. The latter is not called the standard browser tool. Both use the same Chromium binary and fresh local fixture as Ratatoskr.

Both modes receive identical tasks, routes, input IDs/labels, local value references, expected values and persisted-state selectors derived from fixture source. Outcomes are not disclosed. Model-visible source facts count toward tokens; fixture/build/source exploration outside the isolated process does not. Ratatoskr uses its real production normalizer, executor and reducer, not a benchmark-specific compressor. An application failure counts as benchmark success only when actually submitted values and returned evidence support a correct failure diagnosis.

Forms grow from 1 to 9 real fields. Nominal planned steps are 4/6/10/20; actual operations may include a synchronization assertion, reload and retries, or stop early on failure. No padding, forced baseline screenshots or excluded unsuccessful attempts. Missing Publish tests a genuinely absent control; success requires real persistence across reload. These controlled source-known tasks do not prove a crossover for unrelated websites, browsing research, multimodal work or every browser tool configuration.

## Evidence and accounting corrections

Terminal Codex MCP events count replies from SDK validation, handlers, inspection, artifacts and transport failures. Payload byte measurements include text, structured output and requested image base64 once per returned payload; they do not claim to reproduce Codex's internal serialization. Native tokens capture whatever Codex actually consumes. Local `rawEvidenceBytes` have different capture scopes: native observations for standard MCP, richer logs/snapshots for the custom adapter, and event metadata for Ratatoskr. Do not infer compression or token ratios from those raw sizes. Standard MCP's generated on-disk files are not included in its current binary-artifact byte metric.

`pre.json` retains the strict-protocol pre-optimization pair and full production schema sizes. `stages.json` preserves single-pair intermediate experiments, including the unfavorable large custom-baseline result and the historical grading bug. `discovery-limited-repeat.json` preserves the first ten-pair experiment, which omitted output schemas/annotations in discovery: valid native usage, but not production metadata parity. Final runs must use the corrected wrapper; integration tests assert full discovered-definition equality against both real servers. Local ignored `results/<suite>/` directories retain native events, raw usage, final diagnoses, tool sequences, fixture audits and artifacts. Published records omit large logs/images and credentials, not unfavorable numeric rows. Archived exploratory error counters included runtime failures. Final publications separate `invalidToolCalls` (malformed arguments/plans) from `failedToolCalls` (all MCP errors, including valid runtime timeouts); completed `success:false` browser workflows are valid calls.

## Reproduce

Install Node.js 22+, npm, Git, project dependencies and Playwright Chromium (`npm ci`, `npx playwright install chromium`; Linux may need browser OS libraries). Install an official Codex CLI supporting the recorded flags and authenticate with `codex login`. Native Codex benchmarks require model access and network; ChatGPT login does not require a separate API key. Offline tests/replay need no model account. No database, cloud fixture or optional analytics tool is needed.

```sh
npm test
npm run typecheck
npm run lint
npm run test:benchmark
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=1 BENCHMARK_SUITE=pilot npm run benchmark:tokens
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=10 \
BENCHMARK_SCENARIOS=medium-http_failure,large-http_failure \
BENCHMARK_SUITE=primary npm run benchmark:tokens
npm run benchmark:tokens:summary -- benchmarks/browser-evidence/results/primary/results.jsonl
```

Choose a new suite ID; existing results are never overwritten. For all seven default size/outcome cases, omit `BENCHMARK_SCENARIOS` (140 tasks for ten pairs). Add `BENCHMARK_BASELINES=direct,playwright` only to measure both separately; it doubles the task count. Defaults use one simultaneous pair; concurrency two is supported and recorded. Never compare suites with different models/reasoning/configuration as though they were one paired experiment.
