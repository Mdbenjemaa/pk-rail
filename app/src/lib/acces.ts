import { unzipSync, strFromU8 } from 'fflate';
import { SB_KEY, SB_URL } from './server';
import { myMapsId, myMapsShortLink } from './mymaps';

export { myMapsId };
import type { Feature, FeatureCollection, Point } from 'geojson';
import { loadCell, loadManifest } from './data';
import type { LonLat } from './geo';
import { cellsAround, matchInCells } from './locate';
import { fmtPk } from './format';

/**
 * « Mes accès » : points importés par l'utilisateur (carte Google My Maps exportée en KML/KMZ,
 * GeoJSON). Ils restent dans le stockage du téléphone et ne sont envoyés nulle part.
 */
export interface Acces {
  name: string;
  desc: string;
  lonlat: LonLat;
  /** Ligne la plus proche et PK au droit du point (si une ligne est à moins de 300 m). */
  code?: string;
  pk?: number;
  /** Distance du point à l'axe de cette ligne (m). */
  dist?: number;
}

export interface AccesSet {
  id: string;
  name: string;
  imported: number;
  items: Acces[];
  /** Liste désactivée : cachée sur la carte, dans les recherches et dans les listes autour du PK. */
  hidden?: boolean;
}

const KEY = 'pkr-acces-v1';

export function loadAcces(): AccesSet[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AccesSet[]) : [];
  } catch {
    return [];
  }
}

/** Renvoie false si le téléphone a refusé l'enregistrement (stockage plein ou bloqué). */
export function saveAcces(sets: AccesSet[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(sets));
    return true;
  } catch {
    return false;
  }
}

type RawPoint = Pick<Acces, 'name' | 'desc' | 'lonlat'>;

/** Texte lisible d'une description My Maps (HTML simple). */
function plainText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
  const doc = new DOMParser().parseFromString(`<body>${withBreaks}</body>`, 'text/html');
  return (doc.body.textContent ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function firstCoordinate(text: string): LonLat | null {
  const first = text.trim().split(/\s+/)[0];
  if (!first) return null;
  const [lon, lat] = first.split(',').map(Number);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

/** Points d'un fichier KML : nom, description, données associées, et position. */
export function parseKml(text: string): { title: string | null; points: RawPoint[] } {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('Fichier KML illisible');
  const doc = xml.getElementsByTagName('Document')[0];
  const docName = doc ? Array.from(doc.children).find((c) => c.localName === 'name')?.textContent?.trim() : null;
  const points: RawPoint[] = [];
  for (const pm of Array.from(xml.getElementsByTagName('Placemark'))) {
    const coordsEl = pm.getElementsByTagName('coordinates')[0];
    const lonlat = coordsEl ? firstCoordinate(coordsEl.textContent ?? '') : null;
    if (!lonlat) continue;
    const name = pm.getElementsByTagName('name')[0]?.textContent?.trim() || 'Accès';
    const parts: string[] = [];
    const description = pm.getElementsByTagName('description')[0]?.textContent ?? '';
    if (description.trim()) parts.push(plainText(description));
    for (const d of Array.from(pm.getElementsByTagName('Data'))) {
      const key = d.getAttribute('name');
      const value = d.getElementsByTagName('value')[0]?.textContent?.trim();
      if (key && value && !/^(name|nom|description)$/i.test(key) && !parts.some((p) => p.includes(value))) {
        parts.push(`${key} : ${value}`);
      }
    }
    points.push({ name, desc: parts.join('\n'), lonlat });
  }
  return { title: docName ?? null, points };
}

/** Points d'un GeoJSON (points, ou premier sommet des lignes et surfaces). */
export function parseGeoJson(text: string): { title: string | null; points: RawPoint[] } {
  const fc = JSON.parse(text) as FeatureCollection;
  if (!fc || !Array.isArray(fc.features)) throw new Error('GeoJSON sans éléments');
  const points: RawPoint[] = [];
  for (const f of fc.features) {
    let c: unknown = f.geometry && 'coordinates' in f.geometry ? f.geometry.coordinates : null;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    if (!Array.isArray(c) || typeof c[0] !== 'number') continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const name = String(props.name ?? props.nom ?? props.Name ?? 'Accès');
    const desc = Object.entries(props)
      .filter(([k, v]) => !/^(name|nom)$/i.test(k) && v !== null && v !== '' && typeof v !== 'object')
      .map(([k, v]) => (/^description$/i.test(k) ? plainText(String(v)) : `${k} : ${String(v)}`))
      .join('\n');
    points.push({ name, desc, lonlat: [c[0], c[1] as number] });
  }
  return { title: null, points };
}

const MYMAPS_ERR: Record<string, string> = {
  privee:
    'La carte Google My Maps n’est pas partagée. Dans My Maps : Partager › « Tous les utilisateurs disposant du lien peuvent afficher », puis recommence.',
  introuvable: 'Carte Google My Maps introuvable : le lien est incorrect ou la carte a été supprimée.',
  trop_gros: 'Cette carte Google My Maps est trop grosse pour être importée.',
  lien: 'Ce lien ne mène pas à une carte Google My Maps. Ouvre la carte, touche Partager et copie son lien.',
};

/** Va chercher le KML complet d'une carte Google My Maps (par le serveur de l'appli : le navigateur ne peut pas lire Google). */
export async function fetchMyMaps(src: { mid: string } | { link: string }): Promise<string> {
  const offline = 'Pas de réseau : il en faut pour aller chercher les points sur Google My Maps. Réessaie quand tu as du réseau.';
  if (!navigator.onLine) throw new Error(offline);
  const res = await fetch(`${SB_URL}/functions/v1/mymaps`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(src),
  }).catch(() => null);
  if (!res) throw new Error(offline);
  const d = (await res.json().catch(() => ({}))) as { kml?: string; error?: string };
  if (d.kml) return d.kml;
  throw new Error(MYMAPS_ERR[d.error ?? ''] ?? 'Google My Maps n’a pas répondu. Réessaie dans un moment.');
}

type Parsed = { title: string | null; points: RawPoint[] };

/**
 * KML : si le fichier ne contient qu'un « lien réseau » vers la carte (export My Maps avec
 * « Conserver les données à jour »), on va chercher les points au bout du lien.
 */
async function fromKml(text: string): Promise<Parsed> {
  const parsed = parseKml(text);
  if (parsed.points.length || !/<NetworkLink[\s>]/i.test(text)) return parsed;
  const mid = myMapsId(text);
  if (!mid) {
    throw new Error('Ce fichier ne contient qu’un lien vers une carte en ligne, sans les points. Réexporte-le en décochant « Conserver les données à jour avec un lien réseau KML ».');
  }
  const full = parseKml(await fetchMyMaps({ mid }));
  return { title: parsed.title ?? full.title, points: full.points };
}

/** Importe une carte Google My Maps à partir de son lien (celui qu'on partage ou qu'on copie dans le navigateur). */
export async function readMyMapsLink(link: string): Promise<Parsed> {
  const mid = myMapsId(link);
  if (mid) return parseKml(await fetchMyMaps({ mid }));
  // Lien court du bouton Partager (maps.app.goo.gl) : le serveur le suit jusqu'à la carte.
  const short = myMapsShortLink(link);
  if (short) return parseKml(await fetchMyMaps({ link: short }));
  throw new Error('Ce n’est pas un lien Google My Maps. Ouvre la carte dans Google Maps, touche Partager, puis colle le lien ici.');
}

/** Lit un fichier importé : .kml, .kmz (KML compressé, export par défaut de My Maps), .geojson, .json. */
export async function readAccesFile(file: File): Promise<Parsed> {
  const lower = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) {
    const files = unzipSync(bytes, { filter: (f) => f.name.toLowerCase().endsWith('.kml') });
    const kml = Object.keys(files).sort((a, b) => (a === 'doc.kml' ? -1 : b === 'doc.kml' ? 1 : a.localeCompare(b)))[0];
    if (!kml) throw new Error('Aucun fichier KML dans ce KMZ');
    return fromKml(strFromU8(files[kml]));
  }
  const text = strFromU8(bytes);
  if (lower.endsWith('.json') || lower.endsWith('.geojson') || text.trimStart().startsWith('{')) return parseGeoJson(text);
  return fromKml(text);
}

