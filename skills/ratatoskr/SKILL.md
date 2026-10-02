---
name: ratatoskr
description: Batch known multi-step browser tests, E2E application flows, and browser bug reproductions through Ratatoskr MCP. Use source-known routes and locators to reduce repeated model/browser interactions; not general web research or autonomous exploration.
---

# Ratatoskr browser testing

Use for deterministic app workflows (login, forms, CRUD, checkout, regressions). Prefer direct tooling for trivial actions, open-ended browsing or unsupported interactions; measured token savings are scenario-specific.

Before execution, derive routes, labels, accessible names, test IDs and expected behavior from source or existing tests when available. Construct the complete workflow; do not rediscover known facts through browser calls.

Call `run_browser_workflow` once with `url` and `steps`. Steps use `do` plus one flat locator: `label`, `text`, `testId`, `css`, or `role` + optional `name`. Example:

```json
{
  "url": "http://127.0.0.1:3000/login",
  "steps": [
    { "do": "fill", "label": "Email", "valueRef": "TEST_EMAIL" },
    { "do": "fill", "label": "Password", "valueRef": "TEST_PASSWORD" },
    { "do": "click", "role": "button", "name": "Sign in" },
    { "do": "url", "contains": "/dashboard" }
  ]
}
```

Use configured local `valueRef` names, never plaintext secrets. `has` asserts target text with `contains`; `extractText`/`extractAttribute` + `save` requests a small output, including on later failure. Verify persisted state, not merely edited inputs. Plans are bounded to 300 steps / 180 seconds; no JavaScript, shell, loops or AI planning.

On success, stop unless the user requested more. On failure, use compact errors to investigate source first. Call `inspect_browser_run` only for necessary categories; call `get_browser_artifact` only for one useful artifact. Never fetch screenshots, traces or full logs automatically.

If the tools are unavailable, explain that setup needs repair; do not pretend a workflow ran. Use the installed project's README (`npm run doctor`, `npm run smoke`) for diagnostics.
