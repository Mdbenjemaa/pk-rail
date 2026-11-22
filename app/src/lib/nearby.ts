import type { LineDoc, LinePoint, SectionKind } from './data';

export interface Around {
  /** PK croissants. */
  ahead: AroundItem[];
  /** PK décroissants. */
  behind: AroundItem[];
  /** Éléments dans lesquels on se trouve (tunnel, quai). */
  inside: AroundItem[];
}

export interface AroundItem {
  pk: number;
  pkEnd?: number;
  kind: string;
  label: string;
  detail: string;
  lonlat: [number, number];
  /** Distance le long de la ligne (m). */
  dist: number;
}

function item(p: LinePoint, here: number): AroundItem {
  const [pk, kind, label, detail, lon, lat, pkEnd] = p;
  return { pk, pkEnd, kind, label, detail, lonlat: [lon, lat], dist: Math.abs(pk - here) * 1000 };
}

/** Éléments de part et d'autre du PK, du plus proche au plus loin. */
export function aroundPk(
  doc: LineDoc,
  here: number,
  visible: (kind: string) => boolean,
  maxKm = 15,
  perSide = 8,
): Around {
  const ahead: AroundItem[] = [];
  const behind: AroundItem[] = [];
  const inside: AroundItem[] = [];
  for (const p of doc.points) {
    if (!visible(p[1])) continue;
    const pk = p[0];
    const end = p[6];
    if (end !== undefined && pk <= here && here <= end) {
      inside.push(item(p, here));
      continue;
    }
    if (Math.abs(pk - here) > maxKm) continue;
    if (pk >= here) ahead.push(item(p, here));
    else behind.push(item(p, here));
  }
  ahead.sort((a, b) => a.dist - b.dist);
  behind.sort((a, b) => a.dist - b.dist);
  return { ahead: ahead.slice(0, perSide), behind: behind.slice(0, perSide), inside };
}

/** Valeur d'une caractéristique (vitesse, électrification…) au PK donné. */
export function sectionAt(doc: LineDoc, kind: SectionKind, pk: number): string | null {
  for (const [lo, hi, value] of doc.sections[kind] ?? []) {
    if (pk >= lo - 0.001 && pk <= hi + 0.001) return value;
  }
  return null;
}

export function statutAt(doc: LineDoc, pk: number): string | null {
  for (const t of doc.troncons) {
    const lo = Math.min(t.pkd, t.pkf);
    const hi = Math.max(t.pkd, t.pkf);
    if (pk >= lo - 0.01 && pk <= hi + 0.01) return t.statut;
  }
  return null;
}
