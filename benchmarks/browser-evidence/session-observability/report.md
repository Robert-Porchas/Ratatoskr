# Session observability sprint report

## Implementation and disclosure

`src/session.ts` is independent of Playwright: it defines sanitized metadata, an ephemeral comparison snapshot, pure cookie/storage differs, a bounded journal and the failure reducer. The adapter owns observation, the executor owns capture timing, and the existing shared inspector serves CLI/MCP. There are still exactly three MCP tools and no new BrowserPlan actions.

| Level | What is available                                                                                                       | What is withheld                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1     | Relevant failure findings; maximum three, subsection under 750 bytes                                                    | Full cookie/key lists, all values, hashes, screenshots and trace bodies |
| 2     | Explicit `session` inspection: cookie name/domain/path/security/expiry, changes, key names, sanitized response metadata | Cookie/storage values, raw headers, state files                         |
| 3     | Opt-in local Playwright cookie/localStorage state; registered sensitive artifact metadata                               | Body and local path through MCP; CLI export                             |

Snapshots are complete initially, after initial navigation, at first failure and at completion. Cookie-only comparisons follow navigation, click, press and download boundaries. There is a one-second capture budget; retained metadata is bounded to 200 cookies, 200 storage entries, 100 active-tab sessionStorage keys, 64 snapshots, 500 changes and 100 responses. Exceeding bounds/inaccessible state is flagged; incomplete snapshots cannot prove removals or non-retention.

Cookie identity includes name, domain, path and partition key. Values only contribute to per-run keyed HMAC comparison in memory. No values, comparison keys or hashes are persisted in ordinary run files. Expiration, security and SameSite changes are classified as metadata changes; Level 2 includes derived expired status. Storage identity includes origin/key/area. Changes span a capture interval, not a fabricated exact mutation time. Current-tab sessionStorage uses fixed read-only Ratatoskr code, never caller-supplied JavaScript; tab transitions are not compared as one session. IndexedDB, passkeys/credentials and OPFS capture are off. Full protected state follows Playwright storageState and does not include sessionStorage. Retention limits apply to metadata: the underlying Playwright API transiently reads complete cookies/localStorage.

Individual `headerValues('set-cookie')` values are parsed locally, never comma-split or returned. Only cookie names/safe attributes and response method/path/status persist. Authorization, Proxy-Authorization and cookie/storage values enter the redactor, which also scrubs previously captured messages. Ordinary network events never store headers/bodies. Once such state is observed, traces are discarded rather than exposing a credential-bearing ZIP as an ordinary artifact. Screenshots mask known text and form controls.

The reducer correlates timestamps/step identity and HTTP 401/403, prioritizing a missing cookie after Set-Cookie, then removal/value/metadata changes, then context-cookie presence near auth failures. It compares the first complete snapshot following a response, not a later logout. Storage comparison intervals and initial-navigation changes are treated conservatively. Correlation is not proof of root cause: context presence does not establish that a request carried a cookie, and no SameSite/Secure diagnosis is guessed.

Protected artifacts are default-off. `RATATOSKR_CAPTURE_AUTH_STATE=1` enables capture only on relevant failures. UUID IDs resolve through the registry with path/realpath checks; type-enforced sensitivity cannot be downgraded through flags. Private directories/files use 0700/0600 on supported filesystems. Ordinary reads, MCP inline delivery and CLI copying refuse state files. A controlled `readProtectedState` API supports future local reuse; reuse itself is not implemented. `.gitignore` and package audits exclude generated state. There is no automatic retention deletion.

## Verified examples

The deterministic fixture uses fake values and real local HTTP requests. These are canonical response shapes (IDs omitted for readability), verified by browser and MCP tests:

```json
{ "success": true, "runId": "run_..." }
```

Successful login records cookie/storage changes locally, but returns no session field.

Missing cookie: login returned 200 with a rejected-domain Set-Cookie; protected API returned 401/UNAUTHENTICATED. Level 1 is 129 bytes:

```json
{
  "findings": [
    {
      "kind": "cookie_not_retained",
      "name": "session",
      "response": { "method": "POST", "path": "/api/auth/login", "status": 200 }
    }
  ]
}
```

Session loss after sign-out plus 401 produces a 66-byte subsection:

```json
{ "findings": [{ "kind": "cookie_removed", "name": "session", "step": 6 }] }
```

The cookie-path scenario produces a 134-byte generic auth-failure subsection; one bounded Level 2 call provides `/restricted` to compare with `/api/auth/protected`. Unrelated absent-control failure adds no session field, despite recording a previous successful login locally. The initial failure result includes neither screenshot bytes nor full auth state. Protected artifact retrieval returns metadata only.

Tests seed `SUPER_SECRET_SESSION_VALUE_123` and `SUPER_SECRET_STORAGE_VALUE_456`, including console/page echoes. They check ordinary persistence, RunResult, inspection, MCP content/diagnostics, and artifact metadata for absence of those values. Storage tests cover identifier traversal, registration through a symlink, metadata flag downgrades and private permissions. The raw fake value is present only in the opt-in protected artifact, readable through the explicit local API.

## Measurement provenance

The pre-change profile pair at `cb13bf1` measured 77,035 direct versus 31,920 Ratatoskr tokens, both correct, with 7 versus 1 calls. Ratatoskr definitions were 4,034 bytes. Those tasks used Codex 0.160.0; the session series uses 0.160.1. This pair is a historical baseline, not an equivalent session-task before/after comparison.

