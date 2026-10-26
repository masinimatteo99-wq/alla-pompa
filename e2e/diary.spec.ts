import { expect, test } from '@playwright/test';
import { add } from './refueling';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('dashboard ponderata, costi distinti e intervallo aperto escluso dalla media', async ({ page }) => {
  await add(page, '2026-01-01', '10000', '30', '1,8');
  await add(page, '2026-01-05', '10300', '15', '1,8', false);
  await add(page, '2026-01-10', '10700', '30', '1,7');
  await add(page, '2026-01-15', '11000', '30', '2');
  // 1.000 km / 75 L; costi misurati 138 €, acquisti totali 192 €.
  await expect(page.locator('.consumption')).toHaveText('13,33');
  await expect(page.locator('.hero-note')).toHaveText('7,50 L/100 km · 1000 km misurati');
  await expect(page.locator('.summary strong')).toHaveText(['192,00 €', '0,138 €']);
  await expect(page.locator('.last-interval')).toContainText('300 km · 30,00 L · 10,00 L/100 km · 0,200 €/km');
  await add(page, '2026-01-20', '11100', '5', '2', false);
  await expect(page.locator('.status-line')).toContainText('2 intervalli completi · uno in corso');
  await expect(page.locator('.consumption')).toHaveText('13,33');
  await expect(page.locator('.summary strong')).toHaveText(['202,00 €', '0,138 €']);
  await page.getByRole('button', { name: 'Modifica rifornimento del 05.01.2026' }).click();
  await page.locator('[name=liters]').fill('20');
  await page.getByRole('button', { name: 'SALVA MODIFICHE' }).click();
  await expect(page.locator('.consumption')).toHaveText('12,50');
  await expect(page.locator('.hero-note')).toContainText('8,00 L/100 km');
  await expect(page.locator('.summary strong')).toHaveText(['211,00 €', '0,147 €']);
  await page.reload();
  await expect(page.locator('.consumption')).toHaveText('12,50');
  await expect(page.locator('.summary strong')).toHaveText(['211,00 €', '0,147 €']);
});

test('stati senza misura: vuoto, soli parziali e primo pieno', async ({ page }) => {
  await expect(page.locator('.consumption')).toHaveText('—,—');
  await expect(page.locator('.status-line')).toContainText('Serve un pieno completo di riferimento');
  await add(page, '2026-01-01', '1000', '10', '1,8', false);
  await expect(page.locator('.status-line')).toContainText('Nessuna misura valida');
  await expect(page.locator('.summary strong')).toHaveText(['18,00 €', '—']);
  await expect(page.locator('.last-interval')).toHaveCount(0);
  await add(page, '2026-01-05', '1100', '20', '1,8');
  await expect(page.locator('.consumption')).toHaveText('—,—');
  await expect(page.locator('.status-line')).toContainText('In attesa del prossimo pieno completo');
  await expect(page.locator('.summary strong')).toHaveText(['54,00 €', '—']);
});

test('indicatori del consumo solo sugli intervalli confrontabili e aggiornati dopo modifica', async ({ page }) => {
  const points = [
    { km: 0, liters: '20', full: true }, { km: 100, liters: '10', full: true },
    { km: 150, liters: '4', full: false }, { km: 200, liters: '4', full: true },
    { km: 300, liters: '12', full: true }, { km: 500, liters: '24', full: true },
  ];
  await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
  await page.locator('#import-file').setInputFiles({
    name: 'trends.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      app: 'alla-pompa', version: 1, exportedAt: '2026-02-01T10:00:00Z',
      data: { vehicle: { id: 'test', name: 'Prova indicatori' }, gaps: [], refuelings: points.map((point, index) => ({
        id: `trend-${index}`, date: `2026-01-0${index + 1}`, odometerKm: point.km,
        liters: point.liters, full: point.full, pricePerLiter: '1,8',
      })) },
    })),
  });
  await page.locator('#confirm-replace').check();
  await page.getByRole('button', { name: 'RIPRISTINA QUESTO BACKUP' }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
  await expect(page.locator('[data-id=trend-0] .consumption-trend')).toHaveCount(0);
  await expect(page.locator('[data-id=trend-1] .consumption-trend')).toHaveCount(0);
  await expect(page.locator('[data-id=trend-2] .consumption-trend')).toHaveCount(0);
  await expect(page.locator('[data-id=trend-3] .trend-improved')).toHaveText('↑');
  await expect(page.locator('[data-id=trend-4] .trend-worse')).toHaveText('↓');
  await expect(page.locator('[data-id=trend-5] .trend-equal')).toHaveText('=');
  await expect(page.locator('.record-bottom')).not.toContainText(['↗']);
  await page.locator('[data-id=trend-5]').click();
  await page.locator('[name=liters]').fill('20');
  await page.getByRole('button', { name: 'SALVA MODIFICHE' }).click();
  await expect(page.locator('[data-id=trend-5] .trend-improved')).toHaveText('↑');
});

