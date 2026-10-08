# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.160.1; browser 153.0.8010.12; execution commit e6ca4b2628e983ca943dd9478c625390252c53f6; started 2026-10-07T23:27:22.434Z.

| Scenario       | Planned steps | Baseline   | Mode      | Runs | Median total tokens |       Min–max |  Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| -------------- | ------------: | ---------- | --------- | ---: | ------------------: | ------------: | ---------: | -----------: | ------------: | ------: | --------: |
| medium-success |            10 | playwright | baseline  |    1 |              90,090 | 90,090–90,090 | 90,090 ± 0 |           16 |             0 |     1/1 |       1/1 |
| medium-success |            10 | playwright | ratatoskr |    1 |              33,506 | 33,506–33,506 | 33,506 ± 0 |            1 |             0 |     1/1 |       1/1 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario       | Baseline   | Token difference (Rat − direct) | Percentage change |
| -------------- | ---------- | ------------------------------: | ----------------: |
| medium-success | playwright |                         -56,584 |            -62.8% |

## Supporting medians (tokens and bytes remain separate)

### medium-success / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   89,275 |    32,977 |
| Output tokens                                           |      815 |       529 |
| Cached input tokens (subset)                            |   71,552 |    11,264 |
| Uncached input tokens                                   |   17,723 |    21,713 |
| Reasoning output tokens (subset)                        |      141 |        58 |
| Tool argument bytes                                     |      850 |       715 |
| Tool result / model evidence bytes                      |    3,214 |       116 |
| Locally retained evidence bytes (capture scope differs) |    5,569 |       449 |
| Browser operations (scope differs)                      |       16 |        12 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 96.4%. This is not token savings.
