import type { AccesHit, AccesSet } from './acces';
/**
 * Recherche de gares tolérante : accents, tirets, « Saint » / « St », fautes de frappe.
 */

/** Minuscules sans accents ni ponctuation ; « saint(e) » ramené à « st(e) » comme dans les noms SNCF. */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\bsainte\b/g, 'ste')
    .replace(/\bsaint\b/g, 'st');
}

/** Distance d'édition (insertion, suppression, remplacement, inversion de deux lettres), arrêtée au-delà de max. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array<number>(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/** Fautes tolérées selon la longueur de ce qui est tapé. */
const tolerance = (n: number) => (n < 4 ? 0 : n < 7 ? 1 : 2);

/**
 * Score d'un nom pour la recherche (plus petit = meilleur), ou null s'il ne correspond pas.
 * 0 : le nom commence par la recherche ; 1 : un mot du nom commence par la recherche ;
 * 2 + fautes : correspondance approchée (début du nom ou d'un mot).
 */
export function matchScore(query: string, name: string): number | null {
  return scoreNorm(normName(query), normName(name));
}

/** Même chose sur des textes déjà passés par normName (pour chercher vite dans une longue liste). */
export function scoreNorm(q: string, n: string): number | null {
  if (!q) return null;
  if (n.startsWith(q)) return 0;
  if (n.includes(` ${q}`)) return 1;
  const max = tolerance(q.length);
  if (!max) return null;
  let best = max + 1;
  // Début du nom, puis début de chaque mot : on compare à un morceau de même longueur (± les fautes permises).
  const starts = [0];
  for (let i = 0; i < n.length; i++) if (n[i] === ' ') starts.push(i + 1);
  for (const s of starts) {
    for (let len = q.length - max; len <= q.length + max; len++) {
      if (len <= 0 || s + len > n.length) continue;
      best = Math.min(best, editDistance(q, n.slice(s, s + len), max));
      if (best === 1) break;
    }
  }
  return best <= max ? 2 + best : null;
}

/**
 * Indices des meilleurs noms (déjà passés par normName), du plus proche au moins proche.
 * `maxScore` = 1 : seulement les noms qui commencent par la recherche (ou dont un mot commence par elle).
 */
export function bestIndexes(query: string, normNames: string[], limit: number, maxScore = Infinity): number[] {
  const q = normName(query);
  const scored: { s: number; i: number }[] = [];
  normNames.forEach((n, i) => {
    const s = scoreNorm(q, n);
    if (s !== null && s <= maxScore) scored.push({ s, i });
  });
  scored.sort((a, b) => a.s - b.s || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.i);
}

/** Les meilleurs éléments pour une recherche, du plus proche au moins proche. */
export function bestMatches<T>(query: string, items: T[], nameOf: (it: T) => string, limit: number): T[] {
  return bestIndexes(query, items.map((it) => normName(nameOf(it))), limit).map((i) => items[i]);
}

/**
 * Mes accès qui correspondent à la recherche : par leur nom (début, mot, fautes de frappe tolérées),
 * puis par leur description, puis par le nom du fichier importé (pour lister tous les accès d'un fichier).
 */
export function searchAcces(query: string, sets: AccesSet[], limit: number): { hits: AccesHit[]; total: number; exact: boolean } {
  const q = normName(query);
  if (q.length < 2) return { hits: [], total: 0, exact: false };
  const scored: (AccesHit & { s: number })[] = [];
  for (const set of sets) {
    const inSet = normName(set.name).includes(q);
    for (const a of set.items) {
      const s = scoreNorm(q, normName(a.name)) ?? (normName(a.desc).includes(q) ? 5 : inSet ? 6 : null);
      if (s !== null) scored.push({ s, set, a });
    }
  }
  scored.sort((x, y) => x.s - y.s || x.a.name.localeCompare(y.a.name, 'fr', { numeric: true }));
  // « exact » : au moins un accès dont le nom commence par la recherche (pas seulement approchant).
  return { hits: scored.slice(0, limit).map(({ set, a }) => ({ set, a })), total: scored.length, exact: scored.some((x) => x.s <= 1) };
}
