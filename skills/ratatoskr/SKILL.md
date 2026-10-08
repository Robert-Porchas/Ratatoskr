---
name: ratatoskr
description: Batch known multi-step browser tests, E2E application flows, and browser bug reproductions through Ratatoskr MCP. Use source-known routes and locators to reduce repeated model/browser interactions; not general web research or autonomous exploration.
---

# Ratatoskr browser testing

Use for deterministic app workflows (login, forms, CRUD, checkout, regressions). Prefer direct tooling for trivial actions, open-ended browsing or unsupported interactions; measured token savings are scenario-specific.

Before execution, derive routes, labels, accessible names, test IDs and expected behavior from source or existing tests when available. Construct the complete workflow; do not rediscover known facts through browser calls.

Call `run_browser_workflow` once with `url` and `steps`. Steps use `do` plus one flat locator: `label`, `text`, `testId`, `css`, or `role` + optional `name`.

Use configured local `valueRef` names, never plaintext secrets. `has` asserts target text with `contains`; `extractText`/`extractAttribute` + `save` requests a small output, including on later failure. Use `${savedName}` in later navigation, semantic locators, assertions, fills or selects to avoid another workflow call. Verify persisted state, not merely edited inputs.

Use bounded branches for known runtime alternatives: `{ "if": "visible", "testId": "dashboard", "then": [], "else": [...] }`. Also supported: `if:"url"` + `contains`, `"exists"` + `variable`, `"equals"` + `variable`/`equals`, and `not:true`. Depth two; visibility observes at most 250 ms. Use `derive-workflow <test.ts> --base-url URL` when its validated sequential Playwright conversion reduces plan construction; review warnings before execution.

`retry` is total attempts (max three), only for genuinely transient navigation/waits/hover/extraction or pre-action click readiness. `recover:"reloadOnce"` requires a wait/extraction with `retry:2`. Never retry destructive mutations or uncertain side effects. Plans are bounded to 300 nodes / 180 seconds, 360 executed nodes/attempts/reloads and 60 retries; no JavaScript, shell, loops, expressions or AI planning.

On success, stop unless the user requested more. On failure, use compact errors to investigate source first. Call `inspect_browser_run` only for necessary categories; call `get_browser_artifact` only for one useful artifact. Never fetch screenshots, traces or full logs automatically.

Use compact session findings before further inspection. Request the `session` category only if cookie/storage metadata is still needed. Raw session values are deliberately withheld; protected auth-state artifacts are not for ordinary debugging and cannot be retrieved inline.

If the tools are unavailable, explain that setup needs repair; do not pretend a workflow ran. Use the installed project's README (`npm run doctor`, `npm run smoke`) for diagnostics.
