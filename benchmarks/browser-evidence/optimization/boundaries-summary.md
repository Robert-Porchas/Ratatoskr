# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.160.0; browser 153.0.8010.12; execution commit fde574a0be746382e5046b8c22516bc6a4d00fad; started 2026-10-02T22:05:08.408Z.

| Scenario | Planned steps | Baseline | Mode | Runs | Median total tokens | Min–max | Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tiny-http_failure | 4 | playwright | baseline | 3 | 74,516 | 72,033–97,999 | 81,516 ± 11,699.2 | 10 | 0 | 3/3 | 3/3 |
| tiny-http_failure | 4 | playwright | ratatoskr | 3 | 32,771 | 31,280–32,781 | 32,277.3 ± 705.2 | 1 | 0 | 3/3 | 3/3 |
| small-http_failure | 6 | playwright | baseline | 3 | 62,322 | 61,921–72,002 | 65,415 ± 4,660.6 | 10 | 0 | 3/3 | 3/3 |
| small-http_failure | 6 | playwright | ratatoskr | 3 | 31,520 | 31,493–31,551 | 31,521.3 ± 23.7 | 1 | 0 | 3/3 | 3/3 |
| medium-success | 10 | playwright | baseline | 3 | 77,597 | 63,185–93,265 | 78,015.7 ± 12,283.7 | 15 | 0 | 3/3 | 3/3 |
| medium-success | 10 | playwright | ratatoskr | 3 | 31,967 | 31,967–43,158 | 35,697.3 ± 5,275.5 | 1 | 0 | 3/3 | 3/3 |
| large-success | 20 | playwright | baseline | 3 | 79,671 | 75,083–95,457 | 83,403.7 ± 8,726.4 | 17 | 0 | 2/3 | 3/3 |
| large-success | 20 | playwright | ratatoskr | 3 | 33,013 | 32,692–33,021 | 32,908.7 ± 153.2 | 1 | 0 | 3/3 | 3/3 |
| medium-locator_failure | 10 | playwright | baseline | 3 | 61,274 | 48,799–74,364 | 61,479 ± 10,437.9 | 4 | 0 | 3/3 | 3/3 |
| medium-locator_failure | 10 | playwright | ratatoskr | 3 | 56,279 | 56,221–56,350 | 56,283.3 ± 52.8 | 3 | 0 | 3/3 | 3/3 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario | Baseline | Token difference (Rat − direct) | Percentage change |
| --- | --- | ---: | ---: |
| tiny-http_failure | playwright | -41,745 | -56% |
| small-http_failure | playwright | -30,802 | -49.4% |
| medium-success | playwright | -45,630 | -58.8% |
| large-success | playwright | -46,658 | -58.6% |
| medium-locator_failure | playwright | -4,995 | -8.2% |

## Supporting medians (tokens and bytes remain separate)

### tiny-http_failure / playwright

| Metric | Direct browser | Ratatoskr |
| --- | ---: | ---: |
| Input tokens | 73,950 | 32,421 |
| Output tokens | 608 | 329 |
| Cached input tokens (subset) | 54,272 | 18,176 |
| Uncached input tokens | 19,678 | 12,818 |
| Reasoning output tokens (subset) | 85 | 0 |
| Tool argument bytes | 379 | 335 |
| Tool result / model evidence bytes | 1,880 | 521 |
| Locally retained evidence bytes (capture scope differs) | 3,236 | 660 |
| Browser operations (scope differs) | 10 | 4 |
| Failed MCP tool calls (includes valid runtime failures) | 2 | 0 |

Evidence-byte reduction: 72.3%. This is not token savings.

### small-http_failure / playwright

| Metric | Direct browser | Ratatoskr |
| --- | ---: | ---: |
| Input tokens | 61,730 | 31,192 |
| Output tokens | 598 | 328 |
| Cached input tokens (subset) | 55,040 | 27,776 |
| Uncached input tokens | 6,690 | 3,418 |
| Reasoning output tokens (subset) | 121 | 0 |
| Tool argument bytes | 488 | 470 |
| Tool result / model evidence bytes | 1,941 | 521 |
| Locally retained evidence bytes (capture scope differs) | 3,384 | 660 |
| Browser operations (scope differs) | 10 | 5 |
| Failed MCP tool calls (includes valid runtime failures) | 1 | 0 |

Evidence-byte reduction: 73.2%. This is not token savings.

### medium-success / playwright

| Metric | Direct browser | Ratatoskr |
| --- | ---: | ---: |
| Input tokens | 76,984 | 31,451 |
| Output tokens | 613 | 520 |
| Cached input tokens (subset) | 55,168 | 28,032 |
| Uncached input tokens | 20,461 | 3,419 |
| Reasoning output tokens (subset) | 81 | 74 |
| Tool argument bytes | 834 | 715 |
| Tool result / model evidence bytes | 3,134 | 116 |
| Locally retained evidence bytes (capture scope differs) | 5,375 | 449 |
| Browser operations (scope differs) | 15 | 12 |
| Failed MCP tool calls (includes valid runtime failures) | 0 | 0 |

Evidence-byte reduction: 96.3%. This is not token savings.

### large-success / playwright

| Metric | Direct browser | Ratatoskr |
| --- | ---: | ---: |
| Input tokens | 78,768 | 32,297 |
| Output tokens | 935 | 714 |
| Cached input tokens (subset) | 64,768 | 26,240 |
| Uncached input tokens | 10,148 | 6,057 |
| Reasoning output tokens (subset) | 151 | 70 |
| Tool argument bytes | 1,402 | 1,323 |
| Tool result / model evidence bytes | 2,881 | 116 |
| Locally retained evidence bytes (capture scope differs) | 5,837 | 451 |
| Browser operations (scope differs) | 17 | 22 |
| Failed MCP tool calls (includes valid runtime failures) | 0 | 0 |

Evidence-byte reduction: 96%. This is not token savings.

### medium-locator_failure / playwright

| Metric | Direct browser | Ratatoskr |
| --- | ---: | ---: |
| Input tokens | 60,872 | 55,718 |
| Output tokens | 403 | 561 |
| Cached input tokens (subset) | 54,912 | 46,720 |
| Uncached input tokens | 6,351 | 8,945 |
| Reasoning output tokens (subset) | 15 | 26 |
| Tool argument bytes | 532 | 844 |
| Tool result / model evidence bytes | 1,127 | 29,185 |
| Locally retained evidence bytes (capture scope differs) | 2,072 | 180 |
| Browser operations (scope differs) | 4 | 6 |
| Failed MCP tool calls (includes valid runtime failures) | 2 | 0 |

Evidence-byte reduction: -2,489.6%. This is not token savings.
