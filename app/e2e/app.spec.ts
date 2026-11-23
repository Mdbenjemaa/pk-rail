import { fileURLToPath } from 'node:url';
import { expect, LIEUSAINT, lineBounds, locate, mapReady, openApp, pkValue, placeAt, pointAtPk, test } from './helpers';

const KML = fileURLToPath(new URL('./fixtures/acces-test.kml', import.meta.url));
const PHOTO = fileURLToPath(new URL('./fixtures/photo-vegetation.jpg', import.meta.url));

test.describe.configure({ mode: 'parallel' });

test('premier lancement : avertissement, puis écran d’accueil', async ({ page }) => {
  await openApp(page, { firstRun: true });
  const accept = page.getByRole('button', { name: /J.ai compris/ });
  await expect(accept).toBeVisible();
  await expect(page.getByText('Aide au repérage, jamais une référence de sécurité.')).toBeVisible();
  await accept.click();
  await expect(page.locator('.hint-card')).toContainText('Me repérer');
  await expect(page.getByRole('button', { name: 'Suivre le PK' })).toBeVisible();
  // Accepté une fois pour toutes.
  await page.reload();
  await expect(page.locator('.hint-card')).toBeVisible();
  await expect(accept).toBeHidden();
});

test('me repérer : ligne, PK, voie, caractéristiques et éléments autour', async ({ page }) => {
  await openApp(page);
  await locate(page);
  const pk = pkValue(await page.locator('.banner .pk-digits').innerText());
  expect(pk).toBeGreaterThan(28.69);
  expect(pk).toBeLessThan(28.75);
  await expect(page.locator('.banner .gps-pill')).toContainText('± 4 m');
  await expect(page.locator('.banner-chips')).toContainText('km/h');
  const around = page.getByRole('region', { name: 'Autour de toi' });
  await expect(around.locator('.near-row').first()).toBeVisible();

  // « Tout voir » : les deux sens, puis l'onglet « La ligne ».
  await around.getByRole('button', { name: 'Tout voir' }).click();
  const screen = page.getByRole('dialog', { name: 'Autour de toi' });
  await expect(screen.getByText(/Vers les PK croissants/).first()).toBeVisible();
  await expect(screen.getByText(/Vers les PK décroissants/).first()).toBeVisible();
  await screen.getByRole('tab', { name: 'La ligne' }).click();
  await expect(screen.locator('.facts-list')).toContainText('Vitesse maximale ici');
  await expect(screen.locator('.facts-list')).toContainText('1500 V');
  await screen.getByRole('button', { name: 'Retour à la carte' }).click();
  await expect(screen).toBeHidden();
});

test('suivi du PK : le compteur suit la marche, dans les deux sens, et signale la perte du GPS', async ({ page }) => {
  test.slow();
  await openApp(page, { gps: pointAtPk('830000', 28.6) });
  await page.getByRole('button', { name: 'Suivre le PK' }).click();
  await expect(page.locator('.banner.live')).toContainText('EN DIRECT');
  const digits = page.locator('.banner.live .pk-digits');

  const walk = async (from: number, to: number, steps: number) => {
    for (let i = 1; i <= steps; i++) {
      const pk = from + ((to - from) * i) / steps;
      await page.context().setGeolocation({ ...pointAtPk('830000', pk), accuracy: 4 });
      await page.waitForTimeout(450);
    }
  };
  // Vers les PK croissants : 28+600 → 28+700, en une dizaine de secondes.
  await walk(28.6, 28.7, 22);
  await expect(page.locator('.dir-row')).toContainText('Vers les PK croissants');
  await expect.poll(async () => pkValue(await digits.innerText())).toBeGreaterThan(28.67);
  expect(pkValue(await digits.innerText())).toBeLessThan(28.71);
  await expect(page.locator('.next-card')).toBeVisible();

  // Demi-tour : 28+700 → 28+600.
  await walk(28.7, 28.6, 22);
  await expect(page.locator('.dir-row')).toContainText('Vers les PK décroissants');
  await expect.poll(async () => pkValue(await digits.innerText())).toBeLessThan(28.64);

  // Tunnel : plus de position pendant 9 s.
  await expect(page.locator('.banner-warn')).toContainText('GPS perdu', { timeout: 15_000 });
  await walk(28.6, 28.61, 2);
  await expect(page.locator('.banner-warn')).toBeHidden();

  await page.getByRole('button', { name: 'Arrêter' }).click();
  await expect(page.locator('.banner.live')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Suivre le PK' })).toBeVisible();
});

test('rechercher : une gare, un PK sur une ligne, et les recherches récentes', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Rechercher' }).click();
  const screen = page.getByRole('dialog', { name: 'Rechercher' });
  const input = screen.getByRole('textbox');
  // Faute de frappe tolérée.
  await input.fill('lieusain');
  await screen.getByRole('button', { name: /Lieusaint-Moissy/ }).first().click();
  await expect(screen).toBeHidden();

  await page.getByRole('button', { name: 'Rechercher' }).click();
  await expect(screen.getByText('Récents')).toBeVisible();
  await expect(screen.getByRole('button', { name: /Lieusaint-Moissy/ })).toBeVisible();

  await input.fill('830000 30+000');
  await screen.getByRole('button', { name: /PK 30\+000 · ligne 830 000/ }).click();
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('Destination · ligne 830 000');
  await expect(sheet.locator('.target-pk')).toHaveText('PK 30+000');
  const nav = sheet.getByRole('link', { name: 'Itinéraire Google Maps' });
  const href = (await nav.getAttribute('href')) ?? '';
  const dest = /destination=([\d.-]+),([\d.-]+)/.exec(href);
  expect(dest).not.toBeNull();
  const at30 = pointAtPk('830000', 30);
  expect(Math.abs(Number(dest![1]) - at30.latitude)).toBeLessThan(0.0005);
  expect(Math.abs(Number(dest![2]) - at30.longitude)).toBeLessThan(0.0005);
  await sheet.getByRole('button', { name: 'Fermer' }).click();
  await expect(sheet).toBeHidden();
});

