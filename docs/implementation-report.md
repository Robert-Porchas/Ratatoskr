# Capability expansion engineering report

## Delivered scope

This branch adds a coherent first implementation across all seven requested areas:
versioned bounded evidence, before/after comparison, strict Playwright export,
explicit local application diagnostics, CLI/CI reporting, Doctor improvements,
Codex guidance and semantic discovery. Shared execution remains in the existing
application/executor. No internal model, external evidence service, database,
automatic source indexing or autonomous browser exploration was added.

The complete long-term initiative is **not** claimed finished. Advanced export
semantics, richer request identity/normalization, automatic stack mapping and
platform validation remain explicitly scoped follow-ups.

## Initial findings

The initial clean branch was `autoGen/retry/branchFeature` at `ea73c35`.
`application.ts` already shared execution between CLI and MCP; `storage.ts`
already persisted local runs/artifacts; `session.ts` already sanitized session
observations. CLI execution, Doctor, reverse Playwright derivation, a packaged
skill, fixtures and byte/token benchmark infrastructure already existed.
The initial unit/type baseline passed:25 files,118 tests. Browser E2E also passed.
See [initial assessment](capability-assessment.md) for modules and dependencies.

The important gaps were successful HTTP status retention, bounded evidence,
comparison provenance, forward export, explicit source mappings, discovery and
CI-oriented command/reporting support. Existing preorder step indexes, secret
resolution, retry safety, artifact registration and inspector paging were reused.

## Feature completion matrix

| Requested area                | Status                                   | Implementation and interface                                                        | Acceptance evidence / limitations                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before/after verification     | Partially implemented: conservative v1   | `src/run-metadata.ts`, `src/compare-runs.ts`; `compare_browser_runs`, CLI `compare` | Assertion/HTTP recovery, regressions/persistence, determinism, coverage/config/truncation warnings, bounded summaries tested. Exact method/origin/path/step/occurrence matching; query-sensitive identity is inconclusive. No configurable volatile-ID rules, application revision label or actual browser-version capture. |
| Playwright Test export        | Complete for documented supported subset | `src/export-workflow.ts`; `export_browser_workflow`, CLI `export`                   | Generated test executes against local fixture; assertions, escaping, environment setup, no overwrite and unsupported semantics tested. Branches/extraction/discovery/file actions/explicit retries/dialog policies are rejected. No claim of arbitrary workflow equivalence.                                                |
| Application-aware diagnostics | Partially implemented                    | `src/diagnostics.ts`; `diagnose_browser_run`, CLI `diagnose`/`source`               | Exact configured route pointers, configured correlation headers and explicit local source-map positions tested, including missing/malformed/escaping maps. Automatic stack parsing, caching, logs and framework adapters deferred. Map freshness/origin-to-route relationship unverified.                                   |
| Standalone CLI/CI             | Complete for documented commands         | `src/cli.ts`, `src/application.ts`, `src/reporting.ts`, `src/local-files.ts`        | Shared validated execution, JSON/JUnit, stable exit codes, source/compare/export, SIGTERM abortion and exclusive writes tested. Headed/custom viewport/generic parameter flags not exposed.                                                                                                                                 |
| Installation diagnostics      | Already existed; extended                | `src/doctor.ts`; CLI `doctor --json` and existing npm wrapper                       | Required/optional states, no secret values, configuration and writable-parent checks, missing-browser startup reporting and healthy browser launch exercised. Direct stdio handshake stays an explicit smoke check; no repairs.                                                                                             |
| Codex skill                   | Already existed; updated                 | `skills/ratatoskr/SKILL.md`, `references/verification.md`, `.mcp.json`              | Validated frontmatter/examples,2833-byte entrypoint, progressive disclosure, configuration forwarding and package staging. Manual copy and existing plugin mechanisms documented.                                                                                                                                           |
| Semantic discovery            | Complete for bounded main-frame subset   | `src/discovery.ts`, adapter/browser port; explicit workflow `do:"discover"`         | Actual locator cardinality, ambiguity, hidden/disabled controls, privacy, deterministic ranking, no action/request changes and1000-element cutoff exercised. Approximate accessible names; no frame/shadow traversal or automatic locator replacement.                                                                      |

## Architecture, compatibility and privacy

`RunRecord.verification` is optional version1 metadata. Existing records still
load, but lack provenance for a confident comparison. Metadata records a canonical
workflow hash, fixed browser/viewport policy, capture drops, pending requests and
completion. Initial navigation now always persists. HTTP successes are retained
locally while failure reducers/metrics still report errors only.

