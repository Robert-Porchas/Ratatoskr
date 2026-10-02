# Live Codex accounting validation

One baseline task and one Ratatoskr task ran with Codex 0.159.2, gpt-6.1-sol, medium reasoning, fresh threads, and the exact canonical prompt. This is a pipeline validation, not a ten-run statistical study. Token counts are native `turn.completed.usage` values, never estimates.

`configuration.json` records the execution commit and limits. Each run retains untouched JSON events, raw usage, final diagnosis, browser interactions, request audit, and original report/log. No credentials or binary artifacts are published.

`original-results.jsonl` preserves the initial grader output. That grader incorrectly required one particular assertion/UI message to recognize persistence failure. Ratatoskr correctly reported the rejected POST, INTERNAL_ERROR, and unchanged name, but used `wait_for` rather than `assert_text`. Commit `0c18228` corrects recognition from the returned HTTP 500 plus INTERNAL_ERROR evidence. It does not change tokens, byte metrics, tool behavior, or production reduction.

`results.jsonl` contains the mechanically regraded records; both tasks satisfy every criterion. Original run logs still show their original scores. Reproduce the correction without any model calls:

```sh
npx tsx benchmarks/browser-evidence/regrade.ts benchmarks/browser-evidence/codex-sample/original-results.jsonl /tmp/ratatoskr-regraded-results.jsonl
npm run benchmark:browser:summary -- /tmp/ratatoskr-regraded-results.jsonl
```

The output path must not already exist. `summary.md` is generated from the corrected records. The earlier approval-blocked validation is preserved locally in ignored `results/codex-usage-validation-v1/`; it never performed a browser task and is not included in this completed-task sample.

These results do **not** demonstrate token savings: Ratatoskr returned fewer bytes but consumed more tokens in this pair. Its invalid initial plan, recovery, extra inspection, and larger schema are visible in the actual sequence. Nothing was removed to obtain a favorable result.
