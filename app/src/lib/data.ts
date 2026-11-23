import { FetchSource, type RangeResponse, type Source } from 'pmtiles';
import { PREVIEW } from './env';

/** Dossier des données, relatif à l'adresse de l'appli (marche aussi dans un sous-dossier). */
export const DATA_URL = new URL(`${import.meta.env.BASE_URL}data/`, location.href).href;
export const PMTILES_URL = `${DATA_URL}rail.pmtiles`;
/** Même nom que dans la configuration du service worker (vite.config.ts). */
export const DATA_CACHE = 'pkr-data';

export type SectionKind = 'vmax' | 'elec' | 'cant' | 'kvb' | 'ecart';

export interface Manifest {
  version: string;
  cellsPerDegree: number;
  cells: string[];
  lines: Record<string, { n: string | null; pk: [number, number] }>;
  quality: {
    pk_recalage: Record<string, number>;
    controle_bornes_osm: Record<string, number>;
    reperes: Record<string, number>;
  };
  sources: { name: string; license: string; url: string; date?: string }[];
}

/** [code ligne, rang du tronçon, statut court, morceaux : [x, y, pk, x, y, pk…] en 1e-5 degré et mètres] */
export type CellLine = [string, string, string, number[][]];
/** [code ligne, nom de voie, type de voie, morceaux : [x, y, x, y…]] */
export type CellTrack = [string, string, string, number[][]];
export interface Cell {
  l: CellLine[];
  v: CellTrack[];
}

/** [pk, type, libellé, détail, lon, lat, pk de fin (tunnels, quais)] */
/** [PK, type, nom, détail, lon, lat, PK de fin (zones) ou null, dessin du signal] */
export type LinePoint = [number, string, string, string, number, number, (number | null)?, string?];
export interface LineDoc {
  code: string;
  name: string | null;
  pk: [number, number];
  /** g : géométrie avec PK (lon, lat en 1e-5 degré, PK en m), en différences ; voir decodeGeom. */
  troncons: { rg: string; pkd: number; pkf: number; statut: string; g?: number[] }[];
  sections: Partial<Record<SectionKind, [number, number, string][]>>;
  points: LinePoint[];
}

/** [nom, lon, lat, code ligne, pk] */
export type GareEntry = [string, number, number, string, number | null];

async function getJson<T>(url: string): Promise<T> {
  const res = await fetchOk(url);
  return (await res.json()) as T;
}

/** Message quand ni le réseau ni le téléphone n'ont les données demandées. */
export const OFFLINE_MESSAGE =
  'Pas de réseau, et les données de cet endroit ne sont pas encore sur le téléphone. Réessaie avec du réseau : elles seront ensuite gardées.';

/** Réponse du réseau, ou une erreur lisible (pas de réseau, fichier absent). */
async function fetchOk(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const { timeoutMs, ...rest } = init ?? {};
  let res: Response;
  try {
    const signal = timeoutMs && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
    res = await fetch(url, { ...rest, signal });
  } catch {
    throw new Error(OFFLINE_MESSAGE);
  }
  if (!res.ok) throw new Error(`Données indisponibles (erreur ${res.status})`);
  return res;
}

async function openCache(name: string): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

