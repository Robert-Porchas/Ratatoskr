# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.161.0; browser 153.0.8010.12; execution commit 192d454d26a9dc4f88e795fe37bebeb83c4f7a4e; started 2026-10-08T00:06:44.280Z.

| Scenario           | Planned steps | Baseline   | Mode      | Runs | Median total tokens |       Min–max |          Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| ------------------ | ------------: | ---------- | --------- | ---: | ------------------: | ------------: | -----------------: | -----------: | ------------: | ------: | --------: |
| tiny-http_failure  |             4 | playwright | baseline  |   10 |            76,168.5 | 61,951–90,566 | 77,193.3 ± 9,618.1 |           10 |             0 |   10/10 |     10/10 |
| tiny-http_failure  |             4 | playwright | ratatoskr |   10 |            33,133.5 | 33,068–36,303 |   33,451.3 ± 952.6 |            1 |             0 |   10/10 |     10/10 |
| small-http_failure |             6 | playwright | baseline  |   10 |              76,709 | 71,842–91,074 | 80,991.7 ± 7,600.1 |         10.5 |             0 |   10/10 |     10/10 |
| small-http_failure |             6 | playwright | ratatoskr |   10 |              33,323 | 33,283–36,577 | 33,960.8 ± 1,298.7 |            1 |             0 |   10/10 |     10/10 |
| medium-success     |            10 | playwright | baseline  |   10 |              77,411 | 62,701–91,588 | 77,823.4 ± 8,019.3 |           12 |             0 |   10/10 |     10/10 |
| medium-success     |            10 | playwright | ratatoskr |   10 |            33,770.5 | 33,670–45,888 | 35,911.4 ± 3,626.5 |            1 |             0 |   10/10 |     10/10 |
| large-success      |            20 | playwright | baseline  |   10 |                 N/A |           N/A |                N/A |           18 |             0 |    7/10 |      7/10 |
| large-success      |            20 | playwright | ratatoskr |   10 |              34,571 | 34,537–46,988 | 37,716.4 ± 4,810.7 |            1 |             0 |   10/10 |     10/10 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario           | Baseline   | Token difference (Rat − direct) | Percentage change |
| ------------------ | ---------- | ------------------------------: | ----------------: |
| tiny-http_failure  | playwright |                         -43,035 |            -56.5% |
| small-http_failure | playwright |                         -43,386 |            -56.6% |
| medium-success     | playwright |                       -43,640.5 |            -56.4% |
| large-success      | playwright |                             N/A |               N/A |

## Supporting medians (tokens and bytes remain separate)

### tiny-http_failure / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            | 75,600.5 |    32,822 |
| Output tokens                                           |      605 |       307 |
| Cached input tokens (subset)                            |   60,416 |    24,640 |
| Uncached input tokens                                   |   14,729 |   8,989.5 |
| Reasoning output tokens (subset)                        |       61 |         0 |
| Tool argument bytes                                     |      379 |       335 |
| Tool result / model evidence bytes                      |  1,880.5 |       513 |
| Locally retained evidence bytes (capture scope differs) |    3,251 |       660 |
| Browser operations (scope differs)                      |       10 |         4 |
| Failed MCP tool calls (includes valid runtime failures) |        2 |         0 |

Evidence-byte reduction: 72.7%. This is not token savings.

### small-http_failure / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            | 76,066.5 |    32,981 |
| Output tokens                                           |    714.5 |     334.5 |
| Cached input tokens (subset)                            |   68,416 |    21,632 |
| Uncached input tokens                                   |    8,484 |    12,104 |
| Reasoning output tokens (subset)                        |      108 |         0 |
| Tool argument bytes                                     |      536 |       470 |
| Tool result / model evidence bytes                      |    2,209 |       513 |
| Locally retained evidence bytes (capture scope differs) |  3,904.5 |       660 |
| Browser operations (scope differs)                      |     10.5 |         5 |
| Failed MCP tool calls (includes valid runtime failures) |        3 |         0 |

Evidence-byte reduction: 76.8%. This is not token savings.

### medium-success / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            | 76,635.5 |    33,270 |
| Output tokens                                           |      754 |       506 |
| Cached input tokens (subset)                            |   68,992 |    28,928 |
| Uncached input tokens                                   |  8,742.5 |     5,359 |
| Reasoning output tokens (subset)                        |       67 |      53.5 |
| Tool argument bytes                                     |      785 |       715 |
| Tool result / model evidence bytes                      |  2,137.5 |       116 |
| Locally retained evidence bytes (capture scope differs) |  4,016.5 |       449 |
| Browser operations (scope differs)                      |       12 |        12 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 94.6%. This is not token savings.

### large-success / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |      N/A |  33,992.5 |
| Output tokens                                           |      N/A |     586.5 |
| Cached input tokens (subset)                            |      N/A |    29,184 |
| Uncached input tokens                                   |      N/A |   5,176.5 |
| Reasoning output tokens (subset)                        |      N/A |      52.5 |
| Tool argument bytes                                     |    1,480 |     1,323 |
| Tool result / model evidence bytes                      |    4,756 |       116 |
| Locally retained evidence bytes (capture scope differs) |    7,790 |       451 |
| Browser operations (scope differs)                      |       18 |        22 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 97.6%. This is not token savings.
