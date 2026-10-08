# Workflow intelligence and resilience measurements

This milestone keeps Codex as the planner. Repository/test knowledge becomes a compact plan; Ratatoskr normalizes and validates it, executes bounded local control flow through Playwright, then reduces evidence. There is no local model, autonomous exploration, expression evaluator, loop or arbitrary code action.

## Architecture and policy

| Area             | Implemented behavior                                                                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Variables        | Per-run string map, 20 names, 1,000 characters/value, unique names matching `^[A-Za-z_][A-Za-z0-9_]{0,63}$`; extracted text/attributes and optional canonical non-secret parameters                               |
| Interpolation    | Single `${name}` substitution immediately before a step; 2,048 characters/field; inserted templates are not evaluated again                                                                                       |
| Allowed fields   | Navigation URL, text/URL `contains`, semantic locator name/label/text/test ID, fill value, select value/label                                                                                                     |
| Forbidden fields | Start URL, actions, roles, CSS, attribute names, variable/reference names, key sequences, filenames/paths and configuration                                                                                       |
| Secrets          | `valueRef` resolves through the existing local resolver/allowlist, separately from workflow variables; saves cannot shadow used secret references; known values are redacted before persistence/output truncation |
| Outputs          | Every compact `save` returns explicitly requested data: five names, 200 characters each, including on later failure; canonical `saveAs` can remain local unless listed in `outputs`                               |
| Predicates       | Visibility, URL contains, variable exists, variable equals; optional negation and else; maximum branch depth two; visibility observes for 250 ms                                                                  |
| Plan bounds      | 300 nodes counting both branches; iterative structural checks before recursive schema validation                                                                                                                  |
| Execution bounds | 360 executed nodes/attempts/reloads, 60 retries, 180-second default deadline; canonical CLI override up to 600 seconds                                                                                            |
| Retry            | `retry:1..3` means total attempts, above Playwright auto-wait; 250/500 ms delay between ordinary retries                                                                                                          |
| Default retry    | One retry only for recognized transient GET-navigation transport errors, including interrupted navigation; ordinary navigation timeout needs an explicit policy                                                   |
| Explicit retry   | Navigation, waits, hover, extraction; click readiness only before dispatch, using a trial actionability check                                                                                                     |
| No replay        | Assertions, observed HTTP 400/401/403/500 (all >=400), deterministic errors, form mutations, uploads/downloads, dialog/popup clicks or uncertain side effects                                                     |
| Recovery         | `reloadOnce`, only a wait/extraction with exactly two attempts and a GET document; POST document reload is refused; no arbitrary recovery workflow or inferred renavigation                                       |
| Uncertainty      | A retry-enabled click that may have dispatched fails with `side_effect_state_unknown`; it is not replayed                                                                                                         |
| Validation       | Missing variables, malformed/forbidden templates, duplicate saves, secret-name collision, branch dataflow/depth, step count and incompatible/excess retry policies fail before browser startup where possible     |
| Diagnostics      | Local timestamped branch decisions and attempt/retry/recovery/variable-name metadata; no variable values in traces; successful results omit histories; existing bounded `steps` inspection is sufficient          |

Navigation is revalidated after interpolation as credential-free HTTP(S); upload/artifact boundaries remain unchanged. GET safety depends on the application respecting HTTP semantics. Redaction protects known values, not unknown/canvas/image secrets. URL observations/assertions omit queries and fragments. Visibility is a bounded observation, not proof that a page is ready. Diagnostic captures and cleanup can add time beyond the execution deadline. See [architecture](../../../docs/architecture.md) for the detailed design.

## Workflow generation

`ratatoskr derive-workflow <test.ts> --base-url <URL>` uses TypeScript syntax parsing without executing source or following imports. It emits the existing compact syntax, validates through the normalizer/canonical schema, and reports readiness, converted step count and bounded location/reason warnings. Malformed syntax is rejected, including code that TypeScript's parser could otherwise recover. Limits: 256 KB source, ten tests, 25 warnings/test and 64 KB output. CLI exits nonzero for incomplete conversion. TypeScript is a CLI runtime dependency and is not imported by MCP.

