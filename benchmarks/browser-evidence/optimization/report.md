# Ratatoskr token optimization sprint

## Conclusion

**A. Ratatoskr now uses fewer total Codex tokens for the measured intended class of source-known, multi-step workflows.** Ten fresh pairs each show 59.2% and 65.2% median savings for medium/large application failures, with 10/10 correct task outcomes and diagnoses in both modes. This is a scoped result, not a claim against every browser tool or unrestricted code execution.

Measurements: October 2, 2026; Codex CLI 0.160.0; `gpt-6.1-sol`; medium reasoning; Chromium 153.0.8010.12; 1280×720. Model aliases are not immutable snapshots. Primary execution commit: `6a02bb6`; bounded locator diagnostic remeasurement: `5b31edc`. Exact full hashes/configurations are in each published metadata file.

## Why the original protocol regressed

The original live profile task consumed **54,876 direct versus 214,786 Ratatoskr tokens**, despite local evidence reduction. The complete native event stream revealed eight Ratatoskr calls versus five direct calls, one 13,950-byte SDK validation rejection, redundant evidence serialization and an explicit screenshot request. Handler-only accounting had missed the rejection. Strict nested targets and a large union schema made invalid plans expensive; requested extractions disappeared after later failures, and generic timeouts prompted further inspection.

Full production MCP definitions were 11,800 bytes, not merely the 8,904 input/description bytes measured by the earlier discovery wrapper. That wrapper omitted output schemas and annotations which Codex receives in production. Final benchmarks preserve all discovery metadata and compare it against both actual servers in integration tests.

These are measured contributors, not an exact token decomposition: Codex does not report tokens by schema, argument, response, or internal inference. Smaller returned bytes alone never establish the saving.

## Optimization sequence, including regressions

| Stage                                                 | Direct total tokens | Ratatoskr total tokens | Interpretation                                                               |
| ----------------------------------------------------- | ------------------: | ---------------------: | ---------------------------------------------------------------------------- |
| Strict pre-optimization profile                       |              54,876 |                214,786 | Real regression; 8 Ratatoskr calls, one giant rejection                      |
| Native response forwarding only                       |              53,329 |                128,960 | Still worse; two invalid calls                                               |
| Compact plan, original discovery-oriented task        |              53,618 |                 63,461 | Still 18.4% worse; four calls                                                |
| Early large custom-baseline matrix pilot              |              70,607 |                 83,533 | Still worse; preserved in stages                                             |
| Source-known workflow plus bounded assertion evidence |                   — |                      — | Fresh paired pilots improved; full discovery metadata subsequently corrected |
| Production-metadata repeated matrix                   |           See below |              See below | Primary measured acceptance result                                           |

The first three rows share the canonical profile prompt but are single-pair diagnostics. The later matrix supplies identical source facts to both modes and increases real form complexity; do not treat pre-profile versus post-medium totals as a matched causal percentage. [Stages](stages.json) retain unfavorable rows and historical grading flags. The first repeated experiment is [archived separately](discovery-limited-repeat.json) because discovery metadata was incomplete; it is not the primary proof.

## Primary: ten pairs per scenario

Generated from [40 individual records](production-results.jsonl), with [raw completion usage and final verdicts](production-usage.json), [configuration and schema sizes](production-metadata.json), and [the complete generated summary](production-summary.md). Failed attempts are never removed from medians. All these primary attempts succeeded.

| Scenario            | Nominal steps | Direct median total | Ratatoskr median total | Difference (Rat − direct) | Reduction | Success / diagnosis, each mode |
| ------------------- | ------------: | ------------------: | ---------------------: | ------------------------: | --------: | -----------------------------: |
| Medium HTTP failure |            10 |              78,372 |               31,959.5 |                 −46,412.5 |     59.2% |                          10/10 |
| Large HTTP failure  |            20 |            94,542.5 |                 32,868 |                 −61,674.5 |     65.2% |                          10/10 |

| Scenario/mode    | Minimum | Maximum |     Mean | Population SD | Mean tool calls | Invalid calls, total |
| ---------------- | ------: | ------: | -------: | ------------: | --------------: | -------------------: |
| Medium/direct    |  62,433 |  92,255 |   78,558 |      11,511.1 |             9.3 |                    0 |
| Medium/Ratatoskr |  31,918 |  33,395 | 32,094.3 |         433.8 |               1 |                    0 |
| Large/direct     |  77,905 | 110,238 | 94,128.8 |      10,052.6 |              15 |                    0 |
| Large/Ratatoskr  |  32,583 |  34,270 |   33,125 |         579.8 |               1 |                    0 |