test('aller au PK depuis ma position : distance le long de la ligne et sens', async ({ page }) => {
  await openApp(page);
  await locate(page);
  await page.getByRole('button', { name: /voir les détails de la ligne/ }).click();
  const screen = page.getByRole('dialog', { name: 'Autour de toi' });
  await expect(screen.getByRole('tab', { name: 'La ligne' })).toHaveAttribute('aria-selected', 'true');
  await screen.locator('.pk-form input').first().fill('31');
  await screen.locator('.pk-form input').nth(1).fill('500');
  await screen.locator('.pk-form').getByRole('button').click();
  const sheet = page.locator('.sheet');
  await expect(sheet.locator('.target-pk')).toHaveText('PK 31+500');
  await expect(sheet.locator('.route-line')).toContainText('le long de la ligne, vers les PK croissants');
  await expect(sheet.locator('.route-line b')).toHaveText(/≈ 2,8 km/);
});

test('couches et fond de carte : les choix restent après un rechargement', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Couches et fond de carte' }).click();
  const sheet = page.getByRole('dialog', { name: 'Couches' });
  const bornes = sheet.getByRole('checkbox', { name: /Bornes kilométriques/ });
  await expect(bornes).not.toBeChecked();
  await bornes.check();
  await sheet.getByRole('button', { name: 'Aucun (hors-ligne)' }).click();
  await sheet.getByRole('button', { name: 'Fermer' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Couches et fond de carte' }).click();
  await expect(sheet.getByRole('checkbox', { name: /Bornes kilométriques/ })).toBeChecked();
  await expect(sheet.getByRole('button', { name: 'Aucun (hors-ligne)' })).toHaveClass(/on/);
});

test('mes accès : import KML, rattachement au PK, liste, désactivation, recherche, suppression', async ({ page }) => {
  await openApp(page);
  page.on('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Mes accès : afficher, chercher, importer' }).click();
  const sheet = page.getByRole('dialog', { name: 'Mes accès' });
  await sheet.locator('input[type=file]').setInputFiles(KML);
  await expect(sheet.locator('.ok')).toHaveText('3 accès importés, dont 2 rattachés à une ligne avec leur PK.');

  // La liste du fichier, rangée par ligne puis PK ; celui sans ligne à la fin.
  await sheet.getByRole('button', { name: /Accès test Lieusaint/ }).click();
  const rows = sheet.locator('.acces-file .acces-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Portail sud Lieusaint');
  await expect(rows.nth(0)).toContainText(/PK (28\+9\d\d|29\+0\d\d)/);
  await expect(rows.nth(1)).toContainText('Accès piste Moissy');
  await expect(rows.nth(2)).toContainText('Pas rattaché à une ligne');

  // Désactiver la liste puis la réactiver.
  // (on touche l'interrupteur dessiné, comme sur le téléphone)
  const sw = sheet.getByRole('checkbox', { name: /Liste « Accès test Lieusaint » activée/ });
  await sheet.locator('.acces-switch').click();
  await expect(sw).not.toBeChecked();
  await expect(sheet.locator('.acces-file')).toContainText('Désactivée · 3 accès cachés');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pkr-acces-v1') ?? '[]')[0].hidden)).toBe(true);
  await sheet.locator('.acces-switch').click();
  await expect(sw).toBeChecked();

  // Recherche dans les descriptions (HTML de My Maps remis en texte).
  await sheet.getByRole('searchbox').fill('parking');
  await expect(sheet.locator('.acces-list .acces-row')).toHaveCount(1);
  await sheet.locator('.acces-list .acces-row').first().click();
  const card = page.locator('.card');
  await expect(card).toContainText('Accès (importé)');
  await expect(card).toContainText('Portail sud Lieusaint');
  await expect(card).toContainText('Parking derrière le quai 2');

  // Aussi dans la recherche générale.
  await page.getByRole('button', { name: 'Rechercher' }).click();
  const search = page.getByRole('dialog', { name: 'Rechercher' });
  await search.getByRole('textbox').fill('portail');
  await expect(search.getByRole('button', { name: /Portail sud Lieusaint/ })).toBeVisible();
  await search.getByRole('button', { name: 'Retour à la carte' }).click();

  // Suppression du fichier.
  await page.getByRole('button', { name: 'Mes accès : afficher, chercher, importer' }).click();
  await sheet.getByRole('button', { name: /Accès test Lieusaint/ }).click();
  await sheet.getByRole('button', { name: 'Supprimer le fichier' }).click();
  await expect(sheet.locator('.acces-file')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('pkr-acces-v1'))).toBe('[]');
});

