# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.161.0; browser 153.0.8010.12; execution commit e6ca4b2628e983ca943dd9478c625390252c53f6; started 2026-10-08T00:17:00.667Z.

| Scenario       | Planned steps | Baseline   | Mode      | Runs | Median total tokens |       Min–max |          Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| -------------- | ------------: | ---------- | --------- | ---: | ------------------: | ------------: | -----------------: | -----------: | ------------: | ------: | --------: |
| medium-success |            10 | playwright | baseline  |   10 |            77,712.5 | 63,254–94,248 | 80,858.9 ± 9,317.7 |           12 |             0 |   10/10 |     10/10 |
| medium-success |            10 | playwright | ratatoskr |   10 |            32,757.5 | 31,914–43,288 |     34,694 ± 4,338 |            1 |             0 |   10/10 |     10/10 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario       | Baseline   | Token difference (Rat − direct) | Percentage change |
| -------------- | ---------- | ------------------------------: | ----------------: |
| medium-success | playwright |                         -44,955 |            -57.8% |

## Supporting medians (tokens and bytes remain separate)

### medium-success / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            | 76,966.5 |    32,217 |
| Output tokens                                           |    749.5 |     534.5 |
| Cached input tokens (subset)                            |   65,664 |    28,032 |
| Uncached input tokens                                   |    9,525 |     4,043 |
| Reasoning output tokens (subset)                        |    115.5 |      60.5 |
| Tool argument bytes                                     |    840.5 |       715 |
| Tool result / model evidence bytes                      |    3,146 |       116 |
| Locally retained evidence bytes (capture scope differs) |    4,989 |       449 |
| Browser operations (scope differs)                      |       12 |        12 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 96.3%. This is not token savings.
