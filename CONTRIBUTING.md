# Contributing

Use Node 22+ and npm. User installation is at the top of [README](README.md); contributor checks are separate:

```sh
npm ci
npm run setup
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:dist
npm run test:e2e
npm run test:mcp
npm run test:benchmark
```

Browser tests start local fixtures, not production sites. `npm run fixture` serves the manual examples; see the README for credential references and CLI commands. `npm run smoke` checks installation without a model account. Native token benchmarks require Codex login and consume account usage: [methodology](benchmarks/browser-evidence/README.md). Never convert evidence bytes into claimed actual tokens.

`src/` is one strict TypeScript package. CLI and MCP compose shared application services. Keep Playwright imports inside its adapter, reduction deterministic, and canonical plans strict. Add Vitest tests under `test/`; cover browser/MCP changes with integration tests. Use Prettier and ESLint. Follow [AGENTS.md](AGENTS.md).

Plugin sources are `.codex-plugin/plugin.json`, `.mcp.json` and `skills/ratatoskr/`. Build stages only these components and bootstrap scripts in `dist/plugin/`; the repository marketplace points there. Keep the skill small, with a discriminating description and pull-based evidence guidance. `npm run test:dist` checks metadata, version agreement, skill size and package hygiene. Test actual Codex discovery with `node scripts/codex-discovery.mjs` after installation.

Run `npm run test:install` for a new local Git clone with separate dependency/browser caches, runtime data and Codex config. It tests **committed HEAD**: commit the coherent change first. Add `-- --codex` only when authenticated, to run four fresh tasks: plugin success/failure, manual MCP control, and standard Playwright MCP failure. These consume account usage. Temporary authentication copies are removed afterward; no credentials are logged.

Use scoped Conventional Commits (`fix(runtime): ...`, `feat(plugin): ...`, `test(dist): ...`). Before committing, review the diff, run relevant checks and stage only related files. PRs should explain behavior/architecture changes and include verification commands. Do not publish npm packages or submit the plugin directory without maintainer approval.

Version comes from `package.json`; update the plugin manifest to match. Keep `private: true` until npm distribution is separately verified. Do not commit `.env`, browser evidence, authentication, `node_modules` or `dist`.