test('scontrino responsive, zero barrato e storico persistente', async ({ page }, info) => {
  await expect(page.getByRole('heading', { name: 'ALLA POMPA.' })).toBeVisible();
  await add(page, '2026-01-01', '50000', '30', '1,750');
  await expect(page.locator('.consumption')).toHaveText('—,—');
  await add(page, '2026-01-10', '50650', '40', '1,750');
  await expect(page.locator('.consumption')).toHaveText('16,25');
  await expect(page.locator('.unit')).toHaveText('KM / L');
  await expect(page.locator('.hero-note')).toContainText('6,15 L/100 km');
  await page.reload();
  await expect(page.locator('.records > li')).toHaveCount(2);
  await expect(page.locator('.consumption')).toHaveText('16,25');
  await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => {
    const hero = document.querySelector('.consumption')!;
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      font: getComputedStyle(hero).fontFamily,
      zero: getComputedStyle(hero).fontVariantNumeric,
      center: (hero.getBoundingClientRect().top + hero.getBoundingClientRect().bottom) / 2,
      height: innerHeight,
    };
  });
  expect(layout.overflow).toBe(false);
  expect(layout.font).toContain('Roboto Mono');
  expect(layout.zero).toContain('slashed-zero');
  expect(layout.center).toBeLessThan(layout.height / 3);
  await page.screenshot({ path: `.tools/receipt-${info.project.name}.png`, fullPage: true });
});

test('parziali, correzione e cancellazione con ricalcolo', async ({ page }) => {
  await add(page, '2026-01-01', '10000', '30', '1,8');
  await add(page, '2026-01-05', '10300', '15', '1,8', false);
  await expect(page.locator('.consumption')).toHaveText('—,—');
  await add(page, '2026-01-10', '10700', '30', '1,7');
  await expect(page.locator('.consumption')).toHaveText('15,56');
  await page.getByRole('button', { name: 'Modifica rifornimento del 05.01.2026' }).click();
  await page.locator('[name=liters]').fill('20');
  await page.getByRole('button', { name: 'SALVA MODIFICHE' }).click();
  await expect(page.locator('.consumption')).toHaveText('14,00');
  await page.getByRole('button', { name: 'Modifica rifornimento del 05.01.2026' }).click();
  await page.getByRole('button', { name: 'Elimina registrazione', exact: true }).click();
  await page.getByRole('button', { name: 'CONFERMA ELIMINAZIONE' }).click();
  await expect(page.locator('.records > li')).toHaveCount(2);
  await expect(page.locator('.consumption')).toHaveText('—,—');
});

