import { readFileSync } from 'node:fs';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

/** Lieusaint-Moissy, à côté des voies de la ligne 830 000 (Paris-Lyon à Marseille), PK ≈ 28+718. */
export const LIEUSAINT = { latitude: 48.64362, longitude: 2.56256 };

type Geo = { latitude: number; longitude: number };
interface LineDoc {
  troncons: { pkd: number; pkf: number; g?: number[] }[];
}

const lineCache = new Map<string, LineDoc>();
function lineDoc(code: string): LineDoc {
  let doc = lineCache.get(code);
  if (!doc) {
    doc = JSON.parse(readFileSync(new URL(`../public/data/lines/${code}.json`, import.meta.url), 'utf8')) as LineDoc;
    lineCache.set(code, doc);
  }
  return doc;
}

/** Point de la ligne à ce PK, lu dans la fiche de ligne livrée avec l'appli (même codage que src/lib/pk.ts). */
export function pointAtPk(code: string, pk: number): Geo {
  for (const t of lineDoc(code).troncons) {
    if (!t.g) continue;
    let x = 0;
    let y = 0;
    let p = 0;
    let prev: [number, number, number] | null = null;
    for (let i = 0; i + 2 < t.g.length; i += 3) {
      x += t.g[i];
      y += t.g[i + 1];
      p += t.g[i + 2];
      const cur: [number, number, number] = [x / 1e5, y / 1e5, p / 1000];
      if (prev && pk >= Math.min(prev[2], cur[2]) && pk <= Math.max(prev[2], cur[2]) && prev[2] !== cur[2]) {
        const f = (pk - prev[2]) / (cur[2] - prev[2]);
        return { longitude: prev[0] + (cur[0] - prev[0]) * f, latitude: prev[1] + (cur[1] - prev[1]) * f };
      }
      prev = cur;
    }
  }
  throw new Error(`PK ${pk} absent de la ligne ${code}`);
}

/** Emprise de la ligne : [ouest, sud, est, nord]. */
export function lineBounds(code: string): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const t of lineDoc(code).troncons) {
    let x = 0;
    let y = 0;
    for (let i = 0; t.g && i + 2 < t.g.length; i += 3) {
      x += t.g[i];
      y += t.g[i + 1];
      w = Math.min(w, x / 1e5);
      e = Math.max(e, x / 1e5);
      s = Math.min(s, y / 1e5);
      n = Math.max(n, y / 1e5);
    }
  }
  return [w, s, e, n];
}

type TestMap = import('maplibre-gl').Map;
/** Carte de l'appli (exposée seulement quand le navigateur est piloté par les tests). */
export async function mapReady(page: Page) {
  await page.waitForFunction(() => !!(window as unknown as { __pkrMap?: unknown }).__pkrMap);
}

/** Montre ce point au centre de la carte (zoom 17), puis renvoie sa position à l'écran. */
export async function showPoint(page: Page, at: Geo): Promise<{ x: number; y: number }> {
  await mapReady(page);
  const pt = await page.evaluate(
    ([lon, lat]) =>
      new Promise<{ x: number; y: number }>((resolve) => {
        const m = (window as unknown as { __pkrMap: TestMap }).__pkrMap;
        m.jumpTo({ center: [lon, lat], zoom: 17 });
        m.once('idle', () => resolve(m.project([lon, lat])));
      }),
    [at.longitude, at.latitude],
  );
  const box = (await page.locator('.map').boundingBox())!;
  return { x: box.x + pt.x, y: box.y + pt.y };
}

/** Appui long (clic droit sur ordinateur) sur ce point de la carte : « me placer ici ». */
export async function placeAt(page: Page, at: Geo) {
  const pt = await showPoint(page, at);
  await page.mouse.click(pt.x, pt.y, { button: 'right' });
}

/** « 28+718 » → 28.718 */
export const pkValue = (text: string) => {
  const m = /(-?\d+)\+(\d{3})/.exec(text);
  if (!m) throw new Error(`PK illisible : ${text}`);
  const km = Number(m[1]);
  return km < 0 || m[1].startsWith('-') ? km - Number(m[2]) / 1000 : km + Number(m[2]) / 1000;
};

/** Erreurs attendues : réseau extérieur coupé pendant les tests (fonds de carte, Google…). */
const EXPECTED = /Failed to load resource|net::ERR_|AJAXError|Failed to fetch|NetworkError/i;

export interface AppOptions {
  /** Premier lancement : l'avertissement s'affiche (sinon il est déjà accepté). */
  firstRun?: boolean;
  /** Position GPS simulée (null : GPS refusé). */
  gps?: Geo | null;
  /** Préférences déjà enregistrées sur le téléphone. */
  storage?: Record<string, unknown>;
}

/** Coupe tout ce qui sort de la machine : les tests ne dépendent pas d'Internet. */
export async function offlineWorld(context: BrowserContext) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort('internetdisconnected'));
}

export async function openApp(page: Page, opts: AppOptions = {}) {
  const context = page.context();
  await offlineWorld(context);
  if (opts.gps !== null) {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ ...(opts.gps ?? LIEUSAINT), accuracy: 4 });
  }
  const storage: Record<string, unknown> = {
    'pkr-install-plus-tard': Date.now(),
    'pkr-theme': 'jour',
    ...(opts.firstRun ? {} : { 'pkr-ack-v1': true }),
    ...opts.storage,
  };
  await page.addInitScript((s) => {
    // Une seule fois par onglet : un rechargement garde ce que l'appli a enregistré.
    if (sessionStorage.getItem('e2e-init')) return;
    sessionStorage.setItem('e2e-init', '1');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
  }, storage);
  await page.goto('./');
  await expect(page.locator('.map canvas')).toBeVisible();
}

/** « Me repérer » puis « Utiliser cette position » dès la première mesure. */
export async function locate(page: Page) {
  await page.getByRole('button', { name: 'Me repérer' }).click();
  await page.getByRole('button', { name: 'Utiliser cette position' }).click();
  await expect(page.locator('.banner .banner-eyebrow')).toContainText('Ligne 830 000');
}

export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`Erreur : ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(`Console : ${m.text()}`);
      });
      await use(errors);
      expect(errors, 'erreurs dans la page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
