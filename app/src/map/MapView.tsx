import { useEffect, useRef } from 'react';
import { addProtocol, Map as MapLibreMap, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapGeoJSONFeature } from 'maplibre-gl';
// MapLibre 6 cherche son worker à côté de son propre fichier : une fois l'appli compilée, on lui donne l'adresse du worker empaqueté par Vite.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PMTiles, Protocol } from 'pmtiles';
import { ChunkedSource, DATA_URL, OfflineFirstSource, PMTILES_URL } from '../lib/data';
import { PREVIEW } from '../lib/env';
import type { LonLat } from '../lib/geo';
import { FILTERS, type Filters } from '../lib/layers';
import { buildStyle, glyphProtocol, INTERACTIVE_LAYERS, type Basemap, type Overlays } from './style';

setWorkerUrl(workerUrl);

// Protocole PMTiles global, avec une source qui lit d'abord le cache hors-ligne.
const protocol = new Protocol();
addProtocol('pmtiles', protocol.tile);
export const railSource = PREVIEW ? new ChunkedSource(`${DATA_URL}rail/`) : new OfflineFirstSource(PMTILES_URL);
if (PREVIEW) addProtocol('glyph', glyphProtocol);
protocol.add(new PMTiles(railSource));

function setSource(m: MapLibreMap | null, id: string, data: FeatureCollection | null) {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  const apply = () => (m?.getSource(id) as GeoJSONSource | undefined)?.setData(data ?? empty);
  if (!m) return;
  if (m.getSource(id)) apply();
  else m.once('styledata', apply);
}

export interface FocusRequest {
  center: LonLat;
  zoom?: number;
  seq: number;
}

interface Props {
  basemap: Basemap;
  filters: Filters;
  me: FeatureCollection | null;
  target: FeatureCollection | null;
  acces: FeatureCollection | null;
  focus: FocusRequest | null;
  /** Suivi : position à garder visible (la carte ne bouge que si le point va sortir de l'écran). */
  keepInView?: LonLat | null;
  /** L'utilisateur a déplacé ou zoomé la carte lui-même. */
  onUserMove?: () => void;
  onFeature: (f: MapGeoJSONFeature, at: LonLat) => void;
  onLongPress: (at: LonLat) => void;
  onMapTap: () => void;
}

/** Marges de la zone visible : le panneau du bas (téléphone) ou de gauche (ordinateur) cache une partie de la carte. */
function viewPadding(m: MapLibreMap) {
  const el = m.getContainer();
  const wide = el.clientWidth >= 900;
  // Ordinateur : panneau de repérage à gauche, pages de l'espace chantier à droite.
  const pageOpen = !!document.querySelector('.app.page-open');
  return wide
    ? { top: 70, bottom: 20, left: 460, right: pageOpen ? 500 : 20 }
    : { top: 70, bottom: Math.round(el.clientHeight * 0.45), left: 0, right: 0 };
}

