import { test, expect } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto(process.env.E2E_BASE_URL || 'http://localhost:3000');
  await expect(page).toHaveTitle(/.+/);
});
