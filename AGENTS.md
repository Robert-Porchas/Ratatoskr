# Repository Guidelines

## Project Structure & Module Organization

This is a single Node.js/TypeScript package. `src/protocol.ts` defines validated plans and domain records; `src/browser.ts` defines the browser boundary, while `src/playwright-adapter.ts` implements it. Execution, evidence reduction, value resolution, and filesystem persistence live in their corresponding `src/` modules. `src/cli.ts` composes them. Unit tests are `test/*.test.ts`; the local website is `test/fixture/server.ts`, and the real-browser test is `test/integration.ts`. Example plans are in `examples/`; design notes are in `docs/architecture.md`.

## Build, Test, and Development Commands

Run `npm install` and `npx playwright install chromium` once. Use `npm test` for Vitest unit tests, `npm run test:e2e` for the local-site Chromium test, `npm run typecheck` for strict TypeScript checks, `npm run lint` for ESLint, `npm run format:check` for Prettier, and `npm run build` to compile. Start the example site with `npm run fixture`; in another terminal, run `npm run cli -- run examples/login-success.json`. Set `TEST_EMAIL` and `TEST_PASSWORD` in that terminal first. The failure example exits with status 1 intentionally.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes, and Prettier's trailing commas. Name types and classes in `PascalCase`, functions and variables in `camelCase`, and modules with descriptive lowercase filenames. Prefer small modules, typed interfaces, and discriminated unions. Keep Playwright imports inside the adapter; keep protocol and evidence reduction independent of it. Avoid `any` and arbitrary JavaScript or shell actions in plans.

## Testing Guidelines

Add focused Vitest tests beside related behavior as `test/<area>.test.ts`. Cover schema changes, reducer rules, persistence, and secret handling with deterministic unit tests. Extend `test/integration.ts` when browser behavior or artifact handling changes. There is no numeric coverage gate; run tests, type checking, linting, and formatting before committing.

## Commit & Pull Request Guidelines

History uses Conventional Commit subjects such as `feat(browser): ...`, `fix(evidence): ...`, and `docs: ...`. Keep commits scoped and passing relevant checks. In pull requests, summarize the behavior and architecture impact, list verification commands, and link an issue when one exists. Include screenshots only for visible fixture or output changes.

## Security & Local Data

Plans use environment-variable `valueRef` names, never plaintext secrets. Do not log resolved values or add generated `.browser-bridge/` runs, traces, screenshots, `dist/`, or `node_modules/` to Git. Inspect artifact redaction when changing screenshot behavior.