Supported: awaited sequential literal `page.goto`, `getByRole` with literal name, `getByLabel`, `getByText`, `getByTestId`, zero-option click, `fill(process.env.NAME)` including a non-null assertion, `toBeVisible`, and literal `toContainText`. Literal `toHaveURL` emits a weaker contains assertion with a warning and `ready:false`. Loops, hooks, arbitrary runtime code, declarations, dynamic arguments, page objects, regex URL assertions and complex locators/action options need planner review. Unsupported code stops at a validated prefix. Semantic locators use Ratatoskr's exact matching; review tests relying on partial name/text matching. Readiness indicates supported conversion and validation, not proof of application behavior.

The repository has a fixture-backed sequential [Playwright source example](../../../examples/project.spec.ts) used by both the generation integration test and native comparison. The generation comparison uses Ratatoskr in **both** modes: manual translation of that source versus a validated CLI-derived artifact. It is not a direct-browser comparison and does not measure a separate Codex shell invocation to run the CLI. No repository index or generation MCP tool was added: source search is already available to Codex.

## Measurement methodology

The main suite uses `gpt-6.1-sol`, medium reasoning, fresh isolated Codex CLI 0.161.0 tasks, Chromium 153.0.8010.12 and pinned official Playwright MCP 0.0.83. Each of seven scenarios has ten tasks per mode. Ordering alternates by run; concurrency is two within each suite. Both modes receive the same fixture, task and source facts. The established harness disables unrelated tools, repository instructions and plugins/skills; these measurements exclude repository discovery and installed-skill overhead. Saved values, branch outcomes, reload counts and mutation counts are audited locally; diagnostic reports are graded separately. The production MCP executor, normalizer and reducer run without benchmark-specific reductions.

Authoritative tokens come from native `turn.completed.usage`, including cached input. Cached input and reasoning output are subsets, not additions. No byte/token conversion or per-inference estimate is used. Token distributions include unsuccessful tasks. Browser-operation counts include assertions and retries but exclude local branch decisions; direct Playwright calls and Ratatoskr primitive counts have different granularity. Argument/result bytes are measured from terminal MCP events, including invalid calls and returned image payloads.

The final legacy suite repeats ten tasks/mode on tiny/small HTTP failures and medium/large successes with the established prompts. The original representative [pre-change sample](pre/summary.md) remains intact; it used CLI 0.160.1. A controlled medium repeat uses the original `e6ca4b2` implementation with CLI 0.161.0 to assess added schema overhead. The [unfavorable pilot](pilot/summary.md) retains both failed Ratatoskr tasks: fixture-scope restrictions incorrectly blocked recovery, and an application reload interrupted navigation. The corrections were made before the final suite, without changing production evidence reduction to favor measurement.

Optional-login strict grading asks Codex to name the POST when the hidden login branch executes. A compact successful result deliberately does not disclose that branch. We retain those strict report-path failures and also report audited execution separately; we do not fetch traces to make a successful task's grade look better. Diagnostic correctness on deterministic HTTP failures still requires the actual status/code/method/path and exactly one submission.

The initial full-flow and large groups hit the established 24-call cap, leaving five and three tasks without authoritative token totals. Those entire groups retain unavailable token distributions; incomplete tasks are never filtered out. A first extended comparison raised the runner cap to 40 but exposed a separate proxy cap still fixed at 24. Its four full-flow failures are preserved in `complex-final/`. The correction passes the requested cap to both layers, records both, and has a real MCP integration test permitting call 25 and rejecting call 26 at a configured cap of 25. The subsequent `complex-proxy-final/` comparison uses matching caps of 40 in fresh tasks on committed `7511844`. The separate large repeat in `large-final/` completes all tasks under its effective 24-call proxy limit, with no cap error; its configuration records the original requested runner cap of 40. Each comparison's two modes share a commit/configuration; the preserved earlier suite and subsequent repeats are not pooled.

## Repeated native results

Each row uses ten fresh tasks per mode. Tokens are medians of all tasks, including failures. Baseline is direct Playwright except `generated`, whose baseline is manual Ratatoskr translation. The first six scenarios come from `final/`; full flow uses the corrected-cap `complex-proxy-final/` repeat. Execution success excludes only the separately reported diagnosis-path requirement.