test('menu : mode nuit, effacer ma position, à propos', async ({ page }) => {
  await openApp(page);
  await locate(page);
  await page.getByRole('button', { name: /^Menu/ }).first().click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await menu.getByRole('radio', { name: 'Nuit' }).click();
  await expect(page.locator('html')).toHaveClass(/night/);
  expect(await page.evaluate(() => localStorage.getItem('pkr-theme'))).toBe('"nuit"');
  await menu.getByRole('button', { name: /À propos/ }).click();
  const info = page.getByRole('dialog', { name: 'À propos' });
  await expect(info).toContainText('Comment le PK est calculé');
  await expect(info).toContainText(/données PK du \d{2}\/\d{2}\/\d{4}/);
  await info.getByRole('button', { name: 'Fermer' }).click();

  await page.getByRole('button', { name: /^Menu/ }).first().click();
  await menu.getByRole('button', { name: 'Effacer ma position' }).click();
  await expect(page.locator('.banner')).toBeHidden();
  await expect(page.locator('.hint-card')).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/night/);
});

test('GPS refusé : message clair, et l’appli reste utilisable', async ({ page }) => {
  await openApp(page, { gps: null });
  await page.getByRole('button', { name: 'Me repérer' }).click();
  await expect(page.getByRole('alert')).toContainText('Localisation refusée');
  await page.getByRole('alert').getByRole('button', { name: 'Fermer' }).click();
  await expect(page.getByRole('alert')).toBeHidden();
  await page.getByRole('button', { name: 'Suivre le PK' }).click();
  await expect(page.getByRole('alert')).toContainText('Localisation refusée');
  await expect(page.getByRole('button', { name: 'Suivre le PK' })).toBeVisible();
});

test('appui long sur la carte : me placer ici', async ({ page }) => {
  await openApp(page);
  // La carte montre le PK 29+200, puis appui long pile sur les voies.
  await placeAt(page, pointAtPk('830000', 29.2));
  await expect(page.locator('.banner .pill-dark')).toHaveText('Placé à la main');
  await expect.poll(async () => Math.abs(pkValue(await page.locator('.banner .pk-digits').innerText()) - 29.2)).toBeLessThan(0.01);
  await expect(page.locator('.banner .banner-sub')).toContainText('Paris-Lyon');
});

test('rechercher une ligne par son numéro, même sans gare', async ({ page }) => {
  await openApp(page);
  // Après un repérage : le bandeau et la fiche du bas réduisent la place pour montrer la ligne.
  await locate(page);
  await page.getByRole('button', { name: 'Rechercher' }).click();
  const screen = page.getByRole('dialog', { name: 'Rechercher' });
  await screen.getByRole('textbox').fill('591000');
  await screen.getByRole('button', { name: /Ligne 591 000/ }).click();
  await expect(screen).toBeHidden();
  await mapReady(page);
  // La carte montre la ligne en entier : son centre est dans l'emprise de la ligne.
  const [w, s, e, n] = lineBounds('591000');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const m = (window as unknown as { __pkrMap: import('maplibre-gl').Map }).__pkrMap;
        return m.isMoving() ? null : m.getCenter().toArray();
      }),
    )
    .not.toBeNull();
  const [lon, lat] = (await page.evaluate(() =>
    (window as unknown as { __pkrMap: import('maplibre-gl').Map }).__pkrMap.getCenter().toArray(),
  )) as [number, number];
  expect(lon).toBeGreaterThan(w - 0.05);
  expect(lon).toBeLessThan(e + 0.05);
  expect(lat).toBeGreaterThan(s - 0.3);
  expect(lat).toBeLessThan(n + 0.3);
});

