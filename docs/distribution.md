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

Node 22+ and npm/Git are required; setup downloads Chromium. Linux system libraries must be installed separately if absent. Codex login is needed only for model execution, not standalone CLI/doctor/smoke. Installation has been exercised on Linux x86-64, Ubuntu 26.04, Node 24.19.0, npm 12.0.2 and Codex 0.160.0. Windows/macOS installation remains unverified; added CI covers Node/build/unit/package logic but has not yet run remotely.

## Reproducible clean-room procedure

`npm run test:install` clones committed HEAD into a new temporary path containing spaces. It asserts absence of `node_modules`, `dist`, `.env` and `.ratatoskr`, installs from the lockfile into a fresh npm cache, downloads Chromium into a new browser directory, builds and follows the README plugin commands. Runtime data and Codex config are separate temporary directories. It checks doctor, clone and cached-launcher smoke tests, actual Codex skill/MCP discovery, unit/type/lint/package checks, screenshot/trace MCP integration, manual registration and removal. No global Codex configuration is changed.

`npm run test:install -- --codex` also copies existing file-based Codex authentication privately into the disposable profile and runs four fresh tasks: a medium HTTP-failure control with manual MCP but no skill, the same task with the plugin/skill, a plugin success workflow, and a standard Playwright MCP failure. These consume account usage. Only the disposable plugin copy auto-approves the fixture workflow; source/production approval defaults remain unchanged. Normal users must review approval requests. All temporary authentication copies and generated test data are removed in `finally`.

Token accounting uses authoritative `turn.completed.usage` from each fresh `codex exec --json` process. Cached input is a subset of input; reasoning output is a subset of output. Total equals input plus output. Skill reads and all intermediate model/tool work inside that task are included. This is not a tokenizer estimate. Control, plugin and direct failure runs use the same model, reasoning, fixture/source contract, prompt, output schema and normal shell availability. Direct exposes the same 17 safe core tools from pinned official Playwright MCP as the previous benchmark, including bulk fill; no JavaScript, arbitrary files or install tools. The previous published optimization suite disabled shell tools and used a wrapper, so its medians are historical context, not an identical configuration comparison.

## Verification results

The initial isolated clean-clone run passed setup, new Chromium launch, doctor, smoke, actual skill discovery (`ratatoskr:ratatoskr`), three MCP tools, all 59 unit tests, type/lint/package checks, explicit screenshot retrieval and trace metadata. The bundle contained no dependencies, build/runtime evidence or secrets. Final authenticated clean-room and token results are recorded below after verification.

## Remaining release work

- Push/review these commits before GitHub's default branch can supply the new instructions; no push, release, npm publication or public submission is automatic.
- Validate full installation on Windows and macOS; CI is not proof of a desktop installation.
- The prepared clone must remain available. Setup selects one runtime per user `RATATOSKR_HOME`; moves/upgrades require setup and cached-plugin reinstall.
- Public universal plugin submission currently expects remote HTTPS MCP or an OpenAI arrangement for local MCP, unlike this local repository marketplace. Do not claim universal-directory readiness.
- A future prebuilt npm runtime could remove cloning/TypeScript build steps. The package inventory is audited, but npm install/publish is deliberately not the supported user path yet (`private: true`).
