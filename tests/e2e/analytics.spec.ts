import { test, expect } from '@playwright/test';
test('analytics filters, reports and responsive layout use mock records', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/supabase\.co|\/api\/v1\//, () => { throw new Error('Unexpected backend request'); });
  await page.goto('/central');
  await expect(page.getByRole('heading', { name: 'Centralized Dashboard', exact: true })).toBeVisible();
  await expect(page.locator('.analytics-kpi')).toHaveCount(6);
  const toggle = page.getByRole('switch', { name: 'Show mock data' });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText('No bills match these filters.')).toBeVisible();
  await expect(page.locator('.analytics-kpi').first()).toContainText('0.00');
  const originalStorage = await page.evaluate(() => JSON.stringify(localStorage));
  await toggle.check();
  await expect(page.getByText('Sample data preview', { exact: true })).toBeVisible();
  await expect(page.locator('.analytics-kpi').nth(3)).toContainText('72');
  await expect(page.locator('.analytics-grid.records .analytics-table').first()).toContainText('ALP-DEMO-');
  await page.getByRole('combobox', { name: 'Dashboard company' }).click();
  await page.getByRole('option', { name: 'Veera Tech Services' }).click();
  await expect(page.locator('.analytics-grid.records .analytics-table').first()).toContainText('VTS-DEMO-');
  await expect(page.locator('.analytics-grid.records .analytics-table').first()).not.toContainText('ALP-DEMO-');
  await toggle.uncheck();
  await expect(page.getByText('No bills match these filters.')).toBeVisible();
  await expect(page.locator('.analytics-kpi').first()).toContainText('0.00');
  await toggle.focus(); await page.keyboard.press('Space');
  await expect(toggle).toBeChecked();
  await expect(page.locator('.analytics-grid.records .analytics-table').first()).toContainText('VTS-DEMO-');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(originalStorage);
  await page.getByLabel('Search dashboard records').fill('no match');
  await expect(page.getByText('No bills match these filters.')).toBeVisible();
  await page.getByLabel('Search dashboard records').fill('');
  await page.getByLabel('From date', { exact: true }).fill('2026-11-13');
  await expect(page.getByText('No bills match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Last 6 months' }).click();
  await expect(page.locator('.analytics-grid.records .analytics-table').first()).toContainText('VTS-DEMO-');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('combobox', { name: 'Dashboard company' }).click();
  await page.getByRole('option', { name: 'All Entities', exact: true }).click();
  await page.screenshot({ path: 'test-results/dashboard-' + info.project.name + '.png', fullPage: true });
  await page.goto('/entities/460e73a5-5733-41df-bcd0-f87134395c01/reports');
  await expect(page.getByRole('heading', { name: 'Reports & Analytics' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open report', exact: true })).toHaveCount(9);
  await expect(page.locator('.analytics-grid.records .analytics-table').first()).not.toContainText('VTS-DEMO-');
  await page.getByRole('link', { name: 'Open report', exact: true }).first().click();
  await expect(page.locator('.invoice-print-sheet')).toBeVisible();
  expect(errors).toEqual([]);
});


test('shared palette and isolated company dashboards with central comparison', async ({ page }, info) => {
  const base = '/entities/460e73a5-5733-41df-bcd0-f87134395c01';
  await page.goto('/central');
  const comparison = page.locator('.comparison-table');
  await expect(comparison).toContainText('Alpha Solutions Pvt. Ltd.');
  await expect(comparison).toContainText('Veera Tech Services');
  await expect(comparison.getByRole('link', { name: 'Open company dashboard' })).toHaveCount(2);
  await comparison.getByRole('link', { name: 'Open company dashboard' }).first().click();
  await expect(page.getByRole('heading', { name: 'Alpha Solutions Pvt. Ltd. dashboard', exact: true })).toBeVisible();
  await expect(page.locator('.analytics-kpi').first()).toContainText('15,000');
  await expect(page.locator('.comparison-table')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Collections & Outstanding', exact: true })).toBeVisible();
  await expect(page.locator('.analytics-grid.records')).not.toContainText('VTS-0001');
  await page.getByRole('combobox', { name: 'Current company' }).click();
  await page.getByRole('option', { name: 'Veera Tech Services', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Veera Tech Services dashboard', exact: true })).toBeVisible();
  await expect(page.locator('.analytics-kpi').first()).toContainText('12,000');
  await expect(page.locator('.analytics-grid.records')).not.toContainText('ALP-0001');
  for (const suffix of ['', '/invoices', '/invoices/new', '/customers', '/challans', '/reports', '/settings']) {
    await page.goto(base + suffix);
    await expect(page.locator('.workspace-shell')).toHaveClass(/app-theme/);
    const palette = await page.locator('.workspace-sidebar').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, text: getComputedStyle(element.querySelector('.workspace-nav-link:not(.active)')!).color }));
    expect(palette.background).toBe('rgb(252, 250, 255)');
    expect(palette.text).toBe('rgb(53, 40, 73)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.goto(base + '/invoices');
  await page.screenshot({ path: 'test-results/shared-theme-' + info.project.name + '.png', fullPage: true });
});

