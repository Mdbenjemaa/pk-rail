/** [longitude, latitude] */
export type LonLat = [number, number];

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function distance(a: LonLat, b: LonLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Projection locale en mètres autour d'un point de référence : suffisante à l'échelle
 * de quelques kilomètres (erreur < 0,1 %).
 */
export function localProjector(ref: LonLat) {
  const kx = 111320 * Math.cos(rad(ref[1]));
  const ky = 110574;
  return {
    toXY: (p: LonLat): [number, number] => [(p[0] - ref[0]) * kx, (p[1] - ref[1]) * ky],
    toLonLat: (x: number, y: number): LonLat => [ref[0] + x / kx, ref[1] + y / ky],
  };
}

export interface SegmentHit {
  /** Distance (m) du point au segment. */
  dist: number;
  /** Position sur le segment, de 0 à 1. */
  t: number;
  x: number;
  y: number;
}

/** Point le plus proche sur le segment AB (coordonnées planes en mètres, point étudié à l'origine). */
export function closestOnSegment(ax: number, ay: number, bx: number, by: number): SegmentHit {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { dist: Math.hypot(x, y), t, x, y };
}

export function bboxAround(p: LonLat, meters: number): [number, number, number, number] {
  const dLat = meters / 110574;
  const dLon = meters / (111320 * Math.cos(rad(p[1])));
  return [p[0] - dLon, p[1] - dLat, p[0] + dLon, p[1] + dLat];
}
