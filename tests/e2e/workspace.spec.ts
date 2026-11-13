import { expect, test } from '@playwright/test';

test('runs with mock data, isolates companies, and keeps changes after a reload', async ({ page }) => {
  await page.route(/\/api\/v1\/|supabase\.co/, route => {
    throw new Error('Unexpected backend request: ' + route.request().url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Select a company' })).toBeVisible();
  await page.getByRole('link', { name: 'Open Alpha Solutions Pvt. Ltd.' }).click();
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await expect(page.getByRole('heading',{name:'Customers',exact:true})).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Sri Kumaran Foods', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Customer' }).click();
  await page.locator('input[name=legal_name]').fill('Local Sample');
  await page.locator('input[name=phone]').fill('9876543210');
  await page.locator('textarea[name=customer_address]').fill('Coimbatore');
  await page.locator('input[name=contact_name]').fill('Sample contact');
  await page.locator('input[name=contact_phone]').fill('9876543210');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: 'Local Sample', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('cell', { name: 'Local Sample', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Current company' }).click();
  await page.getByRole('option', { name: 'Veera Tech Services', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Anand Textiles', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Local Sample', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Billing', exact: true }).click();
  await page.getByRole('link', { name: 'Create Bill' }).click();
  await expect(page.getByLabel('Company (Issuer)')).toHaveValue('Veera Tech Services');
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click();
  await expect(page.getByRole('option', { name: 'Anand Textiles' })).toHaveCount(1);
  await expect(page.getByRole('option', { name: 'Local Sample' })).toHaveCount(0);
});



