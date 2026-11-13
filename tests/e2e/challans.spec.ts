import { expect, test } from '@playwright/test';

test('saves and prints multiple challan items with a bill from the same company', async ({ page }) => {
  await page.route(/\/api\/v1\/|supabase\.co/, route => { throw new Error('Unexpected backend request: ' + route.request().url()); });
  await page.addInitScript(() => { window.print = () => document.body.setAttribute('data-printed', 'yes'); });

  await page.goto('/');
  await page.getByRole('link', { name: 'Open Alpha Solutions Pvt. Ltd.' }).click();
  await page.getByRole('link', { name: 'Delivery Challans', exact: true }).click();
  await page.getByRole('link', { name: 'Create challan' }).click();
  await page.getByLabel('Recipient').fill('Test dispatch');
  await page.getByLabel('Delivery address').fill('Tiruppur');
  const first = page.getByRole('group', { name: 'Item 1', exact: true });
  await first.getByLabel('Description').fill('Printed T-shirts');
  await first.getByLabel('Quantity').fill('12');
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByRole('button', { name: 'Remove item 2' }).click();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  const second = page.getByRole('group', { name: 'Item 2', exact: true });
  await second.getByLabel('Description').fill('Fabric labels');
  await second.getByLabel('Quantity').fill('3');
  await second.getByRole('combobox', { name: 'Unit' }).click();
  await page.getByRole('option', { name: 'Boxes', exact: true }).click();
  await second.getByLabel('Remarks').fill('Pack separately');
  await page.getByRole('combobox', { name: 'Related bill (optional)' }).click();
  await expect(page.getByRole('option', { name: /VTS-0001/ })).toHaveCount(0);
  await page.getByRole('option', { name: /ALP-0001/ }).click();
  await page.getByRole('button', { name: 'Save delivery challan' }).click();
  await expect(page.getByRole('heading', { name: 'ALP-DC-0002', exact: true })).toBeVisible();
  await page.reload();
  const paper = page.locator('.invoice-print-sheet');
  await expect(paper.getByRole('row', { name: /Printed T-shirts.*12.*Pieces/ })).toBeVisible();
  await expect(paper.getByRole('row', { name: /Fabric labels.*3.*Boxes.*Pack separately/ })).toBeVisible();
  await expect(paper.getByRole('link', { name: 'ALP-0001' })).toHaveAttribute('href', /\/invoices\/sample-bill-1$/);
  await page.getByRole('button', { name: 'Print / Save PDF' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-printed', 'yes');
  await page.emulateMedia({ media: 'print' });
  await expect(paper).toBeVisible();
  await expect(page.getByRole('navigation')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('link', { name: 'Back to delivery challans' }).click();
  await expect(page.getByRole('row', { name: /ALP-DC-0002.*Printed T-shirts, Fabric labels/ })).toBeVisible();
});

test('opens a challan saved in the previous single-item format', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('thogai-mock-challans-v1', JSON.stringify([{
      id: 'old-challan', entityId: '460e73a5-5733-41df-bcd0-f87134395c01',
      number: 'ALP-DC-0008', date: '2026-11-06', recipient: 'Previous delivery',
      from: 'Coimbatore', to: 'Tiruppur', items: 'Printed garments', quantity: '7', unit: 'Bundles',
      notes: '', billId: '',
    }]));
  });
  await page.goto('/entities/460e73a5-5733-41df-bcd0-f87134395c01/challans/old-challan');
  await expect(page.getByRole('row', { name: /Printed garments.*7.*Bundles/ })).toBeVisible();
});