Evidence is capped at4000 events/2MB; oversized strings are omitted whole.
Redaction rechecks budgets, and final discovery removes any locator changed by
late credential redaction. Reads reject oversized/nonregular files and paths
outside the run store. New small MCP tools reject oversized arguments before
schema collection validation. All comparisons separate observed changes from
limitations; disappeared requests are never successful responses.

Export is a pure translation with JSON-safe literals, explicit environment
requirements and unsupported-operation rejection. CLI output uses exclusive
workspace-contained creation. MCP exports go through registered artifacts and
default to metadata. Local maps/configuration are bounded; no map downloads,
backend log access, source contents or raw authentication state are returned.
Artifact retention stays manual; no user files or profiles are deleted.

Independent manual code review identified and led to fixes for JSON-excerpt
leakage, incomplete-name credential prefixes, oversized role attributes,
startup/infrastructure reporting, persistent error counts, FIFO blocking,
base-URL replacement, final locator redaction and plugin configuration forwarding.
This was a manual review, not a formal security scanner or exploit audit.
Unknown visible secrets, existing local administrators and stale maps remain
limitations.

`npm audit --omit=dev` exits1 with two preexisting high-severity package groups:
`@modelcontextprotocol/server@2.2.0` and `zod@4.6.5`. The SDK advisories concern
[HTTP transport isolation](https://github.com/advisories/GHSA-jm63-cq47-j5jp),
[validation resource exhaustion](https://github.com/advisories/GHSA-46jr-4wx8-v453)
and [HTTP bearer audience checks](https://github.com/advisories/GHSA-rvq5-wwqv-78pq).
Ratatoskr uses stdio and does not expose those HTTP authentication/transport
interfaces. [Zod constrained-collection exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
merits a targeted dependency update; workflow/new diagnostic input budgets reduce
application validation exposure but do not establish the SDK/dependency stack as
vulnerability-free. Production dependency versions were not changed. Full npm
installation reports13 advisories (10 moderate,3 high), including development
dependencies. These are package advisory results, not confirmed Ratatoskr exploits.

## Actual validation results

On Linux, Node24.19.0, Playwright1.63.0 / Chromium153:

| Command/check                    | Result                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                       | 165 tests /31 files passed (baseline118 /25)                                                                                                                                                              |
| `npm run typecheck`              | Passed                                                                                                                                                                                                    |
| `npm run lint`                   | Passed                                                                                                                                                                                                    |
| `npm run format:check`           | Passed                                                                                                                                                                                                    |
| `npm run build`                  | Passed                                                                                                                                                                                                    |
| `npm run test:e2e`               | Passed real login success/failure fixture                                                                                                                                                                 |
| `npm run test:mcp`               | Passed all six tools, comparison/export/map/discovery, credential/size guards                                                                                                                             |
| `npm run test:workflow`          | Passed variables, branches, retry/recovery, POST reload refusal and uncertain-mutation non-replay                                                                                                         |
| `npm run test:session`           | Passed browser and MCP session privacy/regressions                                                                                                                                                        |
| `npm run test:benchmark`         | Passed offline fixture/replay and actual proxy call-budget tests                                                                                                                                          |
| `npm run test:developer-tooling` | Passed before/after/regression, real generated Playwright Test, CLI reports, missing browser, malformed JSON, overwrite, Doctor no-write and SIGTERM abortion                                             |
| `npm run test:dist`              | Passed staged plugin/package inventory;38 files                                                                                                                                                           |
| Registered-runtime smoke         | Passed six-tool handshake and local workflow using temporary registration                                                                                                                                 |
| `npm run test:install`           | Passed isolated clone/dependencies/browser/config, plugin and skill discovery, Doctor/smoke, unit/type/lint/distribution/MCP checks at `33c8f10`; final input guards separately passed focused/MCP checks |
| Skill validation                 | quick_validate passed; examples parsed/normalized; byte budget preserved                                                                                                                                  |

Intermediate failures were corrected: tool-count/schema assumptions in existing
MCP tests were updated for the intentional new interfaces while retaining the
original three tools'5500-byte budget; an existing startup-deadline test caught an
over-broad infrastructure classification; distribution caught the skill-size
budget and the skill was shortened. No assertions were removed to hide failures.

Plain `npm run smoke` initially failed because this machine had no
`~/.ratatoskr/runtime.json`. A temporary registered runtime passed; the user's
registration was left untouched. No baseline unit/type/E2E failure was found.
Windows/macOS and alternate Node/browser combinations were not locally exercised.
No paid model/token benchmark was run.

## Performance and output evidence

Single controlled integration samples, not statistical performance claims:

- Passing workflow result:63 JSON bytes; failing result:376 bytes.
- Comparison:827 bytes; new-regression comparison:541 bytes.
- Export metadata:255 bytes; generated source:2625 bytes; selected inspection:289 bytes.
- Discovery fixture:1458 bytes; large-page scan stopped at1000 elements.
- Six MCP definitions:7316 bytes; legacy three-tool subset remains under5500.
- Skill entrypoint:2833 bytes; staged package approximately296KB.
- One passing candidate execution:323ms; local evidence630 bytes; persisted-run
  comparison approximately12.8ms including file reads.

These are measured byte/time samples, **not model tokens**. New schemas consume
additional default context; full HTTP capture consumes additional bounded local
storage. No current model-token savings or superiority claim is made. Peak browser
memory and paired runtime overhead were not measured. Existing authoritative
historical token results were preserved unchanged.

## Usage and migration

[Developer tooling reference](developer-tooling.md) contains the tested command
reference and examples for run/validate/compare/export/Doctor/diagnose/source,
JUnit CI usage, skill installation and discovery. Fixture examples require the
existing fixture server and local credentials. Source/config examples are clearly
illustrative and require real workspace files. Use `npm run --silent cli` when
redirecting machine-readable output so npm banners do not enter the report.

No data migration is required. Rebuild and reinstall the plugin through existing
instructions to discover six tools and forward the optional absolute application
configuration path. Legacy comparisons remain inconclusive; rerun a safe reviewed
workflow to collect versioned evidence. Larger preexisting run files above the new
4MB read bound require manual local review. No automatic artifact cleanup occurs.

## Git and recommended pull request

Starting branch:`autoGen/retry/branchFeature`, commit`ea73c35`.
Final feature branch:`feat/evidence-verification-and-developer-tooling`.
The starting worktree was clean. No unrelated user modifications existed or were
lost. No remote push, merge, PR creation, force push, reset or stash occurred.

Implementation commits:

- `2be5b8f` docs: record capability expansion audit and implementation contracts
- `3fba7f1` feat(evidence): persist bounded verification metadata and semantic discovery
- `7b9cde0` feat(verification): compare workflow outcomes and normalized run evidence
- `3458de0` feat(export): translate supported workflows into strict Playwright tests
- `75fa99e` feat(diagnostics): correlate explicit routes and bounded local source maps
- `a11c5de` fix(discovery): withhold locators changed by late credential redaction
- `49d00b6` feat(tooling): expose verification workflows through CLI and MCP
- `33c8f10` docs: document verification tooling and package concise Codex guidance

The final input-budget follow-up and this report are additional narrowly scoped commits in `git log ea73c35..HEAD`.
The final worktree is clean after the report commit. Generated data remains ignored.

Proposed PR title: **Add evidence verification, strict Playwright export and local developer tooling**.

Proposed description:

> Browser workflows now persist bounded comparison metadata and successful HTTP
> statuses so before/after runs can report observed improvements, regressions and
> incomplete evidence. CLI/MCP share strict test export, explicit local source
> diagnostics and bounded semantic discovery; CLI adds CI reporting, validation,
> Doctor JSON and cancellation. Existing execution, redaction and retry semantics
> remain shared.
>
> Validation:165 unit tests; type/style/build/distribution; real browser/MCP,
> workflow/session, offline benchmark fixtures; generated Playwright Test and
> CLI interruption/report integration. No paid model benchmarks. Legacy runs need
> a fresh safe execution for confident comparison. Unsupported export semantics,
> query-sensitive identity and local-map limitations are documented.

Retain the dependency on`ea73c35`: target the prior feature branch, or wait until
that work is integrated before targeting the integration branch. Opening against
the older local`main` would include unrelated prior feature history.

Review checklist: evidence completeness/identity; unsupported export guarantees;
local path and secret boundaries; lifecycle/exit codes; schema budgets; plugin
forwarding/skill packaging; explicit deferred scope. No PR was opened.

## Prioritized remaining work

1. Targeted SDK/Zod dependency remediation and validation against official SDK
   changes; investigate affected stdio paths rather than assuming HTTP-only scope.
2. Explicit safe query/volatile-field normalization and stable request identities,
   actual browser version and optional application revision metadata. Avoid guessing
   dynamic route IDs into equivalence.
3. Reviewed branch/extraction/fixture export semantics with real equivalence tests.
4. Automatic stack-frame selection, bounded map caching/freshness and optional
   explicitly authorized local-log correlation, if user demand justifies them.
5. Additional Windows/macOS/Node22 CI browser evidence, accessibility edge cases,
   frame/shadow scope and paired runtime/memory measurements.
6. Optional retention tooling with explicit ownership rules; no silent deletion.