Current definitions total **4,144 bytes**, up 110 bytes (2.7%): `run_browser_workflow` 2,013, `inspect_browser_run` 1,035, `get_browser_artifact` 1,092. The workflow input schema is unchanged; inspection adds one category and artifact output adds sensitivity metadata/type. No session input union or new tool is exposed. The skill is 2,334 bytes (previously 2,057); discovery front matter remains 280 bytes. Native session tasks isolate MCP and deliberately disable plugins/skills, so skill overhead is not included in these results.

The first development trial used 43,402 tokens without Level 1 versus 43,037 with it (0.8% difference); both used two calls and one session inspection. Direct used 122,734 tokens/21 calls but made an unsupported claim about missing response headers; it is not an equal-correctness comparison. This motivated stricter grading and the focused finding-priority change. The repeated series preserves failures and does not substitute this pilot for final results.

The [initial generated summary](initial/summary.md), [all 120 counts](initial/results.jsonl), [native usage](initial/native-usage.jsonl) and [configuration](initial/configuration.json) preserve the first repeated measurements. Counts are audited against native `turn.completed.usage` in fresh Codex tasks. Total=input+output; cached input and reasoning output are subsets. Missing completion events yield unavailable tokens, not estimates. No model inference count is invented. Browser evidence bytes and local session bytes remain separate.

### Initial repeated findings

| Scenario          | Without Level 1 median tokens | With Level 1 median tokens | Change | Median calls, off/on |
| ----------------- | ----------------------------: | -------------------------: | -----: | -------------------: |
| Success           |                        42,888 |                   48,479.5 | +13.0% |              2 / 2.5 |
| Missing cookie    |                      55,521.5 |                     43,560 | −21.5% |                2 / 2 |
| Session loss      |                      55,540.5 |                   43,777.5 | −21.2% |                2 / 2 |
| Cookie path       |                        43,707 |                   49,896.5 | +14.2% |                2 / 2 |
| Unrelated failure |                      55,963.5 |                     56,461 |  +0.9% |                3 / 3 |

There are ten attempts per case. Both success groups scored 9/10 due to observed `net::ERR_NETWORK_CHANGED` failures; other Ratatoskr groups scored 10/10. Zero Ratatoskr calls were invalid. The auth improvements did **not** eliminate the median follow-up inspection. Success/unrelated results contain zero automatic session bytes; their increased calls are not caused by an automatic session dump, but remain real measured costs. Native exec does not expose sufficient per-inference usage to attribute every input-token difference.

Direct missing-cookie scored 4/10 and direct path scored 2/10; remaining tasks hit time/call limits without native completion usage. Their full-group token medians are deliberately **N/A**, not a favorable savings percentage against incomplete diagnoses. Completed direct samples retain actual usage, but are not substituted for all-attempt medians. The initial full token acceptance criteria were not met.

Review found that the benchmark's shared generic persistence warning encouraged re-inspection of completed assertions, while its task asked about session changes even for unrelated control failures. A narrowly corrected task/instruction contract is now shared identically by all configurations: assert state rather than clicks alone; passed assertions count as evidence; investigate cookies when authentication fails. Fixture causes, success criteria, tool behavior and token accounting are unchanged. The original series remains above and is not mixed with corrected-contract measurements.

### Runtime overhead

The developer timing runner uses the **actual old executor** extracted from `cb13bf1` plus the current executor against identical fresh fixture contexts, alternating execution order. Ten attempts per mode/scenario, a 600 ms assertion timeout, and no model calls produced:

| Scenario         | Old median workflow ms | New median workflow ms |     Difference |
| ---------------- | ---------------------: | ---------------------: | -------------: |
| Successful login |                    484 |                    533 | +49 ms (10.1%) |
| Missing cookie   |                  1,128 |                  1,160 |  +32 ms (2.8%) |

These timings include browser startup/cleanup and ran alongside the two-slot native suite; they are local measurements, not universal overhead guarantees. Capture/diff timings are separately recorded per task. Off/on token controls both observe state, so they cannot isolate observer runtime cost. No expensive full storage snapshot runs after every action.

## Limits and next work

- Snapshotting is bounded/best effort, not exhaustive session monitoring. Transient writes/removals, inaccessible origins, cross-tab sessionStorage and changes outside the correlation window can be missed.
- Generic keys are not classified as authentication tokens. A login without Set-Cookie cannot establish which cookie an application intended; findings remain factual, not inferred root causes.
- Redaction protects observed/resolved values, not arbitrary unknown secrets, transformations, canvas/image-rendered text or download contents. This is not a DLP guarantee. Browser evidence can still be sensitive.
- Full state is plaintext; local owners/admins can read it. POSIX modes are tested on Linux, not a claim of Windows ACL hardening, encryption or OS credential-manager integration.
- Local artifacts have no TTL/automatic cleanup. Remove only Ratatoskr-owned generated runs when no longer needed; never commit/share state files.
- Agent behavior varies. Compact findings may still lead to redundant inspection, and the native CLI does not expose per-inference attribution. A lower byte count alone proves no token savings.

## Reproduce verification

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:e2e
npm run test:mcp
npm run test:session
npm run test:benchmark
npm run test:dist
npm run doctor
npm run smoke
```

The [methodology guide](README.md) provides one-task and repeated Codex commands, accounting boundaries and publication commands. The local timing runner accepts an old compiled `application.js` and an ignored output JSON path: `BENCHMARK_RUNS=10 npx tsx benchmarks/browser-evidence/session-timing.ts /ABSOLUTE/old/dist/src/application.js benchmarks/browser-evidence/results/YOUR_SUITE/timing.json`. It shares installed dependencies; preserve the old commit and lockfile provenance when interpreting it.
