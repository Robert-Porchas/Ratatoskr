# Distribution verification

Ratatoskr 0.1.0 is distributed as a retained prepared clone plus a small Codex plugin bundle. Installation commands are first in the [README](../README.md). There is no published npm package or public plugin-directory entry.

## Format and prerequisites

The supported OpenAI compatibility layout is used instead of the portable MCP schema because the local server needs environment-name forwarding and a client timeout above its 180-second deadline. Plugin `cwd: "."` is resolved by Codex relative to its cache; MCP command strings do not use hook-only `${PLUGIN_ROOT}` interpolation. This behavior was checked against [official documentation](https://developers.openai.com/plugins/build/plugins), [Codex's parser](https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/plugin_config.rs), and real Codex 0.160.0 discovery. No plugin hooks execute during installation.

Source components:

```text
.claude-plugin/marketplace.json    repository catalog → dist/plugin
.codex-plugin/plugin.json         identity / MIT / version / component paths
.mcp.json                         relative stdio launch, names-only forwarding
skills/ratatoskr/SKILL.md          operational browser testing guidance
scripts/{runtime,mcp}.mjs          bootstrap → registered prepared clone
scripts/{setup,doctor,smoke}.mjs   local setup and verification
dist/plugin/                      generated small cacheable bundle
```

Node 24 is recommended; Node 22.12+ in the 22.x line is also supported. The minimum matches locked Vite tooling rather than assuming all Node 22 patch releases work. npm/Git are required; setup downloads Chromium. Linux system libraries must be installed separately if absent. Codex login is needed only for model execution, not standalone CLI/doctor/smoke. Installation has been exercised on Linux x86-64, Ubuntu 26.04, Node 24.19.0, npm 12.0.2 and Codex 0.160.0. Windows/macOS installation remains unverified; added CI covers Node/build/unit/package logic but has not yet run remotely.

## Reproducible clean-room procedure

`npm run test:install` clones committed HEAD into a new temporary path containing spaces. It asserts absence of `node_modules`, `dist`, `.env` and `.ratatoskr`, installs from the lockfile into a fresh npm cache, downloads Chromium into a new browser directory, builds and follows the README plugin commands. Runtime data and Codex config are separate temporary directories. It checks doctor, clone and cached-launcher smoke tests, actual Codex skill/MCP discovery, unit/type/lint/package checks, screenshot/trace MCP integration, manual registration and removal. No global Codex configuration is changed.

`npm run test:install -- --codex` also copies existing file-based Codex authentication privately into the disposable profile and runs four fresh tasks: a medium HTTP-failure control with manual MCP but no skill, the same task with the plugin/skill, a plugin success workflow, and a standard Playwright MCP failure. These consume account usage. Only the disposable plugin copy auto-approves the fixture workflow; source/production approval defaults remain unchanged. Normal users must review approval requests. All temporary authentication copies and generated test data are removed in `finally`.

Token accounting uses authoritative `turn.completed.usage` from each fresh `codex exec --json` process. Cached input is a subset of input; reasoning output is a subset of output. Total equals input plus output. Skill reads and all intermediate model/tool work inside that task are included. This is not a tokenizer estimate. Control, plugin and direct failure runs use the same model, reasoning, fixture/source contract, prompt, output schema and normal shell availability. Direct exposes the same 17 safe core tools from pinned official Playwright MCP as the previous benchmark, including bulk fill; no JavaScript, arbitrary files or install tools. The previous published optimization suite disabled shell tools and used a wrapper, so its medians are historical context, not an identical configuration comparison.

## Verification results

Two independent clean-clone installations passed, including a final authenticated run of commit `9659193`, in paths containing spaces with freshly downloaded Chromium. Setup, doctor, clone/cached-launcher smoke, actual skill discovery (`ratatoskr:ratatoskr`), all three MCP tools, all 59 unit tests, type/lint/package checks, explicit screenshot retrieval and trace metadata passed. Both normal CLI examples and the browser/benchmark integration suites also passed. Temporary credentials and test trees were removed; global Codex configuration was untouched. One initial unexpected-popup timing assertion failed, then passed on reruns; late popup detection remains a timing-sensitive limitation, not an installation requirement.

The staged bundle is about 20 KB on disk, versus a 166 MB accidental whole-repository copy discovered during the audit. The npm dry-run inventory includes only runtime JS, metadata, skill/bootstrap, README/license and architecture notes—not test/benchmark dumps, `.env`, dependencies or browser artifacts. MIT was explicitly selected by the maintainer. Updating Vitest to patched 4.1.11 removed its development-only mocker advisory; the final npm audit reported zero vulnerabilities.

### Authenticated Codex and token check

The final fresh processes read the skill automatically, generated valid compact plans on the first attempt, executed one workflow, and stopped without inspection/artifact calls. Success was verified after reload; failure correctly identified `POST /api/profile`, HTTP 500 and `INTERNAL_ERROR`. Normal browser approval policy remains enabled in production; unattended tests modify only their disposable fixture installation.

The [machine-readable records](distribution-results.json) contain authoritative usage projections, reproducibility metadata and earlier prototype trials. One sample per configuration is **not** a replacement for the repeated benchmark:

| Medium task / configuration              | Input tokens | Output tokens | Total tokens | Browser tool calls | Invalid calls |
| ---------------------------------------- | -----------: | ------------: | -----------: | -----------------: | ------------: |
| Direct Playwright MCP / failure          |      100,657 |           581 |      101,238 |                  7 |             0 |
| Manual Ratatoskr MCP, no skill / failure |       38,825 |           419 |       39,244 |                  1 |             0 |
| Ratatoskr plugin + skill / failure       |       40,513 |           487 |       41,000 |                  1 |             0 |
| Ratatoskr plugin + skill / success       |       40,409 |           612 |       41,021 |                  1 |             0 |

For this matched failure sample, plugin tokens were **59.5% below direct**, but **4.5% above manual Ratatoskr**. The skill read is additional model-visible work. Prototype manual/plugin tasks showed a 9.9% observed delta, so overhead varies; no universal savings claim follows from these samples. Previously optimized medium-failure median was 31,959.5 tokens against 78,372 direct (ten tasks each), under a different shell-disabled wrapper configuration. Do not attribute that configuration difference solely to packaging.

Skill metadata is **280 bytes**, full skill **2,057 bytes**. MCP definitions stayed **4,034 bytes** before/after: run 2,013 (input schema 1,276), inspect 1,024 (493), artifact 993 (211). Packaging adds no tools or production response fields. Full token usage includes the skill read; its byte size is not a token estimate. To reproduce installation and these four task checks: `npm run test:install -- --codex`. It requires file-based Codex login, network access for dependency/browser downloads and consumes account usage. Set `BENCHMARK_MODEL`/`BENCHMARK_CODEX_REASONING_EFFORT` if changing model settings; do not compare unmatched runs.

## Remaining release work

- Push/review these commits before GitHub's default branch can supply the new instructions; no push, release, npm publication or public submission is automatic.
- Validate full installation on Windows and macOS; CI is not proof of a desktop installation.
- The prepared clone must remain available. Setup selects one runtime per user `RATATOSKR_HOME`; moves/upgrades require setup and cached-plugin reinstall.
- Public universal plugin submission currently expects remote HTTPS MCP or an OpenAI arrangement for local MCP, unlike this local repository marketplace. Do not claim universal-directory readiness.
- A future prebuilt npm runtime could remove cloning/TypeScript build steps. The package inventory is audited, but npm install/publish is deliberately not the supported user path yet (`private: true`).