/** Fichier importé ou lien Google My Maps collé. */
export const readAccesSource = (src: File | string): Promise<Parsed> =>
  typeof src === 'string' ? readMyMapsLink(src) : readAccesFile(src);

/** Rattache chaque point à la ligne la plus proche (moins de 300 m) et calcule son PK. */
export async function snapAcces(points: RawPoint[]): Promise<Acces[]> {
  const m = await loadManifest();
  const known = new Set(m.cells);
  const out: Acces[] = [];
  for (const p of points) {
    const cells = (await Promise.all(cellsAround(p.lonlat, 300, m.cellsPerDegree).map((k) => loadCell(k, known)))).filter(
      (c) => c !== null,
    );
    const best = matchInCells(cells, p.lonlat, 300).lines.sort((a, b) => a.dist - b.dist)[0];
    out.push(best ? { ...p, code: best.code, pk: Math.round(best.pk * 1000) / 1000, dist: Math.round(best.dist) } : { ...p });
  }
  return out;
}

/** Couche de carte des accès importés. */
/** Point de carte d'un accès (mêmes propriétés que sur la carte : sa fiche s'affiche pareil). */
export function accesFeature(a: Acces, setName: string): Feature<Point> {
  return {
    type: 'Feature',
    properties: { n: a.name, d: a.desc, c: a.code, pk: a.pk !== undefined ? fmtPk(a.pk) : undefined, set: setName },
    geometry: { type: 'Point', coordinates: a.lonlat },
  };
}

export function accesFeatures(sets: AccesSet[]): FeatureCollection {
  const shown = sets.filter((s) => !s.hidden);
  return { type: 'FeatureCollection', features: shown.flatMap((s) => s.items.map((a) => accesFeature(a, s.name))) };
}

/** Un accès et le fichier importé dont il vient. */
export interface AccesHit {
  set: AccesSet;
  a: Acces;
}

/** L'accès situé exactement à cet endroit (pour rouvrir sa fiche depuis une recherche récente). */
export function findAccesAt(sets: AccesSet[], at: LonLat): AccesHit | null {
  for (const set of sets) for (const a of set.items) if (a.lonlat[0] === at[0] && a.lonlat[1] === at[1]) return { set, a };
  return null;
}
