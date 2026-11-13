import { expect, test } from '@playwright/test';

test('creates a company customer from a bill without losing bill entries', async ({ page }) => {
  const company = '460e73a5-5733-41df-bcd0-f87134395c01';
  await page.goto('/entities/' + company + '/invoices/new');
  await page.getByLabel('description for item 1').fill('Keep this item');
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search customers' }).fill('No matching customer');
  await expect(page.getByText('No customers found. Create one below.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox', { name: 'Customer', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Create customer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create customer', exact: true });
  await dialog.locator('input[name=legal_name]').fill('New bill customer');
  await dialog.locator('input[name=phone]').fill('9876543210');
  await dialog.locator('textarea[name=customer_address]').fill('Coimbatore');
  await dialog.locator('input[name=contact_name]').fill('Sample contact');
  await dialog.locator('input[name=contact_phone]').fill('9876543210');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('combobox', { name: 'Customer', exact: true })).toHaveText('New bill customer');
  await expect(page.getByLabel('description for item 1')).toHaveValue('Keep this item');
  await expect(page.getByRole('region', { name: 'Live bill preview' })).toContainText('New bill customer');
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click();
  await page.getByRole('button', { name: 'Create customer', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('combobox', { name: 'Current company' }).click();
  await page.getByRole('option', { name: 'Veera Tech Services', exact: true }).click();
  await page.getByRole('combobox', { name: 'Customer', exact: true }).click();
  await expect(page.getByRole('option', { name: 'New bill customer' })).toHaveCount(0);
});


