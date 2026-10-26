import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { build } from 'vite';
import { add } from './refueling';

test('aggiornamento reale sotto percorso repository, dati conservati e moduli protetti tra schede', async ({ page, context }) => {
  test.setTimeout(60000);
  const root = resolve(import.meta.dirname, '..');
  await mkdir(join(root, '.tools'), { recursive: true });
  const temporary = await mkdtemp(join(root, '.tools/pwa-e2e-'));
  const first = join(temporary, 'first');
  const second = join(temporary, 'second');
  let current = first;
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url!, 'http://localhost');
        if (!url.pathname.startsWith('/alla-pompa/')) throw new Error('Fuori dallo scope');
        const relative = decodeURIComponent(url.pathname.slice('/alla-pompa/'.length)) || 'index.html';
        const path = resolve(current, relative);
        if (!path.startsWith(current + sep)) throw new Error('Percorso non valido');
        const contents = await readFile(path);
        const mime: Record<string, string> = {
          '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
          '.webmanifest': 'application/manifest+json', '.png': 'image/png',
          '.woff': 'font/woff', '.woff2': 'font/woff2',
        };
        response.setHeader('Content-Type', mime[extname(path)] ?? 'text/plain');
        response.setHeader('Cache-Control', 'no-store');
        response.end(contents);
      } catch { response.writeHead(404); response.end(); }
    })();
  });
  try {
    for (const [outDir, version] of [[first, 'first'], [second, 'second']] as const) {
      await build({
        root, base: '/alla-pompa/', logLevel: 'silent', build: { outDir },
        plugins: [{
          name: 'test-release-marker',
          transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'test-release', content: version }, injectTo: 'head' }],
        }],
      });
    }
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Server di prova non avviato');
    const url = `http://127.0.0.1:${address.port}/alla-pompa/`;
    await page.goto(url);
    await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
    await expect(page.locator('#pwa-state')).toHaveText('Pronta per l’uso offline', { timeout: 15000 });
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toBe(url);
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector<HTMLLinkElement>('link[rel=manifest]')!;
      return { url: link.href, body: await (await fetch(link.href)).json() };
    });
    expect(manifest.url).toBe(`${url}manifest.webmanifest`);
    expect(new URL(manifest.body.start_url, manifest.url).href).toBe(url);
    expect(new URL(manifest.body.scope, manifest.url).href).toBe(url);
    await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await add(page, '2026-01-01', '1000', '20', '1,8');
    await add(page, '2026-01-10', '1500', '25', '1,8');
    await page.getByRole('button', { name: 'AGGIUNGI RIFORNIMENTO' }).click();
    await page.locator('[name=liters]').fill('12,345');

    const updater = await context.newPage();
    await updater.goto(url);
    await updater.getByRole('button', { name: 'Impostazioni e backup' }).click();
    await expect(updater.locator('#pwa-state')).toHaveText('Pronta per l’uso offline');
    current = second;
    await updater.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(updater.locator('#update-panel')).toBeVisible({ timeout: 15000 });
    await expect(updater.locator('.notification')).toContainText('Aggiornamento disponibile');
    await expect(updater.locator('.notification')).toHaveClass(/visible/);
    await updater.locator('[name=vehicle]').fill('Nome non salvato');
    await updater.getByRole('button', { name: 'AGGIORNA E RICARICA' }).click();
    await expect(updater.locator('#pwa-notice')).toContainText('Salva o chiudi il modulo');
    await expect(updater.locator('#pwa-notice')).toBeVisible();
    await expect(updater.locator('[name=vehicle]')).toHaveValue('Nome non salvato');
    await expect(updater.locator('meta[name=test-release]')).toHaveAttribute('content', 'first');
    await updater.locator('[name=vehicle]').fill('La mia auto');
    await updater.getByRole('button', { name: 'AGGIORNA E RICARICA' }).click();
    await expect(updater.locator('meta[name=test-release]')).toHaveAttribute('content', 'second');
    await expect(updater.locator('.consumption')).toHaveText('20,00');
    await expect(updater.locator('.records > li')).toHaveCount(2);
    // L'altra scheda conserva il modulo non salvato, pur ricevendo il nuovo worker.
    await expect(page.locator('[name=liters]')).toHaveValue('12,345');
    await expect(page.locator('meta[name=test-release]')).toHaveAttribute('content', 'first');
    await page.getByRole('button', { name: 'Chiudi', exact: true }).click();
    await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
    await expect(page.locator('#update-panel')).toBeVisible();
    await page.getByRole('button', { name: 'AGGIORNA E RICARICA' }).click();
    await expect(page.locator('meta[name=test-release]')).toHaveAttribute('content', 'second');
    await updater.close();

    // Apertura a rete spenta anche sotto il percorso del repository aggiornato.
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.consumption')).toHaveText('20,00');
    await page.getByRole('button', { name: 'Impostazioni e backup' }).click();
    await expect(page.locator('#pwa-state')).toHaveText('Pronta per l’uso offline');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(temporary, { recursive: true, force: true });
  }
});
