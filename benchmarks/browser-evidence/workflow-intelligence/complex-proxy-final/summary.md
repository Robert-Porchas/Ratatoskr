# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.161.0; browser 153.0.8010.12; execution commit 75118445232e783208fa12946b315d7407e513b2; started 2026-10-08T00:56:18.882Z.

| Scenario | Planned steps | Baseline   | Mode      | Runs | Median total tokens |         Min–max |            Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| -------- | ------------: | ---------- | --------- | ---: | ------------------: | --------------: | -------------------: | -----------: | ------------: | ------: | --------: |
| complex  |            17 | playwright | baseline  |   10 |           159,287.5 | 132,747–207,012 | 168,492.3 ± 24,607.7 |         23.5 |             0 |    8/10 |      8/10 |
| complex  |            17 | playwright | ratatoskr |   10 |              33,671 |   33,625–59,628 |   36,272.4 ± 7,785.3 |            1 |             0 |   10/10 |     10/10 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario | Baseline   | Token difference (Rat − direct) | Percentage change |
| -------- | ---------- | ------------------------------: | ----------------: |
| complex  | playwright |                      -125,616.5 |            -78.9% |

## Supporting medians (tokens and bytes remain separate)

### complex / playwright

| Metric                                                  |  Baseline | Ratatoskr |
| ------------------------------------------------------- | --------: | --------: |
| Input tokens                                            | 158,417.5 |    33,195 |
| Output tokens                                           |     860.5 |       477 |
| Cached input tokens (subset)                            |   141,184 |    28,672 |
| Uncached input tokens                                   |  16,329.5 |     4,550 |
| Reasoning output tokens (subset)                        |      54.5 |         0 |
| Tool argument bytes                                     |       785 |       940 |
| Tool result / model evidence bytes                      |     4,621 |       145 |
| Locally retained evidence bytes (capture scope differs) |     7,714 |     1,579 |
| Browser operations (scope differs)                      |      23.5 |        18 |
| Failed MCP tool calls (includes valid runtime failures) |         2 |         0 |

Evidence-byte reduction: 96.9%. This is not token savings.

Generated compares manual versus CLI-derived plans using Ratatoskr in both modes. Other baselines use official Playwright MCP.
