import { bboxAround, closestOnSegment, localProjector, type LonLat } from './geo';
import type { Cell } from './data';

export interface LineCandidate {
  code: string;
  rg: string;
  statut: string;
  /** Distance (m) entre la position et l'axe de la ligne. */
  dist: number;
  /** PK au droit de la position (km). */
  pk: number;
  /** Point de la ligne au droit de la position. */
  point: LonLat;
  /** Sens des PK croissants à cet endroit (degrés, 0 = nord). */
  bearing: number;
}

export interface TrackCandidate {
  code: string;
  name: string;
  type: string;
  dist: number;
}

export interface Match {
  lines: LineCandidate[];
  tracks: TrackCandidate[];
}

/** Cases de 1/n degré qui couvrent un cercle autour du point. */
export function cellsAround(p: LonLat, radius: number, perDegree: number): string[] {
  const [w, s, e, n] = bboxAround(p, radius);
  const out: string[] = [];
  for (let x = Math.floor(w * perDegree); x <= Math.floor(e * perDegree); x++) {
    for (let y = Math.floor(s * perDegree); y <= Math.floor(n * perDegree); y++) out.push(`${x}_${y}`);
  }
  return out;
}

/**
 * Lignes et voies proches d'un point, dans les cases chargées.
 * Une seule réponse par ligne (la plus proche) ; une par voie nommée.
 */
export function matchInCells(cells: Cell[], p: LonLat, radius: number): Match {
  const proj = localProjector(p);
  // Même projection que localProjector, calculée en place : pas d'objet créé par sommet (appelé à chaque position GPS).
  const kx = proj.kx / 1e5;
  const ky = proj.ky / 1e5;
  const x0 = p[0] * 1e5;
  const y0 = p[1] * 1e5;
  const lines = new Map<string, LineCandidate>();
  const tracks = new Map<string, TrackCandidate>();

  for (const cell of cells) {
    for (const [code, rg, statut, runs] of cell.l) {
      for (const run of runs) {
        for (let i = 0; i + 5 < run.length; i += 3) {
          const ax = (run[i] - x0) * kx;
          const ay = (run[i + 1] - y0) * ky;
          const bx = (run[i + 3] - x0) * kx;
          const by = (run[i + 4] - y0) * ky;
          // Rejet rapide : segment entièrement d'un côté, hors du rayon.
          if (
            (ax > radius && bx > radius) ||
            (ax < -radius && bx < -radius) ||
            (ay > radius && by > radius) ||
            (ay < -radius && by < -radius)
          ) continue;
          const hit = closestOnSegment(ax, ay, bx, by);
          if (hit.dist > radius) continue;
          const prev = lines.get(code);
          if (prev && prev.dist <= hit.dist) continue;
          const pkA = run[i + 2] / 1000;
          const pkB = run[i + 5] / 1000;
          const increasing = pkB >= pkA;
          const [fx, fy] = increasing ? [bx - ax, by - ay] : [ax - bx, ay - by];
          lines.set(code, {
            code,
            rg,
            statut,
            dist: hit.dist,
            pk: pkA + (pkB - pkA) * hit.t,
            point: proj.toLonLat(hit.x, hit.y),
            bearing: ((Math.atan2(fx, fy) * 180) / Math.PI + 360) % 360,
          });
        }
      }
    }
    for (const [code, name, type, runs] of cell.v) {
      if (!name) continue;
      const key = `${code}|${name}`;
      for (const run of runs) {
        for (let i = 0; i + 3 < run.length; i += 2) {
          const ax = (run[i] - x0) * kx;
          const ay = (run[i + 1] - y0) * ky;
          const bx = (run[i + 2] - x0) * kx;
          const by = (run[i + 3] - y0) * ky;
          if (
            (ax > radius && bx > radius) ||
            (ax < -radius && bx < -radius) ||
            (ay > radius && by > radius) ||
            (ay < -radius && by < -radius)
          ) continue;
          const hit = closestOnSegment(ax, ay, bx, by);
          if (hit.dist > radius) continue;
          const prev = tracks.get(key);
          if (!prev || hit.dist < prev.dist) tracks.set(key, { code, name, type, dist: hit.dist });
        }
      }
    }
  }
  return {
    lines: [...lines.values()].sort((a, b) => a.dist - b.dist),
    tracks: [...tracks.values()].sort((a, b) => a.dist - b.dist),
  };
}

/** Rayon de recherche autour de la position : précision GPS + marge. */
export function searchRadius(accuracy: number): number {
  const acc = Math.min(Math.max(accuracy, 3), 150);
  return Math.round(Math.max(60, acc * 2 + 30));
}

/** Ligne retenue : la plus proche. Les autres restent proposées à l'écran. */
export function pickLine(lines: LineCandidate[]): LineCandidate | null {
  return lines[0] ?? null;
}

/**
 * Pendant le suivi : on reste sur la ligne en cours tant qu'elle reste plausible,
 * pour ne pas sauter d'une ligne à l'autre aux bifurcations ou quand deux lignes se longent.
 */
export function pickFollowLine(
  lines: LineCandidate[],
  current: string | null | undefined,
  accuracy: number,
): LineCandidate | null {
  const best = pickLine(lines);
  const cur = current ? lines.find((l) => l.code === current) : undefined;
  if (!best || !cur || cur === best) return best;
  return cur.dist <= best.dist + Math.max(12, Math.min(accuracy, 40)) ? cur : best;
}
