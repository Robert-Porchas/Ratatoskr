# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.161.0; browser 153.0.8010.12; execution commit 9bf0b4affa955aec169401e173c4216a6132a932; started 2026-10-08T00:39:46.637Z.

| Scenario      | Planned steps | Baseline   | Mode      | Runs | Median total tokens |       Min–max |          Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| ------------- | ------------: | ---------- | --------- | ---: | ------------------: | ------------: | -----------------: | -----------: | ------------: | ------: | --------: |
| large-success |            20 | playwright | baseline  |   10 |              86,964 | 76,097–96,173 | 87,109.6 ± 8,164.1 |           16 |             0 |   10/10 |     10/10 |
| large-success |            20 | playwright | ratatoskr |   10 |              36,055 | 34,480–46,974 | 37,988.2 ± 4,694.5 |            1 |             0 |   10/10 |     10/10 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario      | Baseline   | Token difference (Rat − direct) | Percentage change |
| ------------- | ---------- | ------------------------------: | ----------------: |
| large-success | playwright |                         -50,909 |            -58.5% |

## Supporting medians (tokens and bytes remain separate)

### large-success / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            | 85,987.5 |    35,537 |
| Output tokens                                           |    1,007 |       571 |
| Cached input tokens (subset)                            |   71,232 |    30,016 |
| Uncached input tokens                                   |  8,897.5 |   5,156.5 |
| Reasoning output tokens (subset)                        |    139.5 |        42 |
| Tool argument bytes                                     |  1,350.5 |     1,323 |
| Tool result / model evidence bytes                      |  2,826.5 |       116 |
| Locally retained evidence bytes (capture scope differs) |    5,659 |       451 |
| Browser operations (scope differs)                      |       16 |        22 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 95.9%. This is not token savings.