### Actual token accounting versus supporting bytes

Each cell below is an independent median; median components need not sum to median totals.

| Metric                                             | Medium direct | Medium Ratatoskr | Large direct | Large Ratatoskr |
| -------------------------------------------------- | ------------: | ---------------: | -----------: | --------------: |
| Input tokens                                       |      77,781.5 |         31,541.5 |     93,474.5 |        32,322.5 |
| Output tokens                                      |         702.5 |            417.5 |      1,033.5 |             525 |
| Cached input, subset                               |        65,856 |           20,224 |       77,504 |          28,288 |
| Uncached input                                     |        12,103 |         11,303.5 |       15,175 |           4,119 |
| Reasoning output, subset                           |         117.5 |                0 |        140.5 |               0 |
| Tool argument bytes                                |           619 |              715 |        1,351 |           1,323 |
| Model-visible reply bytes                          |         1,853 |              521 |      3,169.5 |             523 |
| Local raw evidence bytes, different capture scopes |       3,325.5 |              660 |      6,129.5 |             663 |

The medium plan arguments are **larger** than the baseline's arguments; bulk fill is a real baseline advantage. Ratatoskr wins on total measured tokens through the combined protocol and batching, not by claiming every supporting metric improved. Cache accounting also means total-token reduction is not equivalent to billing reduction; medium uncached input is much closer than total input.

## Boundary cases: three pairs each

These smaller samples are exploratory, not ten-run evidence. [All 30 boundary records](boundaries-results.jsonl), [native usage](boundaries-usage.json), and [generated distributions](boundaries-summary.md) are retained.

| Scenario                                    | Nominal steps | Direct median | Ratatoskr median | Reduction | Median calls, direct/Rat | Success, direct/Rat |
| ------------------------------------------- | ------------: | ------------: | ---------------: | --------: | -----------------------: | ------------------: |
| Tiny HTTP failure                           |             4 |        74,516 |           32,771 |     56.0% |                   10 / 1 |           3/3 / 3/3 |
| Small HTTP failure                          |             6 |        62,322 |           31,520 |     49.4% |                   10 / 1 |           3/3 / 3/3 |
| Medium real persistence                     |            10 |        77,597 |           31,967 |     58.8% |                   15 / 1 |           3/3 / 3/3 |
| Large real persistence                      |            20 |        79,671 |           33,013 |     58.6% |                   17 / 1 |           2/3 / 3/3 |
| Medium missing locator, before targeted fix |            10 |        61,274 |           56,279 |      8.2% |                    4 / 3 |           3/3 / 3/3 |

Every diagnosis was correct, but one large baseline persistence task took 25 calls, exceeding the stated 24-call budget. Auditing marks it unsuccessful and **retains its 95,457 tokens**; the original verdict/events are unchanged. The live cap now counts started MCP requests, including pre-handler rejections. One medium-success Ratatoskr task needed two workflows and consumed 43,158 tokens; it is not omitted. Mean Ratatoskr calls there are 1.33, not universally one.

No crossover was located in the tested samples: even the four-step failure case favors Ratatoskr. This does **not** locate a crossover for two-click successes or prove universal savings. Failure diagnosis adds model turns even to a tiny form. The nominal planned counts are not exact browser/API calls: successful workflows verify real persisted values across reload; failing workflows stop early. Forms contain 1/2/4/9 real changed fields, without padding.

## Measured locator bottleneck and focused remeasurement

The original locator sample used three Ratatoskr calls: workflow timeout → inspect steps → fetch screenshot. Its median model-visible evidence was about 29 KB, much of it requested image data. The server lacked the fact the model needed: whether Publish was absent versus merely disabled/covered.

One bounded existence probe now classifies an absent timed-out click target explicitly. It reads no page content, suggests no replacement, uses no LLM and adds no browser action/tool. A failed probe leaves the original failure intact. Three fresh pairs on commit `5b31edc` produced:

| Mode      | Median total tokens | Minimum–maximum | Median calls | Invalid calls | Success / diagnosis |
| --------- | ------------------: | --------------: | -----------: | ------------: | ------------------: |
| Direct    |              61,267 |   56,230–62,353 |            4 |             0 |                 3/3 |
| Ratatoskr |              31,896 |   31,893–32,002 |            1 |             0 |                 3/3 |