async function fromCache<T>(cache: Cache | null, url: string): Promise<T | undefined> {
  if (!cache) return undefined;
  try {
    const hit = await cache.match(url);
    return hit ? ((await hit.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fichier de données gardé sur le téléphone (Cache Storage), avec ou sans service worker :
 * - « cache » : d'abord le téléphone, sinon le réseau (cases, fiches de ligne, gares : leur adresse change avec la version) ;
 * - « réseau » : d'abord le réseau, pour voir passer les nouvelles versions (manifeste), sinon le téléphone.
 */
export async function cachedJson<T>(url: string, mode: 'cache' | 'reseau'): Promise<T> {
  const cache = await openCache(DATA_CACHE);
  if (mode === 'cache') {
    const hit = await fromCache<T>(cache, url);
    if (hit !== undefined) return hit;
  }
  // Réseau lent : si le téléphone a une copie, on ne l'attend pas plus de 6 s ; sinon on attend le réseau.
  const hasCopy = mode === 'reseau' && !!(await cache?.match(url).catch(() => undefined));
  try {
    const res = await fetchOk(url, mode === 'reseau' ? { cache: 'no-cache', timeoutMs: hasCopy ? 6000 : undefined } : undefined);
    const keep = cache?.put(url, res.clone()).catch(() => undefined);
    const data = (await res.json()) as T;
    await keep;
    return data;
  } catch (e) {
    if (mode === 'reseau') {
      const hit = await fromCache<T>(cache, url);
      if (hit !== undefined) return hit;
    }
    throw e;
  }
}

/* Aperçu : cases et fiches de ligne regroupées en paquets (data/packs). */
let packIndex: Promise<{ c: Record<string, number>; l: Record<string, number> }> | null = null;
const packs = new Map<string, Promise<Record<string, unknown>>>();
async function fromPack<T>(kind: 'c' | 'l', key: string): Promise<T> {
  packIndex ??= getJson(`${DATA_URL}packs/index.json`);
  const n = (await packIndex)[kind][key];
  if (n === undefined) throw new Error(`Donnée absente (${key})`);
  const name = `${kind}${n}`;
  let p = packs.get(name);
  if (!p) {
    p = getJson<Record<string, unknown>>(`${DATA_URL}packs/${name}.json`).catch((e) => {
      packs.delete(name);
      throw e;
    });
    packs.set(name, p);
  }
  return (await p)[key] as T;
}

let manifestPromise: Promise<Manifest> | null = null;
export function loadManifest(): Promise<Manifest> {
  manifestPromise ??= (PREVIEW ? getJson<Manifest>(`${DATA_URL}manifest.json`) : cachedJson<Manifest>(`${DATA_URL}manifest.json`, 'reseau'))
    .then(async (m) => {
      await purgeIfNewData(m);
      return m;
    })
    .catch((e) => {
      manifestPromise = null;
      throw e;
    });
  return manifestPromise;
}

/** Adresse d'un fichier de données propre à leur version : une ancienne copie gardée ne peut pas resservir. */
const versioned = (url: string, m: Manifest) => (PREVIEW ? url : `${url}?v=${encodeURIComponent(m.version)}`);
export const cellUrl = (key: string, m: Manifest) => versioned(`${DATA_URL}cells/${key}.json`, m);
export const lineUrl = (code: string, m: Manifest) => versioned(`${DATA_URL}lines/${code}.json`, m);

/** Nouvelle version des données (déjà vue une autre fois sur ce téléphone). */
export const dataUpdate = { changed: false };
const VERSION_KEY = 'pkr-data-version';
/** Début de cette ouverture de l'appli : ce qui a été gardé avant vient d'une version précédente. */
const SESSION_START = Date.now();

/**
 * Les cases, fiches de ligne et morceaux de carte sont gardés sur le téléphone. Quand les données changent
 * (nouvelle version dans le manifeste), on jette les anciens pour ne pas mélanger anciens et nouveaux PK.
 */
async function purgeIfNewData(m: Manifest): Promise<void> {
  let prev: string | null = null;
  try {
    prev = localStorage.getItem(VERSION_KEY);
  } catch {
    return;
  }
  if (prev === m.version) return;
  const cache = await openCache(DATA_CACHE);
  if (cache) {
    try {
      for (const req of await cache.keys()) if (!req.url.endsWith('manifest.json')) await cache.delete(req);
    } catch {
      /* stockage indisponible */
    }
  }
  // Morceaux de carte : seuls ceux gardés lors des ouvertures précédentes sont anciens. Ceux de cette ouverture
  // (lus sur le réseau, donc à jour, dont l'en-tête du fichier lu au démarrage) restent.
  const tiles = prev === null ? null : await openCache(TILES_CACHE);
  if (tiles) {
    try {
      for (const req of await tiles.keys()) {
        const res = await tiles.match(req);
        if (!res || Number(res.headers.get('x-time') ?? 0) < SESSION_START) await tiles.delete(req);
      }
    } catch {
      /* rien */
    }
  }
  dataUpdate.changed = prev !== null;
  cellCache.clear();
  lineCache.clear();
  garesPromise = null;
  try {
    localStorage.setItem(VERSION_KEY, m.version);
  } catch {
    /* rien */
  }
}

const cellCache = new Map<string, Promise<Cell | null>>();
export function loadCell(key: string, known: Set<string>): Promise<Cell | null> {
  if (!known.has(key)) return Promise.resolve(null);
  let p = cellCache.get(key);
  if (!p) {
    p = (PREVIEW ? fromPack<Cell>('c', key) : loadManifest().then((m) => cachedJson<Cell>(cellUrl(key, m), 'cache'))).catch((e) => {
      cellCache.delete(key);
      throw e;
    });
    cellCache.set(key, p);
  }
  return p;
}

const lineCache = new Map<string, Promise<LineDoc>>();
export function loadLine(code: string): Promise<LineDoc> {
  let p = lineCache.get(code);
  if (!p) {
    p = (PREVIEW ? fromPack<LineDoc>('l', code) : loadManifest().then((m) => cachedJson<LineDoc>(lineUrl(code, m), 'cache'))).catch((e) => {
      lineCache.delete(code);
      throw e;
    });
    lineCache.set(code, p);
  }
  return p;
}

let garesPromise: Promise<GareEntry[]> | null = null;
export function loadGares(): Promise<GareEntry[]> {
  garesPromise ??= loadManifest()
    .then((m) => (PREVIEW ? getJson<GareEntry[]>(`${DATA_URL}gares.json`) : cachedJson<GareEntry[]>(versioned(`${DATA_URL}gares.json`, m), 'cache')))
    .catch((e) => {
      garesPromise = null;
      throw e;
    });
  return garesPromise;
}

/** Les 9 cases autour du point (la sienne et ses voisines : environ 50 × 80 km). */
export function cellsNear(p: [number, number], perDegree: number): string[] {
  const x = Math.floor(p[0] * perDegree);
  const y = Math.floor(p[1] * perDegree);
  const out: string[] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(`${x + dx}_${y + dy}`);
  return out;
}

/**
 * Garde sur le téléphone, sans les ouvrir, les données autour de la position (cases voisines, fiches des lignes
 * proches) : le repérage et le suivi continuent dans les zones sans réseau (tranchées, tunnels, campagne).
 */
export async function keepAround(p: [number, number], lineCodes: string[]): Promise<boolean> {
  if (PREVIEW || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  // Économiseur de données demandé : on ne télécharge rien d'avance.
  if (conn?.saveData) return true;
  const [m, cache] = await Promise.all([loadManifest(), openCache(DATA_CACHE)]);
  if (!cache) return true;
  const known = new Set(m.cells);
  const urls = [
    ...cellsNear(p, m.cellsPerDegree).filter((k) => known.has(k)).map((k) => cellUrl(k, m)),
    ...[...new Set(lineCodes)].filter((c) => m.lines[c]).map((c) => lineUrl(c, m)),
  ];
  for (const url of urls) {
    try {
      if (await cache.match(url)) continue;
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    } catch {
      return false; // réseau perdu ou stockage plein : on réessaiera un peu plus tard
    }
  }
  return true;
}

/* ---------- Carte des voies (PMTiles) : morceaux déjà vus gardés pour la suite sans réseau ---------- */

/** Morceaux du fichier de la carte des voies déjà téléchargés (jetés à chaque nouvelle version des données). */
export const TILES_CACHE = 'pkr-carte-voies';
const TILES_MAX = 6000;

/**
 * Lit le fichier de la carte par morceaux sur le réseau, et garde chaque morceau reçu. Sans réseau,
 * les morceaux déjà vus resservent : la carte des voies reste affichée là où on est déjà passé.
 */
export class RailTilesSource implements Source {
  private readonly url: string;
  private readonly network: FetchSource;
  private puts = 0;

  constructor(url: string) {
    this.url = url;
    this.network = new FetchSource(url);
  }

  getKey(): string {
    return this.url;
  }

  reset(): void {}

  private key(offset: number, length: number): string {
    return `${this.url}?octets=${offset}-${length}`;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    try {
      const r = await this.network.getBytes(offset, length, signal, etag);
      // Copie faite tout de suite : la carte peut ensuite céder ces octets à son fil de calcul.
      void this.keep(offset, length, r.data.slice(0), r.etag);
      return r;
    } catch (e) {
      // Seul le manque de réseau se rattrape ; une demande annulée ou un fichier changé suivent leur cours.
      if (!(e instanceof TypeError) || signal?.aborted) throw e;
      const hit = await this.kept(offset, length, etag);
      if (hit) return hit;
      throw e;
    }
  }

  private async kept(offset: number, length: number, etag?: string): Promise<RangeResponse | null> {
    const cache = await openCache(TILES_CACHE);
    const res = await cache?.match(this.key(offset, length)).catch(() => undefined);
    if (!res) return null;
    const stored = res.headers.get('x-etag') || undefined;
    // Morceau d'une autre version du fichier : inutilisable.
    if (etag && stored && stored !== etag) return null;
    return { data: await res.arrayBuffer(), etag: stored };
  }

  private async keep(offset: number, length: number, data: ArrayBuffer, etag?: string): Promise<void> {
    const cache = await openCache(TILES_CACHE);
    if (!cache) return;
    try {
      await cache.put(this.key(offset, length), new Response(data, { headers: { 'x-etag': etag ?? '', 'x-time': String(Date.now()) } }));
      // De temps en temps, on retire les plus anciens morceaux au-delà de la limite.
      if (++this.puts % 200 === 0) {
        const keys = await cache.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - TILES_MAX))) await cache.delete(k);
      }
    } catch {
      /* stockage plein : tant pis pour ce morceau */
    }
  }
}

/**
 * Aperçu : le fichier PMTiles est découpé en morceaux de taille fixe (data/rail/NNN.<ext>),
 * chargés à la demande, car l'hébergeur de l'aperçu ne garantit pas les lectures partielles.
 */
export class ChunkedSource implements Source {
  private readonly base: string;
  private meta: Promise<{ size: number; chunk: number; ext: string; b64: boolean }> | null = null;
  private readonly chunks = new Map<number, Promise<Uint8Array>>();

  constructor(base: string) {
    this.base = base;
  }

  /** Même clé que l'adresse utilisée dans le style (pmtiles://…/rail.pmtiles). */
  getKey(): string {
    return PMTILES_URL;
  }

  reset(): void {}

  private load(i: number, ext: string, b64: boolean): Promise<Uint8Array> {
    let p = this.chunks.get(i);
    if (!p) {
      const url = `${this.base}${String(i).padStart(3, '0')}.${ext}`;
      p = fetch(url)
        .then(async (r) => {
          if (!r.ok) throw new Error(`Carte indisponible (${r.status})`);
          if (!b64) return new Uint8Array(await r.arrayBuffer());
          const bin = atob(((await r.json()) as { b64: string }).b64);
          const out = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
          return out;
        })
        .catch((e) => {
          this.chunks.delete(i);
          throw e;
        });
      this.chunks.set(i, p);
    }
    return p;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    this.meta ??= getJson(`${this.base}meta.json`);
    const { size, chunk, ext, b64 } = await this.meta;
    const end = Math.min(offset + length, size);
    const out = new Uint8Array(Math.max(0, end - offset));
    const first = Math.floor(offset / chunk);
    const last = Math.floor((end - 1) / chunk);
    const parts = await Promise.all(
      Array.from({ length: last - first + 1 }, (_, k) => this.load(first + k, ext, b64)),
    );
    parts.forEach((bytes, k) => {
      const start = (first + k) * chunk;
      const from = Math.max(offset, start) - start;
      const to = Math.min(end, start + bytes.length) - start;
      out.set(bytes.subarray(from, to), start + from - offset);
    });
    return { data: out.buffer };
  }
}
