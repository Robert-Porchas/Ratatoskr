# Repository Guidelines

## Project Structure & Module Organization

This is one TypeScript package. `src/protocol.ts` defines plans; `src/browser.ts` is the browser port, implemented by `src/playwright-adapter.ts`. `src/application.ts` composes shared services for `src/cli.ts` and `src/mcp/server.ts`. Unit tests are `test/*.test.ts`; browser/MCP integration tests are `test/integration.ts` and `test/mcp-integration.ts`. The local fixture is `test/fixture/server.ts`, examples in `examples/`, and design notes in `docs/architecture.md`.

## Build, Test, and Development Commands

Run `npm install` and `npx playwright install chromium` once. Use `npm test` (Vitest), `npm run test:e2e` (Chromium), `npm run test:mcp` (stdio client), `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build`. Start the fixture with `npm run fixture`; then run `npm run cli -- run examples/login-success.json` with local `TEST_EMAIL` and `TEST_PASSWORD`. `npm run mcp` starts the built server; keep its stdout protocol-only.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes, and Prettier's trailing commas. Name types and classes in `PascalCase`, functions and variables in `camelCase`, and modules with descriptive lowercase filenames. Prefer small modules, typed interfaces, and discriminated unions. Keep Playwright imports inside the adapter; keep protocol and evidence reduction independent of it. Avoid `any` and arbitrary JavaScript or shell actions in plans.

## Testing Guidelines

Add Vitest tests as `test/<area>.test.ts`. Cover schemas, reduction, persistence, and secrets. Extend browser and MCP integration tests when those behaviors change. There is no coverage gate; run relevant tests, type checking, linting, and formatting before committing.

The browser evidence benchmark lives in `benchmarks/browser-evidence/`. Run `npm run test:benchmark` for its local browser/MCP checks and `npm run benchmark:browser` for ten offline pairs. Model mode is explicit and requires local API credentials. Keep provider token usage separate from replay byte metrics; never fabricate token counts or alter production reduction to favor a benchmark.

## Commit & Pull Request Guidelines

History uses Conventional Commit subjects such as `feat(browser): ...`, `fix(evidence): ...`, and `docs: ...`. Keep commits scoped and passing relevant checks. In pull requests, summarize the behavior and architecture impact, list verification commands, and link an issue when one exists. Include screenshots only for visible fixture or output changes.

## Security & Local Data

Plans use `valueRef` names, never plaintext secrets. Do not log resolved values or commit generated `.ratatoskr/`, `dist/`, or `node_modules/`. Review redaction when changing screenshots.

## Browser Testing with Codex

For known app tests, derive routes, labels, accessible names and test IDs from relevant source/tests first; do not rediscover those facts through browser calls. With `ratatoskr` MCP, submit one complete workflow: `url`, `steps` with `do` and flat semantic locators. `fill` uses local `valueRef`; `has` checks text with `contains`; `extractText` + `save` explicitly requests a bounded output, including on failure. Assert persisted state, not just edited inputs. On success stop; on failure use compact evidence to inspect source first. Request only necessary inspection categories or one diagnostic artifact. Never automatically fetch screenshots/traces/logs. Codex plans; Ratatoskr executes.