test('backup scaricabile, ripristino confermato e file non valido', async ({ page }) => {
  await add(page, '2026-01-01', '1000', '20', '1,759');
  await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ESPORTA BACKUP JSON' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(download.suggestedFilename()).toMatch(/alla-pompa-backup.*\.json/);
  await page.locator('#import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await expect(page.getByRole('alert')).toContainText('non supportati');
  await page.locator('#import-file').setInputFiles(path!);
  await expect(page.getByRole('heading', { name: 'RIPRISTINA BACKUP' })).toBeVisible();
  await page.getByRole('button', { name: 'RIPRISTINA QUESTO BACKUP' }).click();
  await expect(page.getByRole('alert')).toContainText('Conferma');
  await page.locator('#confirm-replace').check();
  await page.getByRole('button', { name: 'RIPRISTINA QUESTO BACKUP' }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.records > li')).toHaveCount(1);
  await expect(page.locator('.record')).toContainText('35,18');
});

test('validazione senza salvare dati errati e nome veicolo trattato come testo', async ({ page }) => {
  await add(page, '2026-01-01', '1000', '20', '1,7');
  await page.getByRole('button', { name: 'AGGIUNGI RIFORNIMENTO' }).click();
  await page.locator('[name=date]').fill('2026-01-02');
  await page.locator('[name=odometer]').fill('900');
  await page.locator('[name=liters]').fill('10');
  await page.locator('[name=price]').fill('1,7');
  await page.getByRole('button', { name: 'REGISTRA RIFORNIMENTO' }).click();
  await expect(page.getByRole('alert')).toContainText('decrescenti');
  await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
  await expect(page.locator('.records > li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
  await page.locator('[name=vehicle]').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'SALVA NOME' }).click();
  await expect(page.locator('.vehicle')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.vehicle img')).toHaveCount(0);
});

test('solo lo storico scorre e riepiloghi e aggiunta restano visibili', async ({ page }, info) => {
  const backup = {
    app: 'alla-pompa', version: 1, exportedAt: '2026-02-01T10:00:00Z',
    data: {
      vehicle: { id: 'test-vehicle', name: 'Auto di prova' }, gaps: [],
      refuelings: Array.from({ length: 18 }, (_, index) => ({
        id: `test-${index}`, date: `2026-01-${String(index + 1).padStart(2, '0')}`,
        odometerKm: 10000 + index * 500, liters: '30', pricePerLiter: '1,759', full: true,
      })),
    },
  };
  await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
  await page.locator('#import-file').setInputFiles({
    name: 'scroll-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.locator('#confirm-replace').check();
  await page.getByRole('button', { name: 'RIPRISTINA QUESTO BACKUP' }).click();
  await expect(page.locator('dialog')).not.toBeVisible();
  const region = page.getByRole('region', { name: 'Elenco rifornimenti scorrevole' });
  const before = await page.locator('.hero').boundingBox();
  await expect(region).toBeVisible();
  expect(await region.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  if (info.project.name === 'webkit-iphone') {
    // Playwright non espone la rotella su WebKit mobile: verifica il contenitore
    // tramite il suo scorrimento nativo, senza simulare un gesto touch non disponibile.
    await region.evaluate((element) => element.scrollBy(0, 1600));
  } else {
    await region.hover();
    await page.mouse.wheel(0, 1600);
  }
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('.hero')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.summary')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('.last-interval')).toBeInViewport({ ratio: 1 });
  const addButton = page.getByRole('button', { name: 'AGGIUNGI RIFORNIMENTO' });
  await expect(addButton).toBeInViewport({ ratio: 1 });
  expect(await page.locator('.hero').boundingBox()).toEqual(before);
  const layout = await page.evaluate(() => ({
    pageY: scrollY, pageOverflow: document.documentElement.scrollHeight > innerHeight,
    buttonBottom: document.querySelector('.add-button')!.getBoundingClientRect().bottom,
    historyTop: document.querySelector('.history')!.getBoundingClientRect().top,
  }));
  expect(layout.pageY).toBe(0);
  expect(layout.pageOverflow).toBe(false);
  expect(layout.buttonBottom).toBeLessThanOrEqual(layout.historyTop);
  await region.focus();
  await region.press('Home');
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(0);
  if (info.project.name === 'webkit-iphone') {
    await page.setViewportSize({ width: 375, height: 568 });
    expect(await region.evaluate((element) => element.clientHeight)).toBeGreaterThan(80);
    await expect(addButton).toBeInViewport({ ratio: 1 });
  }
  await page.getByRole('button', { name: 'Come leggiamo i dati' }).click();
  await expect(page.getByRole('heading', { name: 'COME LEGGIAMO I DATI' })).toBeVisible();
  await expect(page.locator('dialog')).toContainText('La media usa litri e km totali');
});