| Scenario       | Baseline tokens | Ratatoskr tokens | Reduction | Calls baseline → Rat | Execution baseline / Rat | Strict diagnosis baseline / Rat |
| -------------- | --------------: | ---------------: | --------: | -------------------: | ------------------------ | ------------------------------- |
| variables      |          86,603 |           33,155 |    61.72% |                7 → 1 | 10/10 / 10/10            | 10/10 / 10/10                   |
| login-required |          73,724 |         33,301.5 |    54.83% |                6 → 1 | 10/10 / 10/10            | 10/10 / 4/10                    |
| login-existing |          73,128 |           33,373 |    54.36% |                5 → 1 | 10/10 / 10/10            | 10/10 / 5/10                    |
| transient      |        60,974.5 |         33,025.5 |    45.84% |                8 → 1 | 10/10 / 10/10            | 10/10 / 10/10                   |
| server-failure |          81,362 |         33,245.5 |    59.14% |                7 → 1 | 10/10 / 10/10            | 10/10 / 10/10                   |
| generated      |          33,360 |         33,350.5 |     0.03% |                1 → 1 | 10/10 / 10/10            | 10/10 / 10/10                   |
| complex        |       159,287.5 |           33,671 |    78.86% |             23.5 → 1 | 8/10 / 10/10             | 8/10 / 10/10                    |

### Token components

Cached input and reasoning are already included in input/output totals. Component medians need not sum to median total.

| Scenario       | Mode      |     Input | Cached input | Non-cached input | Output | Reasoning |     Total |
| -------------- | --------- | --------: | -----------: | ---------------: | -----: | --------: | --------: |
| variables      | baseline  |    86,276 |       69,504 |           14,340 |    343 |         0 |    86,603 |
| variables      | ratatoskr |    32,868 |       20,864 |           11,990 |    294 |         0 |    33,155 |
| login-required | baseline  |    73,407 |       59,456 |           13,989 |    319 |         0 |    73,724 |
| login-required | ratatoskr |    32,882 |       28,672 |          4,248.5 |  443.5 |     175.5 |  33,301.5 |
| login-existing | baseline  |    72,858 |       54,464 |          5,998.5 |    270 |      15.5 |    73,128 |
| login-existing | ratatoskr |    32,858 |       28,672 |            4,201 |    506 |     200.5 |    33,373 |
| transient      | baseline  |  60,635.5 |       54,656 |            6,456 |    342 |      11.5 |  60,974.5 |
| transient      | ratatoskr |  32,831.5 |       28,672 |            4,165 |  192.5 |         0 |  33,025.5 |
| server-failure | baseline  |    81,009 |       69,760 |            6,880 |    353 |         0 |    81,362 |
| server-failure | ratatoskr |    32,964 |       28,672 |          4,310.5 |  277.5 |         0 |  33,245.5 |
| generated      | baseline  |    33,126 |       28,928 |          4,219.5 |    237 |         0 |    33,360 |
| generated      | ratatoskr |    33,114 |       28,928 |            4,186 |  236.5 |         0 |  33,350.5 |
| complex        | baseline  | 158,417.5 |      141,184 |         16,329.5 |  860.5 |      54.5 | 159,287.5 |
| complex        | ratatoskr |    33,195 |       28,672 |            4,550 |    477 |         0 |    33,671 |

### Calls, actions and bytes

Actions, calls, argument/result bytes are medians; invalid and inspection counts are totals over ten tasks. Browser actions count direct calls versus Ratatoskr primitive attempts/reloads (different granularity). Branches are local and omitted from browser-action counts. Neither byte column is a token estimate.

