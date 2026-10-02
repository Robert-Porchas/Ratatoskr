<!-- Generated from recorded runs; do not edit measurements. -->

Configuration: codex; model: gpt-6.1-sol; browser: 153.0.8010.12; commit: aaf7e0bccd193f139abafd1671b2cea2aeb7da60; Codex: codex-cli 0.159.2; runs: 1 per mode; started: 2026-10-02T02:24:43.848Z.

Token accounting: Codex-reported turn.completed.usage from one fresh process/thread per task. This is the completed user-turn total across internal model calls; model-call counts and per-invocation usage are not exposed by this CLI stream. Total tokens = reported input + reported output; cached input and reasoning output are subsets, not additions.

| Metric | Direct browser | Ratatoskr | Change |
| --- | ---: | ---: | ---: |
| Task criteria met | 1/1 | 1/1 | — |
| Correct diagnosis | 1/1 | 1/1 | — |
| Median input tokens | 52,973 | 92,819 | -75.2% reduction |
| Median output tokens | 340 | 646 | -90% reduction |
| Median total tokens | 53,313 | 93,465 | -75.3% reduction |
| Median cached input tokens (included in input) | 40,192 | 61,696 | — |
| Median uncached input tokens | 12,781 | 31,123 | — |
| Median reasoning tokens (included in output) | 0 | 0 | — |
| Median model calls | N/A | N/A | — |
| Median tool interactions | 5 | 4 | 20% reduction |
| Median browser operations (including observations/assertions) | 9 | 9 | 0% reduction |
| Median evidence inserted into model context (bytes) | 4,749 | 2,778 | 41.5% reduction |
| Median returned evidence (bytes) | 4,749 | 2,778 | 41.5% reduction |
| Median cumulative context evidence (bytes) | N/A | N/A | — |
| Median local event evidence (bytes; capture differs by mode) | 7,392 | 1,019 | — |
| Median local binary artifacts (bytes) | 0 | 13,843 | — |
| Tool definitions (bytes) | 3,567 | 8,904 | — |
| Median elapsed time (ms) | 26,116 | 45,406 | — |
