import type { LineDoc } from './data';
import { distance, type LonLat } from './geo';

/**
 * Lit un PK saisi à la main. Accepte « 45+200 », « 45,2 », « 45.2 », « PK 45 », « 45 200 »,
 * la notation SNCF des PK négatifs « 0-771 », et un nombre de mètres (« 45200 »).
 * Renvoie des kilomètres, ou null si la saisie n'est pas un PK.
 */
export function parsePk(input: string): number | null {
  const s = input.toLowerCase().replace(/^\s*pk\s*/, '').trim();
  let m = /^(-?\d{1,4})\s*\+\s*(\d{1,3})$/.exec(s);
  if (m) {
    const km = Number(m[1]);
    const meters = Number(m[2]);
    return km < 0 || m[1].startsWith('-') ? km - meters / 1000 : km + meters / 1000;
  }
  m = /^(\d{1,4})\s*-\s*(\d{1,3})$/.exec(s);
  if (m) return -(Number(m[1]) + Number(m[2]) / 1000);
  m = /^(-?\d{1,4})\s(\d{3})$/.exec(s);
  if (m) return Number(m[1]) + Math.sign(Number(m[1]) || 1) * (Number(m[2]) / 1000);
  m = /^-?\d+(?:[.,]\d+)?$/.exec(s);
  if (m) {
    const v = Number(s.replace(',', '.'));
    // Un entier très grand est une saisie en mètres (aucune ligne ne dépasse 1 200 km).
    return Number.isInteger(v) && Math.abs(v) > 1500 ? v / 1000 : v;
  }
  return null;
}

type Vertex = [number, number, number];
const decoded = new WeakMap<number[], Vertex[]>();

/** Décode la géométrie d'un tronçon : [lon, lat, pk en km] à chaque sommet. */
export function decodeGeom(g: number[]): Vertex[] {
  const hit = decoded.get(g);
  if (hit) return hit;
  const out: Vertex[] = [];
  let x = 0;
  let y = 0;
  let p = 0;
  for (let i = 0; i + 2 < g.length; i += 3) {
    x += g[i];
    y += g[i + 1];
    p += g[i + 2];
    out.push([x / 1e5, y / 1e5, p / 1000]);
  }
  decoded.set(g, out);
  return out;
}

export interface PkPosition {
  lonlat: LonLat;
  /** Statut du tronçon (Exploitée, Neutralisée…). */
  statut: string;
}

/**
 * Position(s) d'un PK sur une ligne. Une ligne peut passer deux fois par le même PK
 * (tronçons distincts, raccordements) : toutes les positions distantes de plus de 50 m sont rendues.
 */
export function positionsAtPk(doc: LineDoc, pk: number): PkPosition[] {
  const found: PkPosition[] = [];
  const add = (lonlat: LonLat, statut: string) => {
    if (!found.some((f) => distance(f.lonlat, lonlat) < 50)) found.push({ lonlat, statut });
  };
  for (const t of doc.troncons) {
    if (!t.g) continue;
    const v = decodeGeom(t.g);
    for (let i = 0; i + 1 < v.length; i++) {
      const a = v[i];
      const b = v[i + 1];
      const lo = Math.min(a[2], b[2]);
      const hi = Math.max(a[2], b[2]);
      if (pk < lo || pk > hi) continue;
      const f = hi === lo ? 0 : (pk - a[2]) / (b[2] - a[2]);
      add([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], t.statut);
      break;
    }
  }
  return found;
}

/** Plage de PK couverte par la géométrie de la ligne. */
export function pkRange(doc: LineDoc): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const t of doc.troncons) {
    lo = Math.min(lo, t.pkd, t.pkf);
    hi = Math.max(hi, t.pkd, t.pkf);
  }
  return [lo, hi];
}

/** « 830000 45+200 », « L830000 PK 45,2 », « 45+200 830000 » → ligne et PK. */
export function parsePkQuery(q: string): { code: string; pk: number } | null {
  const raw = q.trim().toLowerCase().replace(/^l(?:igne)?\s*/, '');
  let m = /^(\d{3})\s?(\d{3})\s+(.+)$/.exec(raw);
  if (m) {
    const pk = parsePk(m[3]);
    return pk === null ? null : { code: m[1] + m[2], pk };
  }
  m = /^(.+?)\s+(?:l(?:igne)?\s*)?(\d{3})\s?(\d{3})$/.exec(raw);
  if (m) {
    const pk = parsePk(m[1]);
    return pk === null ? null : { code: m[2] + m[3], pk };
  }
  return null;
}

/** Liens d'itinéraire en voiture vers un point. */
export function navLinks(at: LonLat): { label: string; href: string }[] {
  const lat = at[1].toFixed(6);
  const lon = at[0].toFixed(6);
  // Google Maps seulement : ouvre l'appli Google Maps si elle est installée, sinon le site.
  return [{ label: 'Itinéraire Google Maps', href: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving` }];
}

/** Tracé de la ligne entre deux PK (un morceau par tronçon concerné), pour dessiner une zone. */
export function lineBetween(doc: LineDoc, pkA: number, pkB: number): [number, number][][] {
  const lo = Math.min(pkA, pkB);
  const hi = Math.max(pkA, pkB);
  const parts: [number, number][][] = [];
  for (const t of doc.troncons) {
    if (!t.g) continue;
    const v = decodeGeom(t.g);
    let cur: [number, number][] = [];
    const at = (a: Vertex, b: Vertex, pk: number): [number, number] => {
      const f = b[2] === a[2] ? 0 : (pk - a[2]) / (b[2] - a[2]);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    };
    for (let i = 0; i + 1 < v.length; i++) {
      const a = v[i];
      const b = v[i + 1];
      const sLo = Math.min(a[2], b[2]);
      const sHi = Math.max(a[2], b[2]);
      if (sHi < lo || sLo > hi) {
        if (cur.length > 1) parts.push(cur);
        cur = [];
        continue;
      }
      const start = a[2] >= lo && a[2] <= hi ? ([a[0], a[1]] as [number, number]) : at(a, b, a[2] < lo ? lo : hi);
      const end = b[2] >= lo && b[2] <= hi ? ([b[0], b[1]] as [number, number]) : at(a, b, b[2] < lo ? lo : hi);
      if (!cur.length) cur.push(start);
      cur.push(end);
    }
    if (cur.length > 1) parts.push(cur);
  }
  return parts;
}
