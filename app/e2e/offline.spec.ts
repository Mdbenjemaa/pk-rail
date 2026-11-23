import { expect, locate, openApp, pkValue, placeAt, pointAtPk, test } from './helpers';

// Ici le service worker tourne, comme sur le téléphone.
test.use({ serviceWorkers: 'allow' });

const count = (page: import('@playwright/test').Page, cache: string, part = '') =>
  page.evaluate(
    async ([name, p]) => (await (await caches.open(name)).keys()).filter((r) => r.url.includes(p)).length,
    [cache, part],
  );

test('sans réseau : l’appli s’ouvre, le repérage, la carte des voies et le suivi marchent là où on est passé', async ({ page, context }) => {
  test.slow();
  // Premier lancement avec du réseau : même avant que le service worker soit actif, les données vues sont gardées.
  await openApp(page);
  await locate(page);
  // Les cases voisines (≈ 20 km autour) et les morceaux de carte affichés sont gardés sur le téléphone.
  await expect.poll(() => count(page, 'pkr-data', '/cells/'), { timeout: 20_000 }).toBeGreaterThanOrEqual(6);
  await expect.poll(() => count(page, 'pkr-carte-voies'), { timeout: 20_000 }).toBeGreaterThan(3);
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.map canvas')).toBeVisible();
  await expect(page.locator('.hint-card')).toBeVisible();
  await expect(page.locator('.toast.error')).toHaveCount(0);

  // Repérage sans réseau.
  await locate(page);
  await expect(page.locator('.banner .pk-digits')).toHaveText(/^28\+7\d\d$/);
  await expect(page.getByRole('region', { name: 'Autour de toi' }).locator('.near-row').first()).toBeVisible();

  // La carte des voies s'affiche toujours (morceaux gardés).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const m = (window as unknown as { __pkrMap: import('maplibre-gl').Map }).__pkrMap;
        return m.querySourceFeatures('rail', { sourceLayer: 'lignes' }).length;
      }),
    )
    .toBeGreaterThan(0);

  // Une case voisine jamais affichée (Paris, à 25 km) : gardée par avance, le repérage y marche aussi.
  await placeAt(page, pointAtPk('830000', 3));
  await expect(page.locator('.banner .pill-dark')).toHaveText('Placé à la main');
  await expect.poll(async () => Math.abs(pkValue(await page.locator('.banner .pk-digits').innerText()) - 3)).toBeLessThan(0.01);
  await expect(page.locator('.banner .banner-eyebrow')).toContainText('Ligne 830 000');

  // Suivi dans une zone jamais vue (Marseille) : message clair, l'appli ne se fige pas.
  await page.context().setGeolocation({ latitude: 43.3027, longitude: 5.3806, accuracy: 5 });
  await page.getByRole('button', { name: 'Suivre le PK' }).click();
  await expect(page.locator('.banner-warn')).toContainText('Pas de réseau');
  await page.getByRole('button', { name: 'Arrêter' }).click();
  await context.setOffline(false);
});