export function MapView({ basemap, filters, me, target, acces, focus, keepInView, onUserMove, onFeature, onLongPress, onMapTap }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const latest = useRef({ filters, me, target, acces, onFeature, onLongPress, onMapTap, onUserMove });
  latest.current = { filters, me, target, acces, onFeature, onLongPress, onMapTap, onUserMove };
  const overlays = (): Overlays => ({ me: latest.current.me, target: latest.current.target, acces: latest.current.acces });
  const syncOverlays = (m: MapLibreMap) => {
    const o = overlays();
    setSource(m, 'me', o.me);
    setSource(m, 'target', o.target);
    setSource(m, 'acces', o.acces);
  };

  // Création de la carte.
  useEffect(() => {
    let cancelled = false;
    let m: MapLibreMap | null = null;
    (async () => {
      const style = await buildStyle(basemap, latest.current.filters, overlays());
      if (cancelled || !container.current) return;
      const created = new MapLibreMap({
        container: container.current,
        style,
        bounds: [[-5.2, 41.3], [9.6, 51.2]],
        fitBoundsOptions: { padding: 20 },
        attributionControl: { compact: true },
        maxPitch: 0,
        dragRotate: false,
      });
      m = created;
      created.touchZoomRotate.disableRotation();
      created.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
      map.current = created;
      // Le style a été préparé avant la création : on y remet les points arrivés entre-temps.
      created.once('load', () => syncOverlays(created));

      created.on('click', (e) => {
        const { x, y } = e.point;
        const box: [[number, number], [number, number]] = [[x - 12, y - 12], [x + 12, y + 12]];
        const layers = INTERACTIVE_LAYERS.filter((id) => created.getLayer(id));
        const hits = created.queryRenderedFeatures(box, { layers });
        if (hits.length) latest.current.onFeature(hits[0], [e.lngLat.lng, e.lngLat.lat]);
        else latest.current.onMapTap();
      });

      // Appui long (iPhone : pas d'événement « contextmenu ») → « me placer ici ».
      let timer: ReturnType<typeof setTimeout> | null = null;
      let startPt: { x: number; y: number } | null = null;
      const cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
      };
      created.on('touchstart', (e) => {
        if (e.points.length !== 1) return cancel();
        startPt = e.point;
        const at: LonLat = [e.lngLat.lng, e.lngLat.lat];
        cancel();
        timer = setTimeout(() => latest.current.onLongPress(at), 650);
      });
      created.on('touchmove', (e) => {
        if (startPt && Math.hypot(e.point.x - startPt.x, e.point.y - startPt.y) > 10) cancel();
      });
      created.on('touchend', cancel);
      created.on('movestart', (e) => {
        if ((e as { originalEvent?: Event }).originalEvent) cancel();
      });
      // Geste de l'utilisateur (glisser, pincer, molette) : la carte devient libre pendant le suivi.
      const userGesture = (e: { originalEvent?: Event }) => {
        if (e.originalEvent) latest.current.onUserMove?.();
      };
      created.on('dragstart', userGesture);
      created.on('zoomstart', userGesture);
      created.on('contextmenu', (e) => latest.current.onLongPress([e.lngLat.lng, e.lngLat.lat]));
    })();
    return () => {
      cancelled = true;
      m?.remove();
      map.current = null;
    };
    // La carte n'est créée qu'une fois ; le fond change via setStyle ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changement de fond de carte.
  const firstBasemap = useRef(true);
  useEffect(() => {
    if (firstBasemap.current) {
      firstBasemap.current = false;
      return;
    }
    let cancelled = false;
    buildStyle(basemap, latest.current.filters, overlays()).then((style) => {
      const m = map.current;
      if (cancelled || !m) return;
      m.setStyle(style);
      m.once('styledata', () => syncOverlays(m));
    });
    return () => {
      cancelled = true;
    };
  }, [basemap]);

  // Filtres → visibilité des couches.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      for (const f of FILTERS) {
        for (const id of f.layers) {
          if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', filters[f.key] ? 'visible' : 'none');
        }
      }
    };
    if (m.isStyleLoaded()) apply();
    else m.once('styledata', apply);
  }, [filters]);

  // Position de l'utilisateur, destination, accès importés.
  useEffect(() => setSource(map.current, 'me', me), [me]);
  useEffect(() => setSource(map.current, 'target', target), [target]);
  useEffect(() => setSource(map.current, 'acces', acces), [acces]);

  // Recentrage demandé.
  useEffect(() => {
    if (!focus) return;
    // Le panneau du bas couvre près de la moitié de l'écran : on décale le centre vers le haut.
    const go = () =>
      map.current?.flyTo({
        center: focus.center,
        zoom: focus.zoom ?? Math.max(map.current.getZoom(), 16),
        duration: 1200,
        padding: viewPadding(map.current),
      });
    if (map.current) go();
    else setTimeout(go, 800);
  }, [focus]);

  // Suivi : la carte reste où elle est tant que le point est bien visible, sinon elle le ramène au centre.
  useEffect(() => {
    const m = map.current;
    if (!m || !keepInView) return;
    const pad = viewPadding(m);
    const el = m.getContainer();
    const pt = m.project(keepInView);
    const margin = 40;
    const inside =
      pt.x >= pad.left + margin &&
      pt.x <= el.clientWidth - pad.right - margin &&
      pt.y >= pad.top + margin &&
      pt.y <= el.clientHeight - pad.bottom - margin;
    if (!inside) m.easeTo({ center: keepInView, padding: pad, duration: 700 });
  }, [keepInView]);

  return <div ref={container} className="map" />;
}
