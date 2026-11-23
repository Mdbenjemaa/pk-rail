import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { DATA_URL, PMTILES_URL } from '../lib/data';
import { PREVIEW } from '../lib/env';
import { FILTERS, type Filters } from '../lib/layers';
import { RFN_SPRITE, SIGNAL_ICONS } from '../lib/signaux';
import { frenchLabels, nightLayers } from './night';

export type Basemap = 'plan' | 'photo' | 'aucun';

const GLYPHS_LOCAL = new URL(`${import.meta.env.BASE_URL}fonts/{fontstack}/{range}.pbf`, location.href).href
  .replace('%7Bfontstack%7D', '{fontstack}')
  .replace('%7Brange%7D', '{range}');
// Aperçu : les polices sont livrées en JSON (base64), via un protocole maison.
const GLYPHS = PREVIEW ? 'glyph://{fontstack}/{range}' : GLYPHS_LOCAL;
const FONTS_URL = new URL(`${import.meta.env.BASE_URL}fonts/`, location.href).href;

export async function glyphProtocol(params: { url: string }): Promise<{ data: ArrayBuffer }> {
  const m = /^glyph:\/\/([^/]+)\/(\d+-\d+)$/.exec(params.url);
  if (!m) throw new Error('Police inconnue');
  const stack = decodeURIComponent(m[1]).split(',')[0].trim().replaceAll(' ', '_');
  const res = await fetch(`${FONTS_URL}${stack}/${m[2]}.json`);
  if (!res.ok) throw new Error(`Police indisponible (${res.status})`);
  const bin = atob(((await res.json()) as { b64: string }).b64);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  return { data: bytes.buffer };
}

