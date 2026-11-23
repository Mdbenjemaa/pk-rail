import type { Feature, FeatureCollection } from 'geojson';
import type { LonLat } from './geo';

/**
 * Cercle de précision + position + point au droit sur la ligne, pour la carte.
 * `gps` : vraie position du téléphone (le faisceau de direction s'affiche), pas un point placé à la main.
 */
export function meFeatures(at: LonLat, accuracy: number, snap: LonLat | null, gps = true): FeatureCollection {
  const ring: LonLat[] = [];
  const r = Math.max(accuracy, 2);
  const kx = 111320 * Math.cos((at[1] * Math.PI) / 180);
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    ring.push([at[0] + (Math.cos(a) * r) / kx, at[1] + (Math.sin(a) * r) / 110574]);
  }
  const features: Feature[] = [
    { type: 'Feature', properties: { role: 'accuracy' }, geometry: { type: 'Polygon', coordinates: [ring] } },
    { type: 'Feature', properties: { role: 'me', gps }, geometry: { type: 'Point', coordinates: at } },
  ];
  if (snap) {
    features.push(
      { type: 'Feature', properties: { role: 'link' }, geometry: { type: 'LineString', coordinates: [at, snap] } },
      { type: 'Feature', properties: { role: 'snap' }, geometry: { type: 'Point', coordinates: snap } },
    );
  }
  return { type: 'FeatureCollection', features };
}

/** Lecture/écriture tolérantes du stockage local (mode privé, quotas…). */
export function loadPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage indisponible : préférence non retenue
  }
}
