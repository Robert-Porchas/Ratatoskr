# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.160.0; browser 153.0.8010.12; execution commit 5b31edcfce281595f409b784a6a00023177181a0; started 2026-10-02T22:27:54.352Z.

| Scenario | Planned steps | Baseline | Mode | Runs | Median total tokens | Min–max | Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| medium-locator_failure | 10 | playwright | baseline | 3 | 61,267 | 56,230–62,353 | 59,950 ± 2,667.5 | 4 | 0 | 3/3 | 3/3 |
| medium-locator_failure | 10 | playwright | ratatoskr | 3 | 31,896 | 31,893–32,002 | 31,930.3 ± 50.7 | 1 | 0 | 3/3 | 3/3 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario | Baseline | Token difference (Rat − direct) | Percentage change |
| --- | --- | ---: | ---: |
| medium-locator_failure | playwright | -29,371 | -47.9% |

## Supporting medians (tokens and bytes remain separate)

### medium-locator_failure / playwright

| Metric | Direct browser | Ratatoskr |
| --- | ---: | ---: |
| Input tokens | 60,865 | 31,497 |
| Output tokens | 402 | 399 |
| Cached input tokens (subset) | 50,432 | 28,032 |
| Uncached input tokens | 8,327 | 3,465 |
| Reasoning output tokens (subset) | 16 | 0 |
| Tool argument bytes | 530 | 718 |
| Tool result / model evidence bytes | 1,127 | 347 |
| Locally retained evidence bytes (capture scope differs) | 2,070 | 180 |
| Browser operations (scope differs) | 4 | 6 |
| Failed MCP tool calls (includes valid runtime failures) | 2 | 0 |

Evidence-byte reduction: 69.2%. This is not token savings.