Paired median reduction: **47.9%**. Ratatoskr's median fell 43.3% versus the prior locator sample, with separate cohorts/caching—not a randomized attribution claim. No screenshot was requested; the real MCP failure payload was 347 bytes. See [all six new records](locator-repair-results.jsonl), [native usage](locator-repair-usage.json), and [generated summary](locator-repair-summary.md). This failure-only diagnostic does not change successful clicks or the primary HTTP-failure path.

## Smaller-schema custom baseline

The legacy `direct` harness has only 3,567 bytes of tool definitions versus Ratatoskr's 4,034. Three fresh pairs each still favor Ratatoskr: **79,355 → 31,952** median tokens for medium failures (59.7% reduction), **72,664 → 33,044** for large failures (54.5%). All outcomes/diagnoses are correct, with zero invalid calls and one Ratatoskr call. See [records](custom-results.jsonl) and [summary](custom-summary.md). It uses individual fills and uncompressed observations, so it is explicitly not labeled the standard baseline.

## Protocol, schema and repair changes

`src/mcp/wire-plan.ts` separates the model wire format from canonical execution. Flat inferred locators and short actions normalize into the existing strict Zod BrowserPlan. Safety remains internal; CLI JSON stays canonical. MCP omits public timeouts, continuation, evidence-size knobs and a separate output list. SDK input validation intentionally delegates semantic errors to application validation, avoiding huge union diagnostics before the handler.

| MCP tool             | Input schema before → after | Description before → after |     Full definition before → after |
| -------------------- | --------------------------: | -------------------------: | ---------------------------------: |
| run_browser_workflow |               7,498 → 1,276 |                  191 → 264 |                      9,565 → 2,013 |
| inspect_browser_run  |                   574 → 493 |                  111 → 121 |                      1,225 → 1,024 |
| get_browser_artifact |                   211 → 211 |                  127 → 114 |                        1,006 → 993 |
| Complete JSON array  |                           — |                          — | **11,800 → 4,034 (65.8% smaller)** |

Full definitions include output schemas and annotations, plus array punctuation. Descriptions intentionally grew overall to explain action semantics and output limits; reliability matters more than gaming the four-KB target. The observed 4,034 bytes are slightly above 4,000 and well below the tested 4,500-byte ceiling. The standard baseline's 17 definitions total 13,081 bytes; exact per-tool sizes are in metadata.

The recorded equivalent three-step canonical plan is **321 bytes (107/step)**; compact is **218 bytes (72.7/step)**, 32.1% smaller. These are serialized argument bytes, not tokens. The pre task generated 1,775 total argument bytes across retries; primary medium/large compact medians are 715/1,323 bytes across one call, for different form sizes. [Stages](stages.json) contain the full equivalent plan example.