/** Aperçu : fond très simple (pays, villes), les fonds distants étant bloqués. */
function previewBase(sources: Record<string, SourceSpecification>): LayerSpecification[] {
  sources.land = { type: 'geojson', data: `${DATA_URL}base/land.json` };
  sources.cities = { type: 'geojson', data: `${DATA_URL}base/cities.json` };
  return [
    { id: 'fond', type: 'background', paint: { 'background-color': '#dfe9f2' } },
    { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': '#f4f3ef' } },
    { id: 'land-line', type: 'line', source: 'land', paint: { 'line-color': '#b8b5ad', 'line-width': 1 } },
    {
      id: 'cities', type: 'symbol', source: 'cities', maxzoom: 11,
      layout: { 'text-field': ['get', 'name'], 'text-font': REG, 'text-size': 12 },
      paint: { 'text-color': '#6b7280', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
    },
  ];
}
const PLAN_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const IGN_ORTHO =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS' +
  '&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg';

const REG = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];

let planCache: StyleSpecification | null = null;

/** Fond « plan » d'OpenFreeMap ; en cas d'échec (hors-ligne), fond uni. */
async function planBase(): Promise<StyleSpecification | null> {
  if (planCache) return planCache;
  try {
    const res = await fetch(PLAN_STYLE, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    planCache = (await res.json()) as StyleSpecification;
    return planCache;
  } catch {
    return null;
  }
}

function emptyFC(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

/** Couches ferroviaires (source « rail », fichier PMTiles). */
/** Signaux de nuit : mêmes teintes, plus claires pour rester lisibles sur fond sombre. */
const NIGHT_SIG: Record<string, string> = { '#dc2626': '#f87171', '#eab308': '#fde047', '#ffffff': '#f3f4f6', '#2563eb': '#93c5fd', '#9ca3af': '#d1d5db' };

export function railLayers(basemap: Basemap, filters: Filters, night = false): LayerSpecification[] {
  const photo = basemap === 'photo';
  /** Couleur selon le fond : plan de jour, plan de nuit, photo aérienne. */
  const pick = (day: string, nuit: string, ph: string) => (photo ? ph : night ? nuit : day);
  const ink = pick('#111827', '#e5e7eb', '#ffffff');
  const halo = pick('#ffffff', 'rgba(8,11,17,0.9)', 'rgba(0,0,0,0.85)');
  const lineColor = pick('#1e3a5f', '#93c5fd', '#facc15');
  const sigText = (color: string) => (photo ? '#ffffff' : night ? (NIGHT_SIG[color] ?? '#e5e7eb') : color === '#ffffff' ? '#111827' : color);
  const vis = (key: keyof Filters) => (filters[key] ? 'visible' : 'none') as 'visible' | 'none';
  const text = (size: number, bold = false) => ({ 'text-font': bold ? BOLD : REG, 'text-size': size });
  const paintText = { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.6 };

  // Signaux : le dessin du vrai signal quand on le connaît (propriété « ic »), sinon une pastille de couleur.
  const sansDessin = (kind: string): FilterSpecification =>
    SIGNAL_ICONS ? ['all', ['==', ['get', 'k'], kind], ['!', ['has', 'ic']]] : ['==', ['get', 'k'], kind];
  const sig = (id: string, kind: string, color: string, stroke: string, key: keyof Filters, labelMin: number): LayerSpecification[] => [
    {
      id: `r-sig-${id}`, type: 'circle', source: 'rail', 'source-layer': 'signaux', minzoom: 13,
      filter: sansDessin(kind), layout: { visibility: vis(key) },
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3, 17, 7], 'circle-color': color, 'circle-stroke-color': stroke, 'circle-stroke-width': 1.5 },
    },
    {
      id: `r-sig-${id}-label`, type: 'symbol', source: 'rail', 'source-layer': 'signaux', minzoom: labelMin,
      filter: sansDessin(kind),
      layout: { visibility: vis(key), 'text-field': ['get', 'l'], ...text(12, true), 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
      paint: { ...paintText, 'text-color': sigText(color) },
    },
    ...(SIGNAL_ICONS
      ? ([
          {
            id: `r-sig-${id}-ic`, type: 'symbol', source: 'rail', 'source-layer': 'signaux', minzoom: 13,
            filter: ['all', ['==', ['get', 'k'], kind], ['has', 'ic']],
            layout: {
              visibility: vis(key),
              'icon-image': ['concat', 'rfn:', ['get', 'ic']],
              'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.16, 16, 0.3, 19, 0.55],
              'icon-anchor': 'bottom',
              'icon-allow-overlap': true,
              'text-field': ['step', ['zoom'], '', labelMin, ['get', 'l']],
              ...text(12, true),
              'text-anchor': 'left',
              'text-offset': [0.9, -0.8],
              'text-optional': true,
            },
            paint: { ...paintText, 'text-color': sigText(color) },
          },
        ] as LayerSpecification[])
      : []),
  ];

  const speedColor: ExpressionSpecification = ['step', ['get', 'v'], '#9ca3af', 41, '#60a5fa', 81, '#22c55e', 121, '#eab308', 161, '#f97316', 221, '#dc2626'];
  const elecColor: ExpressionSpecification = ['match', ['get', 'e'], '25 kV', '#dc2626', '1500 V', '#2563eb', '15 kV', '#16a34a', '#9333ea'];

  return [
    { id: 'r-vitesse', type: 'line', source: 'rail', 'source-layer': 'vitesse', layout: { visibility: vis('vitesse'), 'line-cap': 'round' }, paint: { 'line-color': speedColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 8], 'line-opacity': 0.75 } },
    { id: 'r-elec', type: 'line', source: 'rail', 'source-layer': 'elec', layout: { visibility: vis('elec'), 'line-cap': 'round' }, paint: { 'line-color': elecColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 12, 8], 'line-opacity': 0.6 } },
    {
      id: 'r-lignes-autres', type: 'line', source: 'rail', 'source-layer': 'lignes', filter: ['!', ['in', ['get', 's'], ['literal', ['E', 'S']]]],
      layout: { 'line-cap': 'butt' },
      paint: { 'line-color': pick('#9ca3af', '#6b7280', '#e5e7eb'), 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 9, 1.4, 13, 2.5, 16, 4], 'line-dasharray': [2, 2] },
    },
    {
      id: 'r-lignes', type: 'line', source: 'rail', 'source-layer': 'lignes', filter: ['in', ['get', 's'], ['literal', ['E', 'S']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 's'], 'S', pick('#64748b', '#94a3b8', '#fde68a'), lineColor],
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 9, 1.6, 13, 3, 16, 5],
      },
    },
    { id: 'r-tunnels', type: 'line', source: 'rail', 'source-layer': 'tunnels', minzoom: 9, layout: { visibility: vis('tunnels') }, paint: { 'line-color': pick('#374151', '#64748b', '#000000'), 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 15, 10], 'line-opacity': 0.45 } },
    { id: 'r-voies', type: 'line', source: 'rail', 'source-layer': 'voies', minzoom: 12, layout: { visibility: vis('voies') }, paint: { 'line-color': pick('#475569', '#94a3b8', '#fef08a'), 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 17, 2] } },
    { id: 'r-quais', type: 'line', source: 'rail', 'source-layer': 'quais', minzoom: 13, layout: { visibility: vis('quais'), 'line-cap': 'butt' }, paint: { 'line-color': pick('#94a3b8', '#475569', '#e0f2fe'), 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 2, 17, 9], 'line-opacity': 0.8 } },
    { id: 'r-lignes-label', type: 'symbol', source: 'rail', 'source-layer': 'lignes', minzoom: 10, layout: { 'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': ['get', 'c'], ...text(11, true), 'text-offset': [0, -0.8] }, paint: { ...paintText, 'text-color': pick('#1e3a5f', '#93c5fd', '#facc15') } },
    { id: 'r-tunnels-label', type: 'symbol', source: 'rail', 'source-layer': 'tunnels', minzoom: 13, layout: { visibility: vis('tunnels'), 'symbol-placement': 'line', 'text-field': ['get', 'n'], ...text(12), 'text-offset': [0, 1] }, paint: paintText },
    { id: 'r-voies-label', type: 'symbol', source: 'rail', 'source-layer': 'voies', minzoom: 15, layout: { visibility: vis('voies'), 'symbol-placement': 'line', 'symbol-spacing': 250, 'text-field': ['get', 'n'], ...text(12, true) }, paint: { ...paintText, 'text-color': pick('#334155', '#cbd5e1', '#fef08a') } },
    { id: 'r-quais-label', type: 'symbol', source: 'rail', 'source-layer': 'quais', minzoom: 15, layout: { visibility: vis('quais'), 'symbol-placement': 'line', 'text-field': ['get', 'n'], ...text(12) }, paint: paintText },
    { id: 'r-pk-km', type: 'circle', source: 'rail', 'source-layer': 'pk_km', minzoom: 10, layout: { visibility: vis('pk') }, paint: { 'circle-radius': 3, 'circle-color': '#facc15', 'circle-stroke-color': '#111827', 'circle-stroke-width': 1 } },
    { id: 'r-pk-km-label', type: 'symbol', source: 'rail', 'source-layer': 'pk_km', minzoom: 11, layout: { visibility: vis('pk'), 'text-field': ['concat', 'PK ', ['get', 'p']], ...text(12, true), 'text-offset': [0, -1.1], 'text-anchor': 'bottom', 'text-optional': true }, paint: { 'text-color': '#111827', 'text-halo-color': '#facc15', 'text-halo-width': 2 } },
    { id: 'r-pk-hm', type: 'circle', source: 'rail', 'source-layer': 'pk_hm', minzoom: 14.5, layout: { visibility: vis('pk') }, paint: { 'circle-radius': 2, 'circle-color': '#fde68a', 'circle-stroke-color': '#111827', 'circle-stroke-width': 0.8 } },
    { id: 'r-pk-hm-label', type: 'symbol', source: 'rail', 'source-layer': 'pk_hm', minzoom: 15.5, layout: { visibility: vis('pk'), 'text-field': ['get', 'p'], ...text(11), 'text-offset': [0, -0.9], 'text-anchor': 'bottom', 'text-optional': true }, paint: paintText },
    { id: 'r-bornes', type: 'circle', source: 'rail', 'source-layer': 'bornes', minzoom: 13, layout: { visibility: vis('bornes') }, paint: { 'circle-radius': 4, 'circle-color': '#ffffff', 'circle-stroke-color': '#16a34a', 'circle-stroke-width': 2 } },
    { id: 'r-bornes-label', type: 'symbol', source: 'rail', 'source-layer': 'bornes', minzoom: 14, layout: { visibility: vis('bornes'), 'text-field': ['concat', 'Borne ', ['get', 'p']], ...text(11), 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true }, paint: { ...paintText, 'text-color': pick('#15803d', '#86efac', '#bbf7d0') } },
    { id: 'r-ouvrages', type: 'circle', source: 'rail', 'source-layer': 'ouvrages', minzoom: 12, layout: { visibility: vis('ouvrages') }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 5], 'circle-color': '#a8a29e', 'circle-stroke-color': '#44403c', 'circle-stroke-width': 1 } },
    { id: 'r-ouvrages-label', type: 'symbol', source: 'rail', 'source-layer': 'ouvrages', minzoom: 15, layout: { visibility: vis('ouvrages'), 'text-field': ['get', 'n'], ...text(11), 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true }, paint: paintText },
    { id: 'r-pn', type: 'circle', source: 'rail', 'source-layer': 'pn', minzoom: 11, layout: { visibility: vis('pn') }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 7], 'circle-color': '#f59e0b', 'circle-stroke-color': '#78350f', 'circle-stroke-width': 1.5 } },
    { id: 'r-pn-label', type: 'symbol', source: 'rail', 'source-layer': 'pn', minzoom: 13, layout: { visibility: vis('pn'), 'text-field': ['get', 'n'], ...text(12, true), 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true }, paint: { ...paintText, 'text-color': pick('#92400e', '#fcd34d', '#fde68a') } },
    { id: 'r-sst', type: 'circle', source: 'rail', 'source-layer': 'sst', minzoom: 9, layout: { visibility: vis('sst') }, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 16, 8], 'circle-color': '#7c3aed', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } },
    { id: 'r-sst-label', type: 'symbol', source: 'rail', 'source-layer': 'sst', minzoom: 12, layout: { visibility: vis('sst'), 'text-field': ['get', 'n'], ...text(12), 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: { ...paintText, 'text-color': pick('#6d28d9', '#c4b5fd', '#ddd6fe') } },
    ...sig('carre', 'carre', '#dc2626', '#ffffff', 'carres', 15),
    ...sig('avert', 'avert', '#eab308', '#111827', 'avert', 15.5),
    ...sig('vitesse', 'vitesse', '#ffffff', '#111827', 'tiv', 14.5),
    ...sig('elec', 'elec', '#2563eb', '#ffffff', 'sigelec', 15.5),
    ...sig('autre', 'autre', '#9ca3af', '#374151', 'sigautres', 16),
    { id: 'r-gares', type: 'circle', source: 'rail', 'source-layer': 'gares', minzoom: 8, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 14, 6], 'circle-color': '#ffffff', 'circle-stroke-color': '#111827', 'circle-stroke-width': 2 }, layout: { visibility: vis('gares') } },
    { id: 'r-gares-label', type: 'symbol', source: 'rail', 'source-layer': 'gares', minzoom: 9.5, layout: { visibility: vis('gares'), 'text-field': ['get', 'n'], ...text(13, true), 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true }, paint: paintText },
  ];
}

