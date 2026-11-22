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
export type LinePoint = [number, string, string, string, number, number, number?];
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Données indisponibles (${res.status})`);
  return (await res.json()) as T;
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
  manifestPromise ??= getJson<Manifest>(`${DATA_URL}manifest.json`)
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

/** Nouvelle version des données : renseignée si le téléphone avait téléchargé la carte hors-ligne. */
export const dataUpdate = { changed: false, hadOffline: false };
const VERSION_KEY = 'pkr-data-version';

/**
 * Les cases et fiches de ligne sont gardées sur le téléphone. Quand les données changent (nouvelle version
 * dans le manifeste), on jette les anciennes pour ne pas mélanger anciens et nouveaux PK.
 */
async function purgeIfNewData(m: Manifest): Promise<void> {
  let prev: string | null = null;
  try {
    prev = localStorage.getItem(VERSION_KEY);
  } catch {
    return;
  }
  if (prev === m.version) return;
  if ('caches' in globalThis) {
    try {
      const cache = await caches.open(DATA_CACHE);
      dataUpdate.hadOffline = !!(await cache.match(PMTILES_URL));
      for (const req of await cache.keys()) if (!req.url.endsWith('manifest.json')) await cache.delete(req);
    } catch {
      /* stockage indisponible */
    }
  }
  dataUpdate.changed = true;
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
    p = (PREVIEW ? fromPack<Cell>('c', key) : loadManifest().then((m) => getJson<Cell>(versioned(`${DATA_URL}cells/${key}.json`, m)))).catch((e) => {
      cellCache.delete(key);
      throw e;
    });
    cellCache.set(key, p);
  }
  return p;
}

const lineCache = new Map<string, Promise<LineDoc>>();
export function loadLine(code: string): Promise<LineDoc> {
  return loadLineRaw(code);
}

function loadLineRaw(code: string): Promise<LineDoc> {
  let p = lineCache.get(code);
  if (!p) {
    p = (PREVIEW ? fromPack<LineDoc>('l', code) : loadManifest().then((m) => getJson<LineDoc>(versioned(`${DATA_URL}lines/${code}.json`, m)))).catch((e) => {
      lineCache.delete(code);
      throw e;
    });
    lineCache.set(code, p);
  }
  return p;
}

let garesPromise: Promise<GareEntry[]> | null = null;
export function loadGares(): Promise<GareEntry[]> {
  garesPromise ??= loadManifest().then((m) => getJson<GareEntry[]>(versioned(`${DATA_URL}gares.json`, m))).catch((e) => {
    garesPromise = null;
    throw e;
  });
  return garesPromise;
}

/* ---------- Tuiles de la carte : depuis le cache hors-ligne si présent, sinon le réseau ---------- */

export class OfflineFirstSource implements Source {
  private readonly url: string;
  private readonly network: FetchSource;
  private blob: Promise<Blob | null> | null = null;

  constructor(url: string) {
    this.url = url;
    this.network = new FetchSource(url);
  }

  getKey(): string {
    return this.url;
  }

  /** À appeler après un téléchargement ou un effacement des données hors-ligne. */
  reset(): void {
    this.blob = null;
  }

  private cached(): Promise<Blob | null> {
    this.blob ??= (async () => {
      if (!('caches' in globalThis)) return null;
      try {
        const res = await (await caches.open(DATA_CACHE)).match(this.url);
        return res ? await res.blob() : null;
      } catch {
        return null;
      }
    })();
    return this.blob;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const blob = await this.cached();
    if (blob) return { data: await blob.slice(offset, offset + length).arrayBuffer() };
    return this.network.getBytes(offset, length, signal, etag);
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

/* ---------- Téléchargement hors-ligne ---------- */

export interface OfflineState {
  files: number;
  total: number;
  pmtiles: boolean;
}

function allDataUrls(m: Manifest): string[] {
  return [
    `${DATA_URL}manifest.json`,
    versioned(`${DATA_URL}gares.json`, m),
    ...m.cells.map((c) => versioned(`${DATA_URL}cells/${c}.json`, m)),
    ...Object.keys(m.lines).map((c) => versioned(`${DATA_URL}lines/${c}.json`, m)),
  ];
}

export async function offlineState(m: Manifest): Promise<OfflineState> {
  const urls = allDataUrls(m);
  if (!('caches' in globalThis)) return { files: 0, total: urls.length, pmtiles: false };
  const cache = await caches.open(DATA_CACHE);
  const keys = new Set((await cache.keys()).map((r) => r.url));
  return {
    files: urls.filter((u) => keys.has(u)).length,
    total: urls.length,
    pmtiles: keys.has(PMTILES_URL),
  };
}

export async function downloadOffline(
  m: Manifest,
  onProgress: (done: number, total: number, label: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const cache = await caches.open(DATA_CACHE);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const urls = allDataUrls(m).filter((u) => !have.has(u) || u.endsWith('manifest.json'));
  const total = urls.length + 1;
  let done = 0;

  // Tuiles de la carte d'abord : c'est le plus gros fichier.
  if (!have.has(PMTILES_URL)) {
    onProgress(done, total, 'Carte des voies (≈ 38 Mo)…');
    const res = await fetch(PMTILES_URL, { signal });
    if (!res.ok) throw new Error(`Carte des voies indisponible (${res.status})`);
    await cache.put(PMTILES_URL, res);
  }
  done++;

  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const url = urls[i++];
      const res = await fetch(url, { signal, cache: 'no-cache' });
      if (!res.ok) throw new Error(`Fichier indisponible (${res.status})`);
      await cache.put(url, res);
      done++;
      onProgress(done, total, 'Données de repérage…');
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  onProgress(total, total, 'Terminé');
}

export async function clearOffline(): Promise<void> {
  if ('caches' in globalThis) await caches.delete(DATA_CACHE);
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