A missing click locator now returns this entire MCP error in **187 serialized bytes**:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "{\"error\":\"INVALID_PLAN\",\"path\":\"steps[0]\",\"message\":\"Use exactly one locator: label, text, testId, css, or role (+name)\"}"
    }
  ]
}
```

Invalid inputs to all three tools are budgeted below **750 serialized bytes**, including hostile long strings, without raw union arrays, submitted secrets or stack traces. Pre rejection was 13,950 bytes. No invalid Ratatoskr calls occurred in the final 44 measured Ratatoskr tasks (20 primary, 15 boundary, 6 custom, 3 locator repair).

## Requested outputs and progressive disclosure

`extractText`/`extractAttribute` + `save` means explicitly request that output. Up to five unique identifiers, 200 characters each, redacted before truncation. Completed values return as MCP `values` on both success and later failure; unexecuted extractions do not produce fabricated empty values. Canonical CLI retains explicit `outputs`. Unit/MCP integration tests cover this, including long secrets and reserved identifier keys.

Success without outputs remains `success`/`runId`. Failure contains the failed step/reason, at most three correlated errors, optional bounded actual text and artifact IDs. Inspection defaults to ten items/category with shared hard bounds and truncation; screenshots/traces require explicit artifact retrieval. [A real medium run](representative-run.md) shows nine direct calls versus one Ratatoskr call and the actual failure payload. Screenshots stayed local in every primary workflow.

## Accounting and isolation

Each task starts a fresh `codex exec --json --ephemeral` process/thread in a neutral temporary directory with one canonical task, shared source facts and one approved local browser MCP. No setup, dependency install, repository exploration, development conversation or report generation is inside the measurement. Both modes use the same task/model/reasoning/state/accounting; order alternates. Each browser/fixture is fresh, with a 180-second task deadline and 24-tool-call cap. Concurrency two was recorded for these suites; default reproduction concurrency is one.

Authoritative fields are `turn.completed.usage.input_tokens`, `output_tokens`, `cached_input_tokens`, `reasoning_output_tokens`. In this version one completed user-task event cumulatively covers internal model/tool turns; it is not the last inference. Exactly one thread/task/completion is required. CLI supplies no `total_tokens`, so total is input plus output; a supplied total is validated against that sum. Cached input and reasoning output are subsets, never added twice. Uncached input is input minus cached input. Unknown optional metrics stay null. No byte conversion, tokenizer or fabricated inference count is used. Raw additional usage fields remain retained.

Terminal `item.completed` events measure all tool replies, including SDK validation, application errors, inspection, artifacts and transport failures. Replies are forwarded in native MCP shape, not embedded JSON strings. These payload bytes are supporting measurements, not a recreation of Codex's internal context encoding. Native totals measure the actual context cost. [Official Codex JSON-mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode) describes the machine-readable interface.

## Baseline definition and limitations

The primary baseline is official pinned `@playwright/mcp@0.0.83`, with 17 safe core tools including `browser_fill_form`, native output metadata and default observations. Arbitrary evaluation/code, installation, uploads and caller-supplied filesystem paths are excluded. Ratatoskr uses its actual production MCP server, normalizer, executor and reducer. Both run the same Chromium executable and viewport, with identical public form values and source facts. No fake browser observations, extra page padding, mandatory screenshots or shortened production evidence are introduced.

This does **not** measure Codex's built-in `browser_use` or unrestricted `browser_run_code`/evaluate batching. That could reduce direct round trips materially and needs a separately labeled future comparison. Actual source exploration is excluded in both modes: model-visible source facts are included. Results establish performance for known workflows, not autonomous website discovery. The final verdict grader checks evidence availability and fixture submission/persistence, not every possible contradictory narrative statement. The locator case validates opened page/absent-target diagnosis more directly than every individual fill. Browser operation and local raw-evidence metrics have differing capture scopes and are not used as the primary claim.

Codex exposes no per-inference usage or schema/result token attribution here; `modelCalls` stays null. Total tokens include cached context; billing discounts are not inferred. Remote model/caching behavior varies, and three-pair ancillary tests are not a robust crossover study. A failed startup with unavailable native usage is not assigned estimated tokens. Raw large artifacts/events remain in ignored local results; published numeric records, native completions and final verdicts retain every attempt. Development-only dependency audit has two moderate findings; production dependency audit had none, and no unrelated forced upgrade was attempted.

## Remaining highest-value bottlenecks

1. **Fixed task/context overhead:** successful one-call tasks still consume roughly 31–33K total tokens. We cannot attribute that floor exactly to Codex instructions versus schemas without per-inference instrumentation. One screenshot/inspection can reintroduce a full round trip; the measured locator case demonstrated this directly.
2. **Direct-baseline capability scope:** compare against an explicitly authorized code-capable or actual built-in browser configuration before making broader product claims. The current narrower comparison is reproducible, not universal.
3. **Workflow verification choices:** one medium-success task made two calls (43,158 tokens) despite zero invalid input. More ten-pair success/locator tests and truly two/three-action successes should determine the crossover.
4. **Arguments and safety trade-offs:** medium compact plans remain 715 bytes versus 619 baseline bytes; value references and repeated per-field assertions have unavoidable costs. Do not add unsafe fill literals or opaque programming merely to lower bytes.
5. **Diagnostics completeness:** nearby time-window evidence may miss asynchronous causes; screenshots can leak context and secrets drawn into images. Keep inspection explicit and bounded rather than returning a blanket snapshot.

## Reproduce and verify

Prerequisites: Node.js 22+, npm, Git, installed Chromium/OS libraries. Local tests/replay need no account or network after installation. Native benchmarks need Codex CLI, supported model access, network and `codex login`; ChatGPT login needs no separate API key. No database, cloud fixture or analytics service. Optional: Markdown viewer. Real tasks consume account usage.

```sh
npm ci
npx playwright install chromium
codex --version
codex login
npm test
npm run typecheck
npm run lint
npm run format:check
npm run test:e2e
npm run test:mcp
npm run test:benchmark