test('petit écran (320 × 568) : rien ne déborde ni ne se chevauche', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openApp(page);
  await locate(page);
  const sizes = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  expect(sizes.sw).toBeLessThanOrEqual(sizes.w);
  const banner = (await page.locator('.top-zone .banner').boundingBox())!;
  const bottom = (await page.locator('.bottom-zone').boundingBox())!;
  expect(banner.y + banner.height).toBeLessThan(bottom.y);
  for (const name of ['Rechercher', 'Suivre le PK', 'Me repérer']) {
    const b = (await page.getByRole('button', { name }).boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(568);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(320);
  }
  await page.getByRole('button', { name: 'Suivre le PK' }).click();
  await page.context().setGeolocation({ ...LIEUSAINT, accuracy: 4 });
  await expect(page.locator('.banner.live .pk-digits')).toBeVisible();
  const live = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(live).toBeLessThanOrEqual(320);
});

test('direction du téléphone : faisceau sur le point GPS et carte orientée', async ({ page }) => {
  await openApp(page);
  // Capteurs d'orientation autorisés, comme sur un téléphone.
  await page.context().grantPermissions(['geolocation', 'accelerometer', 'gyroscope', 'magnetometer']);
  await locate(page);
  // Boussole simulée : le téléphone pointe vers l'ouest (270°).
  await page.evaluate(() => {
    setInterval(() => window.dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { alpha: 90, absolute: true })), 150);
  });
  const layout = (p: string) =>
    page.evaluate((prop) => (window as unknown as { __pkrMap: import('maplibre-gl').Map }).__pkrMap.getLayoutProperty('me-beam', prop), p);
  await expect.poll(() => layout('visibility')).toBe('visible');
  expect(await layout('icon-rotate')).toBe(270);

  await page.getByRole('button', { name: 'Tourner la carte dans ma direction' }).click();
  const bearing = () => page.evaluate(() => (window as unknown as { __pkrMap: import('maplibre-gl').Map }).__pkrMap.getBearing());
  await expect.poll(async () => Math.abs(((await bearing()) + 360) % 360 - 270)).toBeLessThan(4);
  await page.getByRole('button', { name: 'Remettre le nord en haut' }).click();
  await expect.poll(async () => Math.abs(await bearing())).toBeLessThan(1);
});

test('signaler : type, gravité, commentaire, photo, envoi et liste de mes signalements', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await openApp(page);
  await page.context().grantPermissions(['geolocation', 'clipboard-read', 'clipboard-write']);
  await locate(page);
  await page.getByRole('button', { name: 'Signaler une anomalie ici' }).click();
  const sheet = page.getByRole('dialog', { name: 'Signaler' });
  await expect(sheet.locator('.sig-lieu')).toContainText(/Ligne 830 000 · PK 28\+7\d\d/);
  await expect(sheet.getByRole('button', { name: 'Envoyer', exact: true })).toBeDisabled();
  await sheet.getByRole('radio', { name: 'Végétation' }).click();
  await sheet.getByRole('radio', { name: 'Urgente' }).click();
  await sheet.getByRole('textbox', { name: 'Commentaire' }).fill('Branche tombée sur la voie 2');
  await sheet.locator('input[type=file]').setInputFiles(PHOTO);
  await expect(sheet.locator('.sig-photo img')).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Envoyer', exact: true }).click();
  // Pas de partage dans ce navigateur : le texte est copié pour être collé dans un message.
  await expect(page.locator('.toast')).toContainText(/copié|envoyé/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Végétation · URGENT');
  expect(copied).toContain('Ligne 830 000');
  expect(copied).toContain('Branche tombée sur la voie 2');

  // Gardé sur le téléphone, même après rechargement.
  await page.reload();
  await page.getByRole('button', { name: /^Menu/ }).first().click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Mes signalements (1)' }).click();
  const list = page.getByRole('dialog', { name: 'Mes signalements' });
  await list.getByRole('button', { name: /Végétation/ }).click();
  const view = page.getByRole('dialog', { name: 'Végétation' });
  await expect(view).toContainText('Urgente');
  await expect(view).toContainText('Branche tombée sur la voie 2');
  await expect(view.locator('.sig-photo img')).toHaveCount(1);
  await view.getByRole('button', { name: 'Supprimer' }).click();
  await expect(view).toBeHidden();
  await page.getByRole('button', { name: /^Menu/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Menu' }).getByRole('button', { name: 'Mes signalements', exact: true })).toBeVisible();
});

