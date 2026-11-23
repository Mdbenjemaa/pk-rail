import type { LayerSpecification } from 'maplibre-gl';

type Rgba = [number, number, number, number];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [Math.round(ch(h + 1 / 3) * 255), Math.round(ch(h) * 255), Math.round(ch(h - 1 / 3) * 255)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h / 6, s, l];
}

/** Couleur CSS (#rgb, #rrggbb, rgb(), rgba(), hsl(), hsla()) → [r, g, b, a], ou null. */
export function parseColor(c: string): Rgba | null {
  const s = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const v = h.split('').map((x) => parseInt(x + x, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  m = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(s);
  if (!m) return null;
  const p = m[2]
    .replace(/%|deg/g, '')
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
  const a = p[3] ?? 1;
  if (m[1].startsWith('rgb')) return [p[0], p[1], p[2], a];
  const [r, g, b] = hslToRgb((((p[0] % 360) + 360) % 360) / 360, p[1] / 100, p[2] / 100);
  return [r, g, b, a];
}

export type NightRole = 'fond' | 'route' | 'texte' | 'halo';

/**
 * Version « nuit » d'une couleur du fond plan (clair) : fonds sombres, routes en gris moyen,
 * textes clairs, halos sombres. Les couleurs sont aussi désaturées pour ne pas éblouir.
 */
export function nightColor(c: string, role: NightRole): string {
  const rgba = parseColor(c);
  if (!rgba) return c;
  const [h, s, l] = rgbToHsl(rgba[0], rgba[1], rgba[2]);
  const l2 =
    role === 'texte' ? 0.6 + (1 - l) * 0.25 : role === 'halo' ? 0.07 : role === 'route' ? 0.08 + Math.max(0, l - 0.6) * 0.5 : 0.05 + (1 - l) * 0.45;
  const [r, g, b] = hslToRgb(h, s * 0.45, Math.min(1, Math.max(0, l2)));
  return rgba[3] < 1 ? `rgba(${r}, ${g}, ${b}, ${Number(rgba[3].toFixed(3))})` : `rgb(${r}, ${g}, ${b})`;
}

function mapColors(v: unknown, f: (c: string) => string): unknown {
  if (typeof v === 'string') return parseColor(v) ? f(v) : v;
  if (Array.isArray(v)) return v.map((x) => mapColors(x, f));
  // Ancien format des styles : { stops: [[zoom, couleur], …] }.
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mapColors(x, f)]));
  return v;
}

const ROUTE = /highway|road|street|bridge|tunnel|path|rail|transit|aeroway|pier|ferry/i;

/** Fond de carte de nuit : on assombrit toutes les couleurs des couches du fond plan. */
export function nightLayers(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.map((layer) => {
    const paint = (layer as { paint?: Record<string, unknown> }).paint;
    if (!paint) return layer;
    const route = layer.type === 'line' && ROUTE.test(layer.id);
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(paint)) {
      if (!k.endsWith('-color')) {
        next[k] = v;
        continue;
      }
      const role: NightRole =
        k === 'text-color' ? 'texte' : k === 'text-halo-color' || k === 'icon-halo-color' ? 'halo' : route ? 'route' : 'fond';
      next[k] = mapColors(v, (c) => nightColor(c, role));
    }
    return { ...layer, paint: next } as LayerSpecification;
  });
}

/**
 * Noms du fond plan en français quand ils existent (« Belgique », « Suisse », « Genève »…),
 * sinon le nom en lettres latines, sinon le nom local. Le fond OpenFreeMap affiche l'anglais par défaut.
 */
export function frenchLabels(layers: LayerSpecification[]): LayerSpecification[] {
  const NAME = ['coalesce', ['get', 'name:fr'], ['get', 'name:latin'], ['get', 'name']];
  return layers.map((l) => {
    if (l.type !== 'symbol') return l;
    const field = JSON.stringify(l.layout?.['text-field'] ?? null);
    if (!/name_en|name:latin/.test(field)) return l;
    return { ...l, layout: { ...l.layout, 'text-field': NAME } } as LayerSpecification;
  });
}
