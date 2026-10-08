# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.161.0; browser 153.0.8010.12; execution commit 9bf0b4affa955aec169401e173c4216a6132a932; started 2026-10-08T00:39:38.657Z.

| Scenario | Planned steps | Baseline   | Mode      | Runs | Median total tokens |         Min–max |          Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| -------- | ------------: | ---------- | --------- | ---: | ------------------: | --------------: | -----------------: | -----------: | ------------: | ------: | --------: |
| complex  |            17 | playwright | baseline  |   10 |           156,278.5 | 132,787–205,824 | 160,227 ± 23,643.1 |           24 |             0 |    6/10 |      6/10 |
| complex  |            17 | playwright | ratatoskr |   10 |            33,657.5 |   33,639–33,707 |    33,663.1 ± 20.5 |            1 |             0 |   10/10 |     10/10 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario | Baseline   | Token difference (Rat − direct) | Percentage change |
| -------- | ---------- | ------------------------------: | ----------------: |
| complex  | playwright |                        -122,621 |            -78.5% |

## Supporting medians (tokens and bytes remain separate)

### complex / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |  155,405 |    33,185 |
| Output tokens                                           |    878.5 |     474.5 |
| Cached input tokens (subset)                            |  139,776 |    28,672 |
| Uncached input tokens                                   |   15,629 |     4,518 |
| Reasoning output tokens (subset)                        |     62.5 |         0 |
| Tool argument bytes                                     |      756 |       940 |
| Tool result / model evidence bytes                      |  4,494.5 |       145 |
| Locally retained evidence bytes (capture scope differs) |    7,460 |     1,579 |
| Browser operations (scope differs)                      |       24 |        18 |
| Failed MCP tool calls (includes valid runtime failures) |        2 |         0 |

Evidence-byte reduction: 96.8%. This is not token savings.

Generated compares manual versus CLI-derived plans using Ratatoskr in both modes. Other baselines use official Playwright MCP.