# One fresh pair; only medium, to control validation cost:
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=1 \
BENCHMARK_SCENARIOS=medium-http_failure BENCHMARK_SUITE=my-pilot npm run benchmark:tokens

# Primary ten pairs per case; choose a new suite ID:
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=10 \
BENCHMARK_SCENARIOS=medium-http_failure,large-http_failure \
BENCHMARK_SUITE=my-primary npm run benchmark:tokens

# All seven default cases, ten pairs each = 140 real model tasks:
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=10 \
BENCHMARK_SUITE=my-full-matrix npm run benchmark:tokens

# Optional alternative baseline (separate suite):
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_RUNS=3 BENCHMARK_BASELINES=direct \
BENCHMARK_SCENARIOS=medium-http_failure,large-http_failure \
BENCHMARK_SUITE=my-custom npm run benchmark:tokens

npm run benchmark:tokens:summary -- benchmarks/browser-evidence/results/my-primary/results.jsonl
npm run benchmark:tokens:audit -- benchmarks/browser-evidence/results/my-primary

# Regenerate the published primary summary with no model/browser:
npm run benchmark:tokens:summary -- benchmarks/browser-evidence/optimization/production-results.jsonl
```

Set `BENCHMARK_CODEX_REASONING_EFFORT` consistently if changing reasoning; keep the default medium for recorded comparisons. `BENCHMARK_CONCURRENCY=2` matches the recorded suites. Do not rebuild compiled server code during a live suite. Restart Codex after upgrading production MCP definitions; no registry/server rename or global configuration change occurred in this sprint.

## Changed areas and commits

Production changes are confined to compact MCP normalization/validation, bounded failure outputs and absent-click diagnosis. Canonical schema safety, CLI, stores, secrets and artifact boundaries remain intact. Benchmark changes add complete event accounting, native forwarding/discovery parity, standard baseline, fixture-size matrix, strict native usage/audits, published records and reproducibility tests. AGENTS/README/architecture explain source-guided one-call use.

The repository history contains coherent steps rather than one squash. The following list records implementation/data commits through publication; the final documentation commit follows this report in Git history. No commits were pushed automatically.

| Commit  | Subject / change                                                                    |
| ------- | ----------------------------------------------------------------------------------- |
| b909d7a | fix(bench): count all model-visible MCP responses and preserve baseline             |
| dfdad79 | fix(bench): forward native MCP results without nested serialization                 |
| 899c3a0 | feat(protocol): normalize compact MCP plans into strict browser plans               |
| 2354989 | fix(outputs): retain completed requested values on failed workflows                 |
| bc31659 | perf(mcp): expose compact plans and bounded validation repairs                      |
| 1155b99 | perf(codex): prioritize source-guided batched verification                          |
| 82da20d | test(bench): add standard MCP and source-known workflow token matrix                |
| 33c91db | fix(bench): grade native browser evidence and retain default observations           |
| a1d7fd3 | perf(protocol): repair assertion aliases and return bounded failure text            |
| 297007c | docs(protocol): explain compact MCP plans and bounded failure outputs               |
| 590be35 | fix(bench): preserve exact production MCP discovery metadata                        |
| ed1cee9 | fix(protocol): enforce repair budgets and safe bounded output identifiers           |
| b09dbea | feat(bench): report supporting token medians separately from evidence bytes         |
| 3748375 | test(bench): verify native discovery parity for both MCP servers                    |
| 6a02bb6 | docs(bench): preserve optimization stages and disclose comparison boundaries        |
| fde574a | fix(bench): distinguish invalid plans from runtime failures and audit native totals |
| 7dfb5b1 | test(bench): verify immutable audit provenance and missing scenario handling        |
| bdc3c61 | fix(bench): enforce native call budgets and remove obsolete timeout guidance        |
| 986faee | test(bench): publish reproducible ten-pair production token measurements            |
| 5b31edc | fix(executor): diagnose absent click targets without extra inspection               |
| f862269 | test(bench): publish boundary cases and measured locator optimization               |

Use `git log --oneline 1c944fb..HEAD` for the complete final list. One audit commit briefly included an unused-variable lint failure; the immediately following test commit corrected it. Final verification must pass unit tests, type checking, lint, formatting, browser tests, MCP tests and benchmark integration checks; the earlier failure is not concealed.
