# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.161.0; browser 153.0.8010.12; execution commit 192d454d26a9dc4f88e795fe37bebeb83c4f7a4e; started 2026-10-08T00:06:15.646Z.

| Scenario       | Planned steps | Baseline   | Mode      | Runs | Median total tokens |        Min–max |           Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| -------------- | ------------: | ---------- | --------- | ---: | ------------------: | -------------: | ------------------: | -----------: | ------------: | ------: | --------: |
| variables      |             6 | playwright | baseline  |   10 |              86,603 | 73,662–112,648 | 84,280.3 ± 11,163.2 |            7 |             0 |   10/10 |     10/10 |
| variables      |             6 | playwright | ratatoskr |   10 |              33,155 |  33,113–33,280 |     33,187.7 ± 66.1 |            1 |             0 |   10/10 |     10/10 |
| login-required |             6 | playwright | baseline  |   10 |              73,724 |  73,659–73,956 |    73,764.1 ± 109.5 |            6 |             0 |   10/10 |     10/10 |
| login-required |             6 | playwright | ratatoskr |   10 |            33,301.5 |  33,171–45,401 |    34,495.6 ± 3,636 |            1 |             1 |    4/10 |      4/10 |
| login-existing |             6 | playwright | baseline  |   10 |              73,128 |  60,111–73,291 |    67,969.2 ± 6,386 |            5 |             0 |   10/10 |     10/10 |
| login-existing |             6 | playwright | ratatoskr |   10 |              33,373 |  33,277–45,393 |  34,574.6 ± 3,606.9 |            1 |             1 |    5/10 |      5/10 |
| transient      |             2 | playwright | baseline  |   10 |            60,974.5 | 47,848–111,931 | 67,220.1 ± 18,285.9 |            8 |             0 |   10/10 |     10/10 |
| transient      |             2 | playwright | ratatoskr |   10 |            33,025.5 |  33,015–33,048 |       33,026.5 ± 10 |            1 |             0 |   10/10 |     10/10 |
| server-failure |             3 | playwright | baseline  |   10 |              81,362 | 73,710–100,379 |  81,965.6 ± 8,479.1 |            7 |             0 |   10/10 |     10/10 |
| server-failure |             3 | playwright | ratatoskr |   10 |            33,245.5 |  33,226–33,367 |     33,261.9 ± 41.8 |            1 |             0 |   10/10 |     10/10 |
| generated      |             6 | direct     | baseline  |   10 |              33,360 |  33,328–33,396 |     33,359.8 ± 19.5 |            1 |             0 |   10/10 |     10/10 |
| generated      |             6 | direct     | ratatoskr |   10 |            33,350.5 |  33,331–33,361 |      33,348.7 ± 8.4 |            1 |             0 |   10/10 |     10/10 |
| complex        |            17 | playwright | baseline  |   10 |                 N/A |            N/A |                 N/A |           24 |             0 |    4/10 |      4/10 |
| complex        |            17 | playwright | ratatoskr |   10 |            59,923.5 |  33,663–73,405 | 56,510.3 ± 12,162.9 |            3 |             0 |   10/10 |     10/10 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario       | Baseline   | Token difference (Rat − direct) | Percentage change |
| -------------- | ---------- | ------------------------------: | ----------------: |
| variables      | playwright |                         -53,448 |            -61.7% |
| login-required | playwright |                       -40,422.5 |            -54.8% |
| login-existing | playwright |                         -39,755 |            -54.4% |
| transient      | playwright |                         -27,949 |            -45.8% |
| server-failure | playwright |                       -48,116.5 |            -59.1% |
| generated      | direct     |                            -9.5 |               -0% |
| complex        | playwright |                             N/A |               N/A |

## Supporting medians (tokens and bytes remain separate)

### variables / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   86,276 |    32,868 |
| Output tokens                                           |      343 |       294 |
| Cached input tokens (subset)                            |   69,504 |    20,864 |
| Uncached input tokens                                   |   14,340 |    11,990 |
| Reasoning output tokens (subset)                        |        0 |         0 |
| Tool argument bytes                                     |      184 |       402 |
| Tool result / model evidence bytes                      |    1,454 |       145 |
| Locally retained evidence bytes (capture scope differs) |    2,292 |       456 |
| Browser operations (scope differs)                      |        7 |         7 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 90%. This is not token savings.

