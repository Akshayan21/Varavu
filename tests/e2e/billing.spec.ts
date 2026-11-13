import { expect, test } from '@playwright/test';

test('saves, reopens, issues and prints a company bill using local mock data', async ({ page }) => {
  await page.route(/\/api\/v1\/|supabase\.co/, route => { throw new Error('Unexpected backend request: ' + route.request().url()); });
  await page.addInitScript(() => { window.print = () => document.body.setAttribute('data-printed', 'yes'); });
  await page.goto('/');
  await page.getByRole('link', { name: 'Open Alpha Solutions Pvt. Ltd.' }).click();
  await page.getByRole('link', { name: 'Create a bill', exact: true }).click();
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click();
  await page.getByRole('option', { name: 'Sri Kumaran Foods' }).click();
  await page.getByLabel('description for item 1').fill('Mock chest print');
  await page.getByLabel('quantity for item 1').fill('3');
  await page.getByLabel('rate for item 1').fill('112.50');
  await page.getByRole('button', { name: 'Add another item' }).click();
  await page.getByLabel('description for item 2').fill('Back print');
  await page.getByLabel('quantity for item 2').fill('2.5');
  await page.getByLabel('rate for item 2').fill('10');
  await page.getByLabel('Discount (₹)').fill('12.50');
  await page.getByLabel('Tax (%)').fill('10');
  await expect(page.getByRole('region', { name: 'Live bill preview' }).locator('.pieces-total')).toContainText('5.5 pcs');
  await page.getByRole('button', { name: 'Review bill' }).click();
  await expect(page.locator('.garment-grand')).toContainText('385.00');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('heading', { name: 'Bill draft' })).toBeVisible();
  const draft = page.url();
  await page.reload();
  await expect(page.locator('.invoice-print-sheet')).toContainText('Mock chest print');
  await expect(page.locator('.pieces-total')).toContainText('5.5 pcs');
  await page.getByRole('link', { name: 'Back to Billing' }).click();
  await page.getByRole('searchbox').fill('Sri Kumaran Foods');
  await page.getByRole('link', { name: 'Open draft for Sri Kumaran Foods' }).click();
  await expect(page).toHaveURL(draft);
  await page.getByRole('button', { name: 'Issue sample bill' }).click();
  await page.getByRole('button', { name: 'Confirm issue' }).click();
  await expect(page.getByRole('heading', { name: 'ALP-0002' })).toBeVisible();
  await page.getByRole('button', { name: 'Print / Save PDF' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'yes');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('navigation')).toBeHidden();
  await expect(page.locator('.invoice-print-sheet')).toBeVisible();
  await expect(page.locator('.pieces-total')).toContainText('5.5 pcs');
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Amount (₹)', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByText(/Outstanding.*285\.00/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Current company' }).click();
  await page.getByRole('option', { name: 'Veera Tech Services', exact: true }).click();
  await page.getByRole('link', { name: 'Billing', exact: true }).click();
  await expect(page.getByText('ALP-0002', { exact: true })).toHaveCount(0);
});