export const INTERACTIVE_LAYERS = [
  'u-target', 'u-acces',
  'r-gares', 'r-pn', 'r-sst', 'r-ouvrages', 'r-bornes', 'r-pk-km', 'r-pk-hm',
  'r-sig-carre-ic', 'r-sig-avert-ic', 'r-sig-vitesse-ic', 'r-sig-elec-ic', 'r-sig-autre-ic',
  'r-sig-carre', 'r-sig-avert', 'r-sig-vitesse', 'r-sig-elec', 'r-sig-autre',
  'r-quais', 'r-voies', 'r-tunnels', 'r-lignes', 'r-lignes-autres',
];

/** Points ajoutés par l'appli : accès importés, PK de destination. */
export interface Overlays {
  me: FeatureCollection | null;
  target: FeatureCollection | null;
  acces: FeatureCollection | null;
}

function overlayLayers(filters: Filters, photo: boolean, night: boolean): LayerSpecification[] {
  const dark = photo || night;
  const halo = dark ? '#000000' : '#ffffff';
  return [
    {
      id: 'u-acces', type: 'circle', source: 'acces', layout: { visibility: filters.acces ? 'visible' : 'none' },
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 15, 8], 'circle-color': '#047857', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
    },
    {
      id: 'u-acces-label', type: 'symbol', source: 'acces', minzoom: 11,
      layout: { visibility: filters.acces ? 'visible' : 'none', 'text-field': ['get', 'n'], 'text-font': BOLD, 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': dark ? '#bbf7d0' : '#065f46', 'text-halo-color': halo, 'text-halo-width': 1.6 },
    },
    {
      id: 'u-target', type: 'circle', source: 'target',
      paint: { 'circle-radius': 11, 'circle-color': '#ea580c', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
    },
    {
      id: 'u-target-label', type: 'symbol', source: 'target',
      layout: { 'text-field': ['get', 'label'], 'text-font': BOLD, 'text-size': 14, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': dark ? '#fdba74' : '#9a3412', 'text-halo-color': halo, 'text-halo-width': 2 },
    },
  ];
}

/** Couches de la position de l'utilisateur. */
function meLayers(): LayerSpecification[] {
  return [
    { id: 'me-accuracy', type: 'fill', source: 'me', filter: ['==', ['get', 'role'], 'accuracy'], paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.15, 'fill-outline-color': '#2563eb' } },
    { id: 'me-link', type: 'line', source: 'me', filter: ['==', ['get', 'role'], 'link'], paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-dasharray': [2, 1.5] } },
    { id: 'me-snap', type: 'circle', source: 'me', filter: ['==', ['get', 'role'], 'snap'], paint: { 'circle-radius': 9, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#dc2626', 'circle-stroke-width': 3 } },
    { id: 'me-dot', type: 'circle', source: 'me', filter: ['==', ['get', 'role'], 'me'], paint: { 'circle-radius': 8, 'circle-color': '#2563eb', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } },
  ];
}

export async function buildStyle(basemap: Basemap, filters: Filters, o: Overlays, night = false): Promise<StyleSpecification> {
  const sources: Record<string, SourceSpecification> = {
    rail: { type: 'vector', url: `pmtiles://${PMTILES_URL}`, attribution: '© SNCF Réseau (open data) · © OpenStreetMap' },
    me: { type: 'geojson', data: o.me ?? emptyFC() },
    target: { type: 'geojson', data: o.target ?? emptyFC() },
    acces: { type: 'geojson', data: o.acces ?? emptyFC() },
  };
  let baseLayers: LayerSpecification[] = [{ id: 'fond', type: 'background', paint: { 'background-color': basemap === 'photo' ? '#1f2937' : '#eef0ec' } }];
  let sprite: StyleSpecification['sprite'];

  if (PREVIEW) {
    if (basemap !== 'aucun') baseLayers = previewBase(sources);
  } else if (basemap === 'plan') {
    const plan = await planBase();
    if (plan) {
      Object.assign(sources, plan.sources);
      baseLayers = frenchLabels(plan.layers);
      sprite = plan.sprite;
    }
  } else if (basemap === 'photo') {
    sources.ortho = { type: 'raster', tiles: [IGN_ORTHO], tileSize: 256, maxzoom: 19, attribution: '© IGN – BD ORTHO' };
    baseLayers.push({ id: 'ortho', type: 'raster', source: 'ortho', ...(night ? { paint: { 'raster-brightness-max': 0.75 } } : {}) });
  }
  // Nuit : le fond plan (ou uni) passe en sombre ; la photo aérienne est seulement atténuée.
  if (night && basemap !== 'photo') baseLayers = nightLayers(baseLayers);

  // Planche du fond plan (« default ») et planche des signaux (« rfn: »).
  const sprites = [
    ...(typeof sprite === 'string' ? [{ id: 'default', url: sprite }] : (sprite ?? [])),
    ...(SIGNAL_ICONS ? [{ id: 'rfn', url: RFN_SPRITE }] : []),
  ];
  return {
    version: 8,
    glyphs: GLYPHS,
    ...(sprites.length ? { sprite: sprites } : {}),
    sources,
    layers: [
    ...baseLayers,
    ...railLayers(basemap, filters, night),
    ...overlayLayers(filters, basemap === 'photo', night),
    ...meLayers(),
  ],
  };
}

/** Pour l'écran des filtres : couches commandées par chaque filtre. */
export function layersFor(key: keyof Filters): string[] {
  return FILTERS.find((f) => f.key === key)?.layers ?? [];
}