### login-required / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   73,407 |    32,882 |
| Output tokens                                           |      319 |     443.5 |
| Cached input tokens (subset)                            |   59,456 |    28,672 |
| Uncached input tokens                                   |   13,989 |   4,248.5 |
| Reasoning output tokens (subset)                        |        0 |     175.5 |
| Tool argument bytes                                     |      303 |       438 |
| Tool result / model evidence bytes                      |    1,356 |     134.5 |
| Locally retained evidence bytes (capture scope differs) |    2,217 |       439 |
| Browser operations (scope differs)                      |        6 |       6.5 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 90.1%. This is not token savings.

### login-existing / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   72,858 |    32,858 |
| Output tokens                                           |      270 |       506 |
| Cached input tokens (subset)                            |   54,464 |    28,672 |
| Uncached input tokens                                   |  5,998.5 |     4,201 |
| Reasoning output tokens (subset)                        |     15.5 |     200.5 |
| Tool argument bytes                                     |      147 |       388 |
| Tool result / model evidence bytes                      |      731 |       116 |
| Locally retained evidence bytes (capture scope differs) |    1,356 |       176 |
| Browser operations (scope differs)                      |        5 |         3 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 84.1%. This is not token savings.

### transient / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            | 60,635.5 |  32,831.5 |
| Output tokens                                           |      342 |     192.5 |
| Cached input tokens (subset)                            |   54,656 |    28,672 |
| Uncached input tokens                                   |    6,456 |     4,165 |
| Reasoning output tokens (subset)                        |     11.5 |         0 |
| Tool argument bytes                                     |      219 |       156 |
| Tool result / model evidence bytes                      |    1,163 |       116 |
| Locally retained evidence bytes (capture scope differs) |    2,178 |       347 |
| Browser operations (scope differs)                      |        8 |         5 |
| Failed MCP tool calls (includes valid runtime failures) |        3 |         0 |

Evidence-byte reduction: 90%. This is not token savings.

### server-failure / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   81,009 |    32,964 |
| Output tokens                                           |      353 |     277.5 |
| Cached input tokens (subset)                            |   69,760 |    28,672 |
| Uncached input tokens                                   |    6,880 |   4,310.5 |
| Reasoning output tokens (subset)                        |        0 |         0 |
| Tool argument bytes                                     |      154 |       358 |
| Tool result / model evidence bytes                      |    1,685 |       449 |
| Locally retained evidence bytes (capture scope differs) |    2,509 |       634 |
| Browser operations (scope differs)                      |        7 |         5 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 73.4%. This is not token savings.

### generated / direct

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |   33,126 |    33,114 |
| Output tokens                                           |      237 |     236.5 |
| Cached input tokens (subset)                            |   28,928 |    28,928 |
| Uncached input tokens                                   |  4,219.5 |     4,186 |
| Reasoning output tokens (subset)                        |        0 |         0 |
| Tool argument bytes                                     |      257 |       257 |
| Tool result / model evidence bytes                      |      116 |       116 |
| Locally retained evidence bytes (capture scope differs) |      267 |       267 |
| Browser operations (scope differs)                      |        5 |         5 |
| Failed MCP tool calls (includes valid runtime failures) |        0 |         0 |

Evidence-byte reduction: 0%. This is not token savings.

### complex / playwright

| Metric                                                  | Baseline | Ratatoskr |
| ------------------------------------------------------- | -------: | --------: |
| Input tokens                                            |      N/A |  59,305.5 |
| Output tokens                                           |      N/A |       624 |
| Cached input tokens (subset)                            |      N/A |    52,864 |
| Uncached input tokens                                   |      N/A |   6,097.5 |
| Reasoning output tokens (subset)                        |      N/A |        29 |
| Tool argument bytes                                     |    775.5 |     1,208 |
| Tool result / model evidence bytes                      |    4,552 |   3,160.5 |
| Locally retained evidence bytes (capture scope differs) |  7,548.5 |     1,578 |
| Browser operations (scope differs)                      |       24 |        19 |
| Failed MCP tool calls (includes valid runtime failures) |        3 |         0 |

Evidence-byte reduction: 30.6%. This is not token savings.

Generated compares manual versus CLI-derived plans using Ratatoskr in both modes. Other baselines use official Playwright MCP.
