import { expect, test } from '@playwright/test';
import { add } from './refueling';

test('apertura e controlli automatici senza novità restano silenziosi', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
  await expect(page.locator('#pwa-state')).toHaveText('Pronta per l’uso offline', { timeout: 15000 });
  await expect(page.locator('.notification')).not.toHaveClass(/visible/);
  await page.reload();
  await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
  await expect(page.locator('#pwa-state')).toHaveText('Pronta per l’uso offline');
  await expect(page.locator('.notification')).not.toHaveClass(/visible/);

  // Attende la fine del controllo reale, senza ritardi temporali arbitrari.
  for (const event of ['online', 'visibilitychange']) {
    await page.evaluate(async (event) => {
      const registration = await navigator.serviceWorker.ready;
      const original = registration.update;
      let complete!: () => void;
      const completed = new Promise<void>((resolve) => { complete = resolve; });
      registration.update = async () => {
        try { return await original.call(registration); }
        finally { setTimeout(complete, 0); }
      };
      try {
        (event === 'online' ? window : document).dispatchEvent(new Event(event));
        await completed;
      } finally { registration.update = original; }
    }, event);
    await expect(page.locator('.notification')).not.toHaveClass(/visible/);
  }

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.notification')).not.toHaveClass(/visible/);
  await context.setOffline(false);
  // Il comando esplicito continua a fornire un riscontro all'utente.
  await page.getByRole('button', { name: 'CONTROLLA AGGIORNAMENTI' }).click();
  await expect(page.locator('#pwa-notice')).toContainText('Controllo eseguito');
});

test('worker attivo senza cache non viene dichiarato pronto offline', async ({ page }) => {
  await page.goto('/');
  await add(page, '2026-01-01', '1000', '20', '1,8');
  await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
  await expect(page.locator('#pwa-state')).toHaveText('Pronta per l’uso offline', { timeout: 15000 });
  await page.evaluate(async () => {
    const name = (await caches.keys()).find((entry) => entry.startsWith('workbox-precache-'))!;
    const cache = await caches.open(name);
    const font = (await cache.keys()).find((entry) => new URL(entry.url).pathname.endsWith('.woff2'))!;
    await cache.delete(font);
  });
  await page.getByRole('button', { name: 'CONTROLLA AGGIORNAMENTI' }).click();
  await expect(page.locator('#pwa-state')).toContainText('Preparazione offline incompleta');
  await page.evaluate(async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  });
  await page.getByRole('button', { name: 'CONTROLLA AGGIORNAMENTI' }).click();
  await expect(page.locator('#pwa-state')).toContainText('Cache offline non disponibile');
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'RIPREPARA OFFLINE' }).click();
  await reloaded;
  await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
  await expect(page.locator('#pwa-state')).toHaveText('Pronta per l’uso offline', { timeout: 15000 });
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(page.locator('.records > li')).toHaveCount(1);
});

test('manifest, icone e diario completo offline dopo una nuova apertura', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
  await expect(page.locator('#pwa-state')).toHaveText('Pronta per l’uso offline', { timeout: 15000 });
  const manifest = await page.evaluate(async () => {
    const url = document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href;
    return (await fetch(url)).json();
  });
  expect(manifest).toMatchObject({ lang: 'it', display: 'standalone', id: './', start_url: './', scope: './' });
  expect(manifest.icons).toHaveLength(2);
  const dimensions = await page.evaluate(async () => Promise.all(
    ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].map((src) => new Promise<number>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth);
      image.onerror = reject;
      image.src = new URL(src, location.href).href;
    })),
  ));
  expect(dimensions).toEqual([192, 512, 180]);
  await page.getByRole('button', { name: 'INSTALLA SU IPHONE' }).click();
  await expect(page.locator('dialog')).toContainText('Aggiungi alla schermata Home');
  await expect(page.locator('dialog')).toContainText('archivi separati');
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await add(page, '2026-01-01', '1000', '20', '1,8');

  await context.setOffline(true);
  const offlinePage = await context.newPage();
  await page.close();
  await offlinePage.goto('/');
  await expect(offlinePage.locator('.records > li')).toHaveCount(1);
  await add(offlinePage, '2026-01-10', '1500', '30', '1,8');
  await expect(offlinePage.locator('.consumption')).toHaveText('16,67');
  await offlinePage.getByRole('button', { name: 'Modifica rifornimento del 10.01.2026' }).click();
  await offlinePage.locator('[name=liters]').fill('25');
  await offlinePage.getByRole('button', { name: 'SALVA MODIFICHE' }).click();
  await expect(offlinePage.locator('.consumption')).toHaveText('20,00');
  await offlinePage.getByRole('button', { name: 'Impostazioni e backup' }).click();
  await expect(offlinePage.locator('#pwa-state')).toHaveText('Pronta per l’uso offline');
  const downloaded = offlinePage.waitForEvent('download');
  await offlinePage.getByRole('button', { name: 'ESPORTA BACKUP JSON' }).click();
  const backup = await (await downloaded).path();
  await offlinePage.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await offlinePage.getByRole('button', { name: 'Modifica rifornimento del 10.01.2026' }).click();
  await offlinePage.getByRole('button', { name: 'Elimina registrazione', exact: true }).click();
  await offlinePage.getByRole('button', { name: 'CONFERMA ELIMINAZIONE' }).click();
  await expect(offlinePage.locator('.consumption')).toHaveText('—,—');
  await offlinePage.getByRole('button', { name: 'Impostazioni e backup' }).click();
  await offlinePage.locator('#import-file').setInputFiles(backup!);
  await offlinePage.locator('#confirm-replace').check();
  await offlinePage.getByRole('button', { name: 'RIPRISTINA QUESTO BACKUP' }).click();
  await expect(offlinePage.locator('dialog')).not.toBeVisible();
  await expect(offlinePage.locator('.consumption')).toHaveText('20,00');
  await offlinePage.reload();
  await expect(offlinePage.locator('.consumption')).toHaveText('20,00');
  await expect(offlinePage.locator('.records > li')).toHaveCount(2);
  await offlinePage.evaluate(() => document.fonts.ready);
  expect(await offlinePage.evaluate(() => document.fonts.check('16px "Roboto Mono"'))).toBe(true);
});
