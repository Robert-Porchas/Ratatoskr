# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.160.1; browser 153.0.8010.12; execution commit a34c9cc3f328f645b2722c1b199828a2065f94c3; started 2026-10-07T23:46:07.344Z.

| Scenario       | Planned steps | Baseline   | Mode      | Runs | Median total tokens |         Min–max |   Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| -------------- | ------------: | ---------- | --------- | ---: | ------------------: | --------------: | ----------: | -----------: | ------------: | ------: | --------: |
| variables      |             6 | playwright | baseline  |    1 |              87,041 |   87,041–87,041 |  87,041 ± 0 |           10 |             0 |     1/1 |       1/1 |
| variables      |             6 | playwright | ratatoskr |    1 |              83,232 |   83,232–83,232 |  83,232 ± 0 |            4 |             1 |     1/1 |       1/1 |
| login-required |             6 | playwright | baseline  |    1 |              74,167 |   74,167–74,167 |  74,167 ± 0 |           10 |             0 |     1/1 |       1/1 |
| login-required |             6 | playwright | ratatoskr |    1 |              45,746 |   45,746–45,746 |  45,746 ± 0 |            2 |             0 |     1/1 |       1/1 |
| login-existing |             6 | playwright | baseline  |    1 |              73,249 |   73,249–73,249 |  73,249 ± 0 |            6 |             0 |     1/1 |       1/1 |
| login-existing |             6 | playwright | ratatoskr |    1 |              45,358 |   45,358–45,358 |  45,358 ± 0 |            2 |             0 |     1/1 |       1/1 |
| transient      |             2 | playwright | baseline  |    1 |              61,045 |   61,045–61,045 |  61,045 ± 0 |           10 |             0 |     1/1 |       1/1 |
| transient      |             2 | playwright | ratatoskr |    1 |              81,186 |   81,186–81,186 |  81,186 ± 0 |            4 |             2 |     0/1 |       0/1 |
| server-failure |             3 | playwright | baseline  |    1 |              87,892 |   87,892–87,892 |  87,892 ± 0 |            7 |             0 |     1/1 |       1/1 |
| server-failure |             3 | playwright | ratatoskr |    1 |              33,082 |   33,082–33,082 |  33,082 ± 0 |            1 |             0 |     1/1 |       1/1 |
| generated      |             6 | direct     | baseline  |    1 |              70,717 |   70,717–70,717 |  70,717 ± 0 |            4 |             2 |     1/1 |       1/1 |
| generated      |             6 | direct     | ratatoskr |    1 |              57,823 |   57,823–57,823 |  57,823 ± 0 |            3 |             1 |     1/1 |       1/1 |
| complex        |            17 | playwright | baseline  |    1 |             137,253 | 137,253–137,253 | 137,253 ± 0 |           23 |             0 |     1/1 |       1/1 |
| complex        |            17 | playwright | ratatoskr |    1 |             120,653 | 120,653–120,653 | 120,653 ± 0 |            8 |             1 |     0/1 |       0/1 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario       | Baseline   | Token difference (Rat − direct) | Percentage change |
| -------------- | ---------- | ------------------------------: | ----------------: |
| variables      | playwright |                          -3,809 |             -4.4% |
| login-required | playwright |                         -28,421 |            -38.3% |
| login-existing | playwright |                         -27,891 |            -38.1% |
| transient      | playwright |                          20,141 |               33% |
| server-failure | playwright |                         -54,810 |            -62.4% |
| generated      | direct     |                         -12,894 |            -18.2% |
| complex        | playwright |                         -16,600 |            -12.1% |

## Supporting medians (tokens and bytes remain separate)

### variables / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   86,632 |    82,367 |
| Output tokens                                           |      409 |       865 |
| Cached input tokens (subset)                            |   72,192 |    68,352 |
| Uncached input tokens                                   |   14,440 |    14,015 |
| Reasoning output tokens (subset)                        |        0 |        90 |
| Tool argument bytes                                     |      302 |     1,605 |
| Tool result / model evidence bytes                      |    1,887 |     2,598 |
| Locally retained evidence bytes (capture scope differs) |    3,121 |       456 |
| Browser operations (scope differs)                      |       10 |        10 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         1 |