| Scenario       | Mode      | Browser actions | Workflow MCP calls | Direct calls | Invalid total | Inspections total | Argument bytes | Result bytes |
| -------------- | --------- | --------------: | -----------------: | -----------: | ------------: | ----------------: | -------------: | -----------: |
| variables      | baseline  |               7 |                  0 |            7 |             0 |                 0 |            184 |        1,454 |
| variables      | ratatoskr |               7 |                  1 |            0 |             0 |                 0 |            402 |          145 |
| login-required | baseline  |               6 |                  0 |            6 |             0 |                 0 |            303 |        1,356 |
| login-required | ratatoskr |             6.5 |                  1 |            0 |             1 |                 0 |            438 |        134.5 |
| login-existing | baseline  |               5 |                  0 |            5 |             0 |                 0 |            147 |          731 |
| login-existing | ratatoskr |               3 |                  1 |            0 |             1 |                 0 |            388 |          116 |
| transient      | baseline  |               8 |                  0 |            8 |             0 |                 0 |            219 |        1,163 |
| transient      | ratatoskr |               5 |                  1 |            0 |             0 |                 0 |            156 |          116 |
| server-failure | baseline  |               7 |                  0 |            7 |             0 |                 0 |            154 |        1,685 |
| server-failure | ratatoskr |               5 |                  1 |            0 |             0 |                 0 |            358 |          449 |
| generated      | baseline  |               5 |                  1 |            0 |             0 |                 0 |            257 |          116 |
| generated      | ratatoskr |               5 |                  1 |            0 |             0 |                 0 |            257 |          116 |
| complex        | baseline  |            23.5 |                  0 |         23.5 |             0 |                 0 |            785 |        4,621 |
| complex        | ratatoskr |              18 |                  1 |            0 |             0 |                 0 |            940 |          145 |

Full per-metric median, mean, min, max and population standard deviation are in [primary distributions](final/distributions.json), [full-flow distributions](complex-proxy-final/distributions.json), and [large-repeat distributions](large-final/distributions.json). The corresponding `results.jsonl`, `native-usage.jsonl`, `calls.jsonl` and `configuration.json` preserve every count and audit criterion. [Primary summary](final/summary.md), [full-flow summary](complex-proxy-final/summary.md) and [large summary](large-final/summary.md) include total-token ranges and mean ± SD.

Variables propagate generated IDs locally: 7 direct calls become one workflow, including navigation using the ID. Both login states execute correctly in all ten tasks per mode. Ratatoskr has one invalid-plan repair in each login group; strict report-path accuracy is only 4/10 and 5/10 because the successful response hides which branch ran. That diagnostic limitation is retained, separate from correct authentication execution. A caller needing the branch in its final report should explicitly request bounded non-secret output or inspect it, accepting that cost.

Transient recovery succeeds locally in all ten tasks. The deterministic 500 case makes exactly one create POST per task and diagnoses the status/code/method/path correctly in both modes; it is never replayed. Successful recovery/branch histories are not automatically returned.

Generation is **approximately token-neutral**: 33,360 manual versus 33,350.5 derived median tokens, identical 257-byte median arguments, one call and first-attempt success 10/10 in both modes, with no invalid calls. This small fixture does not demonstrate the requested meaningful construction-cost reduction. The converter remains optional and adds no MCP tool/schema cost. Ten separate local CLI invocations take a median 748 ms (723–850 ms), producing 357 bytes from a 403-byte source; [timing samples](generation-timing.json) include process startup and syntax validation. These local timings are not Codex tokens and were not an isolated runtime comparison.

### Before/after overhead, preserved failures and crossover

| Repeated legacy scenario | Direct median tokens | Ratatoskr median tokens | Reduction | Calls direct → Rat | Strict success direct / Rat |
| ------------------------ | -------------------: | ----------------------: | --------: | -----------------: | --------------------------- |
| tiny-http_failure        |             76,168.5 |                33,133.5 |    56.50% |             10 → 1 | 10/10 / 10/10               |
| small-http_failure       |               76,709 |                  33,323 |    56.56% |           10.5 → 1 | 10/10 / 10/10               |
| medium-success           |               77,411 |                33,770.5 |    56.38% |             12 → 1 | 10/10 / 10/10               |
| large-success            |               86,964 |                  36,055 |    58.54% |             16 → 1 | 10/10 / 10/10               |

