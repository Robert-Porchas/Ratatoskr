# Token-first workflow matrix

Codex-reported turn.completed.usage; cached input and reasoning output are subsets, not additions. All completed and failed tasks are included. Configuration: gpt-6.1-sol, codex-cli 0.160.0; browser 153.0.8010.12; execution commit 6a02bb6da4f8fee0fd08a5223d01d7f4187fc7ec; started 2026-10-02T21:18:27.653Z.

| Scenario | Planned steps | Baseline | Mode | Runs | Median total tokens | Min–max | Mean ± SD | Median calls | Invalid calls | Success | Diagnosis |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| medium-http_failure | 10 | playwright | baseline | 10 | 78,372 | 62,433–92,255 | 78,558 ± 11,511.1 | 9 | 0 | 10/10 | 10/10 |
| medium-http_failure | 10 | playwright | ratatoskr | 10 | 31,959.5 | 31,918–33,395 | 32,094.3 ± 433.8 | 1 | 0 | 10/10 | 10/10 |
| large-http_failure | 20 | playwright | baseline | 10 | 94,542.5 | 77,905–110,238 | 94,128.8 ± 10,052.6 | 17 | 0 | 10/10 | 10/10 |
| large-http_failure | 20 | playwright | ratatoskr | 10 | 32,868 | 32,583–34,270 | 33,125 ± 579.8 | 1 | 0 | 10/10 | 10/10 |

Negative percentage change is improvement; no failed task is excluded from token medians. Success/diagnosis must remain comparable.

| Scenario | Baseline | Token difference (Rat − direct) | Percentage change |
| --- | --- | ---: | ---: |
| medium-http_failure | playwright | -46,412.5 | -59.2% |
| large-http_failure | playwright | -61,674.5 | -65.2% |

## Supporting medians (tokens and bytes remain separate)

### medium-http_failure / playwright

| Metric | Direct browser | Ratatoskr |
| --- | ---: | ---: |
| Input tokens | 77,781.5 | 31,541.5 |
| Output tokens | 702.5 | 417.5 |
| Cached input tokens (subset) | 65,856 | 20,224 |
| Uncached input tokens | 12,103 | 11,303.5 |
| Reasoning output tokens (subset) | 117.5 | 0 |
| Tool argument bytes | 619 | 715 |
| Tool result / model evidence bytes | 1,853 | 521 |
| Locally retained evidence bytes (capture scope differs) | 3,325.5 | 660 |
| Browser operations (scope differs) | 9 | 7 |
| Failed MCP tool calls (includes valid runtime failures) | 1 | 0 |

Evidence-byte reduction: 71.9%. This is not token savings.

### large-http_failure / playwright

| Metric | Direct browser | Ratatoskr |
| --- | ---: | ---: |
| Input tokens | 93,474.5 | 32,322.5 |
| Output tokens | 1,033.5 | 525 |
| Cached input tokens (subset) | 77,504 | 28,288 |
| Uncached input tokens | 15,175 | 4,119 |
| Reasoning output tokens (subset) | 140.5 | 0 |
| Tool argument bytes | 1,351 | 1,323 |
| Tool result / model evidence bytes | 3,169.5 | 523 |
| Locally retained evidence bytes (capture scope differs) | 6,129.5 | 663 |
| Browser operations (scope differs) | 17 | 12 |
| Failed MCP tool calls (includes valid runtime failures) | 1 | 0 |

Evidence-byte reduction: 83.5%. This is not token savings.

