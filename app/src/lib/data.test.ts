import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/** Faux stockage du téléphone (Cache Storage), en mémoire. */
class FakeCache {
  store = new Map<string, { body: ArrayBuffer; headers: Headers }>();
  private key = (r: string | Request) => (typeof r === 'string' ? r : r.url);
  async match(r: string | Request) {
    const hit = this.store.get(this.key(r));
    return hit ? new Response(hit.body.slice(0), { headers: hit.headers }) : undefined;
  }
  async put(r: string | Request, res: Response) {
    this.store.set(this.key(r), { body: await res.arrayBuffer(), headers: new Headers(res.headers) });
  }
  async keys() {
    return [...this.store.keys()].map((u) => new Request(u));
  }
  async delete(r: string | Request) {
    return this.store.delete(this.key(r));
  }
}
const stores = new Map<string, FakeCache>();
const fakeCaches = {
  open: async (name: string) => {
    if (!stores.has(name)) stores.set(name, new FakeCache());
    return stores.get(name)!;
  },
  delete: async (name: string) => stores.delete(name),
  keys: async () => [...stores.keys()],
};

let data: typeof import('./data');
beforeAll(async () => {
  vi.stubGlobal('location', { href: 'http://localhost/' });
  vi.stubGlobal('caches', fakeCaches);
  data = await import('./data');
});
afterEach(() => {
  stores.clear();
  vi.unstubAllGlobals();
  vi.stubGlobal('location', { href: 'http://localhost/' });
  vi.stubGlobal('caches', fakeCaches);
});

const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
const offline = () => vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

describe('données gardées sur le téléphone', () => {
  it('« cache » : sert le téléphone sans aller sur le réseau', async () => {
    const url = 'http://localhost/data/cells/9_195.json?v=1';
    await (await fakeCaches.open(data.DATA_CACHE)).put(url, json({ l: [], v: [] }));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await data.cachedJson(url, 'cache')).toEqual({ l: [], v: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('« cache » : va sur le réseau la première fois, puis garde la réponse', async () => {
    const url = 'http://localhost/data/lines/830000.json?v=1';
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ code: '830000' }))));
    expect(await data.cachedJson(url, 'cache')).toEqual({ code: '830000' });
    vi.stubGlobal('fetch', offline());
    expect(await data.cachedJson(url, 'cache')).toEqual({ code: '830000' });
  });

  it('« réseau » : sans réseau, reprend la dernière version gardée', async () => {
    const url = 'http://localhost/data/manifest.json';
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ version: 'A' }))));
    expect(await data.cachedJson(url, 'reseau')).toEqual({ version: 'A' });
    vi.stubGlobal('fetch', offline());
    expect(await data.cachedJson(url, 'reseau')).toEqual({ version: 'A' });
  });

  it('message clair quand ni le réseau ni le téléphone n’ont la donnée', async () => {
    vi.stubGlobal('fetch', offline());
    await expect(data.cachedJson('http://localhost/data/cells/1_1.json', 'cache')).rejects.toThrow(data.OFFLINE_MESSAGE);
  });

  it('cases gardées autour de la position : la sienne et les 8 voisines', () => {
    const cells = data.cellsNear([2.56256, 48.64362], 4);
    expect(cells).toHaveLength(9);
    expect(cells).toContain('10_194');
    expect(cells).toContain('9_193');
    expect(cells).toContain('11_195');
  });
});

describe('carte des voies sans réseau (RailTilesSource)', () => {
  const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 251)).buffer;
  const range = (etag: string, n: number) =>
    vi.fn(() => Promise.resolve(new Response(bytes(n), { status: 206, headers: { ETag: etag, 'Content-Length': String(n) } })));
  const settle = () => new Promise((r) => setTimeout(r, 20));

  it('garde chaque morceau reçu et le ressert sans réseau', async () => {
    const src = new data.RailTilesSource('http://localhost/data/rail.pmtiles');
    vi.stubGlobal('fetch', range('"v1"', 512));
    const online = await src.getBytes(1000, 512);
    expect(online.etag).toBe('"v1"');
    await settle();
    vi.stubGlobal('fetch', offline());
    const off = await src.getBytes(1000, 512, undefined, '"v1"');
    expect(new Uint8Array(off.data)).toEqual(new Uint8Array(bytes(512)));
    expect(off.etag).toBe('"v1"');
  });

  it('ne ressert pas un morceau d’une autre version du fichier', async () => {
    const src = new data.RailTilesSource('http://localhost/data/rail.pmtiles');
    vi.stubGlobal('fetch', range('"v1"', 64));
    await src.getBytes(0, 64);
    await settle();
    vi.stubGlobal('fetch', offline());
    await expect(src.getBytes(0, 64, undefined, '"v2"')).rejects.toThrow('Failed to fetch');
  });

  it('un morceau jamais vu reste une erreur réseau', async () => {
    const src = new data.RailTilesSource('http://localhost/data/rail.pmtiles');
    vi.stubGlobal('fetch', offline());
    await expect(src.getBytes(5, 10)).rejects.toThrow(TypeError);
  });
});
