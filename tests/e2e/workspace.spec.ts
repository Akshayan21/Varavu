import { expect, test } from '@playwright/test';

test('redirects a signed-out visitor to the private sign-in page', async ({ page, request }) => {
  const health = await request.get('http://127.0.0.1:3001/api/v1/health');
  expect(await health.json()).toEqual({ status: 'ok' });
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
});