Evidence-byte reduction: -37.7%. This is not token savings.

### login-required / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   73,759 |    45,357 |
| Output tokens                                           |      408 |       389 |
| Cached input tokens (subset)                            |   46,464 |    32,384 |
| Uncached input tokens                                   |   27,295 |    12,973 |
| Reasoning output tokens (subset)                        |        0 |        12 |
| Tool argument bytes                                     |      418 |       658 |
| Tool result / model evidence bytes                      |    2,055 |     2,391 |
| Locally retained evidence bytes (capture scope differs) |    3,419 |       614 |
| Browser operations (scope differs)                      |       10 |        10 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: -16.4%. This is not token savings.

### login-existing / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   72,970 |    45,008 |
| Output tokens                                           |      279 |       350 |
| Cached input tokens (subset)                            |   59,136 |    32,384 |
| Uncached input tokens                                   |   13,834 |    12,624 |
| Reasoning output tokens (subset)                        |        0 |         0 |
| Tool argument bytes                                     |      168 |       582 |
| Tool result / model evidence bytes                      |      980 |     1,505 |
| Locally retained evidence bytes (capture scope differs) |    1,722 |       351 |
| Browser operations (scope differs)                      |        6 |         5 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: -53.6%. This is not token savings.

### transient / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   60,660 |    80,544 |
| Output tokens                                           |      385 |       642 |
| Cached input tokens (subset)                            |   46,848 |    67,328 |
| Uncached input tokens                                   |   13,812 |    13,216 |
| Reasoning output tokens (subset)                        |       13 |        78 |
| Tool argument bytes                                     |      284 |       956 |
| Tool result / model evidence bytes                      |    1,303 |       443 |
| Locally retained evidence bytes (capture scope differs) |    2,574 |         0 |
| Browser operations (scope differs)                      |       10 |         0 |
| Failed MCP tool calls (includes valid runtime failures) |        3 |         4 |

Evidence-byte reduction: 66%. This is not token savings.

### server-failure / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   87,529 |    32,822 |
| Output tokens                                           |      363 |       260 |
| Cached input tokens (subset)                            |   73,088 |    28,672 |
| Uncached input tokens                                   |   14,441 |     4,150 |
| Reasoning output tokens (subset)                        |        0 |        13 |
| Tool argument bytes                                     |      162 |       302 |
| Tool result / model evidence bytes                      |    1,729 |       443 |
| Locally retained evidence bytes (capture scope differs) |    2,561 |       634 |
| Browser operations (scope differs)                      |        7 |         5 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 74.4%. This is not token savings.

### generated / direct

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   69,937 |    57,262 |
| Output tokens                                           |      780 |       561 |
| Cached input tokens (subset)                            |   56,448 |    44,288 |
| Uncached input tokens                                   |   13,489 |    12,974 |
| Reasoning output tokens (subset)                        |       61 |        23 |
| Tool argument bytes                                     |    1,628 |       978 |
| Tool result / model evidence bytes                      |      730 |       576 |
| Locally retained evidence bytes (capture scope differs) |      456 |       456 |
| Browser operations (scope differs)                      |        9 |         8 |
| Failed MCP tool calls (includes valid runtime failures) |        2 |         1 |

Evidence-byte reduction: 21.1%. This is not token savings.

### complex / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |  136,449 |   119,267 |
| Output tokens                                           |      804 |     1,386 |
| Cached input tokens (subset)                            |  119,040 |    89,984 |
| Uncached input tokens                                   |   17,409 |    29,283 |
| Reasoning output tokens (subset)                        |       27 |       165 |
| Tool argument bytes                                     |      778 |     2,519 |
| Tool result / model evidence bytes                      |    4,695 |    17,891 |
| Locally retained evidence bytes (capture scope differs) |    7,637 |     1,390 |
| Browser operations (scope differs)                      |       23 |        16 |
| Failed MCP tool calls (includes valid runtime failures) |        1 |         3 |

Evidence-byte reduction: -281.1%. This is not token savings.

Generated compares manual versus CLI-derived plans using Ratatoskr in both modes. Other baselines use official Playwright MCP.
