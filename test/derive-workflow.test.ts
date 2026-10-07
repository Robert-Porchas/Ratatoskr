import { expect, it } from 'vitest';
import { deriveWorkflows } from '../src/derive-workflow.js';
import { normalizeWirePlan } from '../src/mcp/wire-plan.js';

it('converts a sequential Playwright test into the existing compact syntax', () => {
  const result = deriveWorkflows(
    `import { test, expect } from '@playwright/test';
test('login', async ({ page }) => {
 await page.goto('/login');
 await page.getByLabel('Email').fill(process.env.TEST_EMAIL);
 await page.getByLabel('Password').fill(process.env.TEST_PASSWORD);
 await page.getByRole('button', {name:'Sign in'}).click();
 await expect(page.getByTestId('dashboard')).toBeVisible();
 await expect(page.getByText('Welcome')).toContainText('Welcome');
});`,
    'login.spec.ts',
    'http://localhost',
  );
  expect(result[0]).toMatchObject({
    ready: true,
    convertedSteps: 5,
    unsupported: [],
  });
  expect(normalizeWirePlan(result[0]?.plan).steps).toHaveLength(5);
});

it('never executes unsupported code or emits secret literals; returns a validated prefix', () => {
  const source = `test('unsafe', async ({page}) => {
await page.goto('http://localhost');
await page.getByTestId('ready').click();
await page.getByLabel('Password').fill('super-secret');
for (;;) { process.exit(1); }
});`;
  const result = deriveWorkflows(source, 'unsafe.ts');
  expect(result[0]).toMatchObject({ ready: false, convertedSteps: 1 });
  expect(JSON.stringify(result)).not.toContain('super-secret');
  expect(result[0]?.unsupported[0]?.location).toBe('unsafe.ts:4:1');
});

it('warns about weakened URL assertions, complex locators, hooks and source bounds', () => {
  for (const statement of [
    `await expect(page).toHaveURL('http://localhost/done');`,
    `await expect(page).toHaveURL(/done/);`,
    `for (const item of list) { await page.getByText(item).click(); }`,
    `await page.getByRole('button', {name:'Save',exact:true}).click();`,
    `await page.locator('#save').click();`,
  ]) {
    const results = deriveWorkflows(
      `test('x',async ({page}) => {await page.goto('http://localhost');await page.getByTestId('ready').click();${statement}});`,
      'x.ts',
    );
    expect(results[0]?.ready).toBe(false);
    expect(results[0]?.unsupported.length).toBeGreaterThan(0);
  }
  expect(
    deriveWorkflows(
      `test.beforeEach(() => {});test('x',async ({page}) => {await page.goto('http://localhost');await page.getByTestId('ready').click();});`,
      'x.ts',
    ).every((workflow) => !workflow.ready),
  ).toBe(true);
  expect(() => deriveWorkflows('x'.repeat(256001), 'x.ts')).toThrow('bytes');
});