The controlled old medium workflow uses 32,757.5 Ratatoskr tokens versus 33,770.5 after this milestone: **+3.1%**, with one call in both. Direct medians are 77,712.5 before and 77,411 after. The unchanged medium workflow therefore retains a 56.4% direct-browser advantage, but added features have a measurable static-plan cost. Complete MCP definitions grow from **4,144 to 4,869 bytes (+17.5%)**; workflow input schema grows 1,276 → 1,874 bytes and description 264 → 391 bytes. The three-tool surface is unchanged. There is no evidence of a new universal crossover point: all tested four-step-and-larger legacy cases remain cheaper, but fewer-than-four-step cases and unrestricted JavaScript-capable browser tools were not measured.

The original main full-flow comparison has unavailable direct token distributions (five capped tasks) and median three Ratatoskr calls due to competing navigation. The navigation fix moves that recovery into the executor. The original large group has unavailable direct distributions (three capped tasks). The first extended full-flow comparison retains 6/10 direct successes and 10/10 Ratatoskr successes; its proxy still capped at 24. The corrected-cap repeat is reported above, including its actual application-level failures. No unsuccessful task was dropped and no incomplete group was assigned an estimated median. The complete large repeat has all ten successes in each mode, with two total Ratatoskr inspections retained.

The corrected full flow uses **159,287.5 direct versus 33,671 Ratatoskr median tokens (78.9% lower)**, with 23.5 versus one median calls. Ratatoskr succeeds in 10/10 tasks, using one call in 9/10; the remaining task initially extracts a nonexistent `value` attribute, then repairs its plan across three workflows. Those assertion failures are intentionally not retried. Direct succeeds in 8/10; both failures target a nonexistent `textarea` and submit an empty description. All twenty tasks make exactly one create POST and one details POST. No call-cap failure occurs; all native totals are available, and no invalid or inspection calls occur. Ratatoskr mean total is 36,272.4 (SD 7,785.3, range 33,625–59,628), versus direct 168,492.3 (SD 24,607.7, range 132,747–207,012). Local median workflow time is 5,908 ms. The [control-flow count audit](complex-proxy-final/control-flow-audit.json) records ten reload recoveries and nine interrupted-navigation retries, alongside branch and variable creation counts, without variable values.

Across all preserved publications there are 316 fresh tasks, including the original sample, pilot, controlled before/after studies and separate repeats. Eight tasks lack authoritative totals; their affected group distributions remain unavailable rather than estimated.

### Runtime and verification

Primary median local workflow durations: variables 441 ms, login required 613 ms, already authenticated 283 ms, transient recovery 5,384 ms, deterministic failure 5,440 ms. The five-second waits use existing Playwright actionability/timeouts; recovery does not add a model round trip. Conditional visibility observes at most 250 ms; ordinary retry delays are 250/500 ms. Full-flow and legacy local timings are available in their call distributions. Native task duration includes model/tool transport time and is not an isolated measure of executor overhead. The overall execution deadline stops browser work; best-effort diagnostic capture and teardown happen afterward.

Final verification passed: 118 unit tests in 25 files; browser E2E and real stdio MCP tests; session capture/redaction tests; all seven advanced workflow fixtures; real-browser retry bounds, POST-reload refusal and uncertain-click non-replay; benchmark fixture/transport tests and the actual proxy budget test; type checking, linting, formatting, build and package/plugin audit; isolated doctor/smoke; and offline replay. `npm run test:install` passed on committed `7511844` in a fresh clone with isolated dependencies, downloaded browser, runtime/data and Codex configuration, including 117 then-committed unit tests and plugin/manual-MCP discovery. The final additional unit test audits the new twenty-task count publication; runtime code/package dependencies are unchanged by this report commit. Native comparison commands completed with all failures retained; the full-flow benchmark exits nonzero for its two audited direct-task failures, which is separate from the passing software checks.

## Reproduction

Use the recorded model/CLI/browser/dependency versions and a fresh unique suite name. Native tasks require Codex login and consume account usage. Raw task/event/fixture evidence stays in ignored `results/`; publication contains verified counts only, without tool bodies, credentials, browser artifacts or thread IDs.

