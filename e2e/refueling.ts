import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function add(page: Page, date: string, km: string, liters: string, price: string, full = true) {
  await page.getByRole('button', { name: 'AGGIUNGI RIFORNIMENTO' }).click();
  const form = page.locator('#refueling-form');
  await form.locator('[name=date]').fill(date);
  await form.locator('[name=time]').fill('');
  await form.locator('[name=odometer]').fill(km);
  await form.locator('[name=liters]').fill(liters);
  await form.locator('[name=price]').fill(price);
  await form.locator('[name=full]').setChecked(full);
  await form.getByRole('button', { name: 'REGISTRA RIFORNIMENTO' }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
}
