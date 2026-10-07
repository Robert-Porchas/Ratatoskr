import { test, expect } from 'playwright/test';

test('create a project', async ({ page }) => {
  await page.goto('/entry');
  await page.getByLabel('Project name').fill(process.env.BENCHMARK_NAME!);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('project-id')).toContainText('P-');
  await expect(page.getByTestId('dashboard')).toBeVisible();
});
