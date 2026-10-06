# Repository Guidelines

## Project Structure & Module Organization

This is one TypeScript package. `src/protocol.ts` defines plans; `src/browser.ts` is the browser port, implemented by `src/playwright-adapter.ts`. `src/application.ts` composes shared services for `src/cli.ts` and `src/mcp/server.ts`. Unit tests are `test/*.test.ts`; browser/MCP integration tests are `test/integration.ts` and `test/mcp-integration.ts`. The local fixture is `test/fixture/server.ts`, examples in `examples/`, and design notes in `docs/architecture.md`.

## Build, Test, and Development Commands

Run `npm ci` and `npm run setup` once (builds/downloads Chromium; does not edit Codex config). Use `npm run doctor` and `npm run smoke` for installation checks; `npm run test:dist` audits package/plugin contents and `npm run test:install` verifies committed HEAD in an isolated clone. `npm test` (Vitest), `npm run test:e2e`, `npm run test:mcp`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` cover development. Start `npm run fixture`, then `npm run cli -- run examples/login-success.json` with local `TEST_EMAIL`/`TEST_PASSWORD`. CLI/MCP run compiled JavaScript; rebuild after edits. Keep MCP stdout protocol-only. Plugin sources are `.codex-plugin/`, `.mcp.json`, and `skills/`; build stages `dist/plugin/`, never dependencies or run data.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes, and Prettier's trailing commas. Name types and classes in `PascalCase`, functions and variables in `camelCase`, and modules with descriptive lowercase filenames. Prefer small modules, typed interfaces, and discriminated unions. Keep Playwright imports inside the adapter; keep protocol and evidence reduction independent of it. Avoid `any` and arbitrary JavaScript or shell actions in plans.

## Testing Guidelines

Add Vitest tests as `test/<area>.test.ts`. Cover schemas, reduction, persistence, and secrets. Extend browser and MCP integration tests when those behaviors change. There is no coverage gate; run relevant tests, type checking, linting, and formatting before committing.

The benchmark lives in `benchmarks/browser-evidence/`. `npm run test:benchmark` checks local fixtures; `npm run benchmark:browser` runs offline replay. `BENCHMARK_MODEL=... npm run benchmark:tokens` measures fresh Codex tasks against standard Playwright MCP (requires Codex login, consumes account usage). Keep authoritative tokens separate from evidence bytes; preserve unfavorable runs and never alter production reduction to favor a benchmark.

## Commit & Pull Request Guidelines

History uses Conventional Commit subjects such as `feat(browser): ...`, `fix(evidence): ...`, and `docs: ...`. Keep commits scoped and passing relevant checks. In pull requests, summarize the behavior and architecture impact, list verification commands, and link an issue when one exists. Include screenshots only for visible fixture or output changes.

## Security & Local Data

Plans use `valueRef` names, never plaintext secrets. Do not log resolved values or commit generated `.ratatoskr/`, `dist/`, or `node_modules/`. Review redaction when changing screenshots.

Session metadata/deltas are sanitized; raw auth state belongs only in opt-in sensitive artifacts, never ordinary persistence or MCP delivery. Run `npm run test:session` when changing observation/redaction. Use compact session findings first; inspect `session` only when needed, never request protected auth state for routine diagnosis.

## Browser Testing with Codex

For known app tests, derive routes, labels, accessible names and test IDs from relevant source/tests first; do not rediscover those facts through browser calls. With `ratatoskr` MCP, submit one complete workflow: `url`, `steps` with `do` and flat semantic locators. `fill` uses local `valueRef`; `has` checks text with `contains`; `extractText` + `save` explicitly requests a bounded output, including on failure. Assert persisted state, not just edited inputs. On success stop; on failure use compact evidence to inspect source first. Request only necessary inspection categories or one diagnostic artifact. Never automatically fetch screenshots/traces/logs. Codex plans; Ratatoskr executes.