```sh
npm ci
npm run setup
npm test
npm run test:e2e
npm run test:mcp
npm run test:session
npm run test:workflow
npm run test:benchmark
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:dist
npm run doctor
npm run smoke
npm run test:install
BENCHMARK_RUNS=1 npm run benchmark:browser
mkdir -p benchmarks/browser-evidence/results
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_CODEX_REASONING_EFFORT=medium BENCHMARK_RUNS=10 BENCHMARK_CONCURRENCY=2 BENCHMARK_SUITE=workflow-repeat npm run benchmark:workflow
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_CODEX_REASONING_EFFORT=medium BENCHMARK_RUNS=10 BENCHMARK_CONCURRENCY=2 BENCHMARK_SCENARIOS=tiny-http_failure,small-http_failure,medium-success,large-success BENCHMARK_SUITE=workflow-legacy-repeat npm run benchmark:tokens
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_CODEX_REASONING_EFFORT=medium BENCHMARK_RUNS=10 BENCHMARK_CONCURRENCY=2 BENCHMARK_WORKFLOWS=complex BENCHMARK_MAX_TOOL_CALLS=40 BENCHMARK_SUITE=workflow-complex-repeat npm run benchmark:workflow
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_CODEX_REASONING_EFFORT=medium BENCHMARK_RUNS=10 BENCHMARK_CONCURRENCY=2 BENCHMARK_SCENARIOS=large-success BENCHMARK_MAX_TOOL_CALLS=40 BENCHMARK_SUITE=workflow-large-repeat npm run benchmark:tokens
npm run benchmark:workflow:publish -- benchmarks/browser-evidence/results/workflow-repeat repeat
npm run benchmark:workflow:publish -- benchmarks/browser-evidence/results/workflow-legacy-repeat legacy-repeat --legacy
npm run benchmark:workflow:publish -- benchmarks/browser-evidence/results/workflow-complex-repeat complex-repeat
npm run benchmark:workflow:publish -- benchmarks/browser-evidence/results/workflow-large-repeat large-repeat --legacy
```

To reproduce the controlled pre-change repeat without altering current files:

```sh
git worktree add --detach /tmp/ratatoskr-workflow-before e6ca4b2
ln -s "$PWD/node_modules" /tmp/ratatoskr-workflow-before/node_modules
cd /tmp/ratatoskr-workflow-before
mkdir -p benchmarks/browser-evidence/results
BENCHMARK_MODEL=gpt-6.1-sol BENCHMARK_CODEX_REASONING_EFFORT=medium BENCHMARK_RUNS=10 BENCHMARK_CONCURRENCY=2 BENCHMARK_SCENARIOS=medium-success BENCHMARK_SUITE=controlled-before npm run benchmark:tokens
```

CLI conversion: `npm run cli -- derive-workflow examples/project.spec.ts --base-url http://127.0.0.1:3000`.

## Implementation commits

- `264c898` — runtime variables and interpolation.
- `a34c9cc` — bounded branches and control-flow validation.
- `4a3e053` — conservative retry/recovery and budgets.
- `8419308` — sequential Playwright conversion.
- `15ad7e1` — recovery budget and interrupted GET navigation.
- `1ced173` — preserve non-secret saved outputs reused in fills.
- `709ef65` — architecture, README and planner guidance.
- `192d454` — native workflow matrix and original pre-change counts.
- `c5cc26d` — browser replay safety, all predicates/budgets, native accounting publication and preserved pilot.
- `d211f53` — competing navigation recovery, initial-navigation diagnostics and late browser-start cleanup.
- `9bf0b4a` — preserved primary/legacy/controlled counts and extended comparison settings.
- `34243d0` — reject malformed test syntax rather than emit parser-recovered plans.
- `7511844` — synchronize actual proxy/runner caps, integration-test the cap, preserve extended comparisons.
- This report's commit — audited full-flow count publication, reproduction commands and final verification.

## Evidence-based conclusion

**A. The new workflow capabilities reduce total Codex token usage while improving workflow coverage.** Native repeated variable propagation, transient recovery and full-flow comparisons demonstrate fewer model/browser round trips and lower token totals against the scoped direct baseline. Ratatoskr remains a deterministic executor with no planning model. This conclusion does not imply every feature saves tokens: the tested converter is token-neutral, unchanged medium workflows incur 3.1% added token overhead, and hidden successful branches limit report-path accuracy unless explicitly requested. No universal crossover or comparison with unrestricted code-capable browser tooling is established.
