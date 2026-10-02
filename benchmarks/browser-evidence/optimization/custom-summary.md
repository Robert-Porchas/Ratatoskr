# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.160.0; browser 153.0.8010.12; execution commit 986faeeb19d1a13c3b6aa351470826c236e2ad0c; started 2026-10-02T22:17:34.543Z.

| Scenario | Planned steps | Baseline | Mode | Runs | Median total tokens | Min–max | Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| medium-http_failure | 10 | direct | baseline | 3 | 79,355 | 79,243–79,434 | 79,344 ± 78.4 | 9 | 0 | 3/3 | 3/3 |
| medium-http_failure | 10 | direct | ratatoskr | 3 | 31,952 | 31,917–31,976 | 31,948.3 ± 24.2 | 1 | 0 | 3/3 | 3/3 |
| large-http_failure | 20 | direct | baseline | 3 | 72,664 | 69,764–83,582 | 75,336.7 ± 5,949.3 | 14 | 0 | 3/3 | 3/3 |
| large-http_failure | 20 | direct | ratatoskr | 3 | 33,044 | 32,808–34,246 | 33,366 ± 629.7 | 1 | 0 | 3/3 | 3/3 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario | Baseline | Token difference (Rat − direct) | Percentage change |
| --- | --- | ---: | ---: |
| medium-http_failure | direct | -47,403 | -59.7% |
| large-http_failure | direct | -39,620 | -54.5% |

## Supporting medians (tokens and bytes remain separate)

### medium-http_failure / direct

| Metric | Direct browser | Ratatoskr |
| --- | ---: | ---: |
| Input tokens | 78,609 | 31,536 |
| Output tokens | 741 | 416 |
| Cached input tokens (subset) | 67,840 | 25,344 |
| Uncached input tokens | 10,853 | 6,214 |
| Reasoning output tokens (subset) | 38 | 0 |
| Tool argument bytes | 414 | 715 |
| Tool result / model evidence bytes | 8,589 | 521 |
| Locally retained evidence bytes (capture scope differs) | 11,217 | 660 |
| Browser operations (scope differs) | 16 | 7 |
| Failed MCP tool calls (includes valid runtime failures) | 0 | 0 |

Evidence-byte reduction: 93.9%. This is not token savings.

### large-http_failure / direct

| Metric | Direct browser | Ratatoskr |
| --- | ---: | ---: |
| Input tokens | 71,882 | 32,415 |
| Output tokens | 782 | 534 |
| Cached input tokens (subset) | 61,824 | 28,288 |
| Uncached input tokens | 7,518 | 4,127 |
| Reasoning output tokens (subset) | 60 | 0 |
| Tool argument bytes | 732 | 1,323 |
| Tool result / model evidence bytes | 20,888 | 523 |
| Locally retained evidence bytes (capture scope differs) | 24,493 | 663 |
| Browser operations (scope differs) | 26 | 12 |
| Failed MCP tool calls (includes valid runtime failures) | 0 | 0 |

Evidence-byte reduction: 97.5%. This is not token savings.
