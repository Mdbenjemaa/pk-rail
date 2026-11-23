import type { AccesSet } from './acces';
import type { LineDoc, LinePoint } from './data';
import { kindVisible, type Filters } from './layers';
import { aroundPk, sectionAt, statutAt, type Around } from './nearby';

/** « Ligne de Paris-Lyon à Marseille-St-Charles » → « Paris-Lyon → Marseille-St-Charles ». */
export function shortLineName(name: string | null | undefined): string {
  if (!name) return 'Ligne sans nom';
  const s = name.replace(/^ligne\s+(de\s+|d['’]\s*|du\s+|des\s+)?/i, '');
  const i = s.indexOf(' à ');
  return i > 0 ? `${s.slice(0, i)} → ${s.slice(i + 3)}` : s;
}

/** Cantonnement en abrégé, comme dans les renseignements techniques (BAL, BAPR, CAPI…). */
export function cantShort(v: string | null | undefined): string | null {
  if (!v || v.startsWith('_')) return null;
  return v
    .split('/')
    .map((s) => {
      if (/^Block automatique lumineux de voie banalisée/i.test(s)) return 'BAL VB';
      if (/^Block automatique lumineux/i.test(s)) return 'BAL';
      if (/^Block automatique à permissivité restreinte de voie banalisée/i.test(s)) return 'BAPR VB';
      if (/^Block automatique à permissivité restreinte/i.test(s)) return 'BAPR';
      if (/tram/i.test(s)) return 'Tram';
      if (/^Block manuel de voie unique/i.test(s)) return 'BM VU';
      if (/^Block manuel/i.test(s)) return 'BM';
      if (/^Cantonnement téléphonique assisté/i.test(s)) return 'CAPI';
      if (/^Cantonnement téléphonique de voie unique/i.test(s)) return 'Cant. tél. VU';
      if (/^Cantonnement téléphonique/i.test(s)) return 'Cant. tél.';
      const etcs = /European train control system (\d)/i.exec(s);
      if (etcs) return `ETCS ${etcs[1]}`;
      const tvm = /Transmission voie-machine (\d+)/i.exec(s);
      if (tvm) return `TVM ${tvm[1]}`;
      return s.trim();
    })
    .join(' · ');
}

export interface LineChip {
  text: string;
  /** Tronçon fermé, neutralisé… : à signaler. */
  warn?: boolean;
}

/** Pastilles du bandeau : statut (s'il n'est pas « exploitée »), vitesse, électrification, cantonnement, KVB. */
export function lineChips(doc: LineDoc, pk: number): LineChip[] {
  const chips: LineChip[] = [];
  const statut = statutAt(doc, pk);
  if (statut && statut !== 'Exploitée') chips.push({ text: statut, warn: true });
  const vmax = sectionAt(doc, 'vmax', pk);
  if (vmax) chips.push({ text: `${vmax} km/h` });
  const elec = sectionAt(doc, 'elec', pk);
  if (elec) chips.push({ text: elec });
  const cant = cantShort(sectionAt(doc, 'cant', pk));
  if (cant) chips.push({ text: cant });
  if (sectionAt(doc, 'kvb', pk)) chips.push({ text: 'KVB' });
  return chips;
}

/** Filtres des listes de part et d'autre du PK. */
export const TYPES: { key: string; label: string; test: (kind: string) => boolean }[] = [
  { key: 'tout', label: 'Tout', test: () => true },
  { key: 'sig', label: 'Signaux', test: (k) => k.startsWith('sig_') },
  { key: 'gare', label: 'Gares', test: (k) => k === 'gare' || k === 'quai' },
  { key: 'pn', label: 'PN', test: (k) => k === 'pn' },
  { key: 'acces', label: 'Mes accès', test: (k) => k === 'acces' },
];

/** Accès importés rattachés à cette ligne, au format des points de ligne. */
export function accesOnLine(acces: AccesSet[], code: string): LinePoint[] {
  return acces.flatMap((set) =>
    set.items
      .filter((a) => a.code === code && a.pk !== undefined)
      .map((a): LinePoint => [a.pk!, 'acces', a.name, a.desc.split('\n')[0] ?? '', a.lonlat[0], a.lonlat[1]]),
  );
}

/** Éléments autour du PK, selon les couches affichées et le filtre de type choisi. */
export function aroundHere(doc: LineDoc, pk: number, filters: Filters, typeFiltre: string, acces: LinePoint[]): Around {
  const test = (TYPES.find((t) => t.key === typeFiltre) ?? TYPES[0]).test;
  const points = acces.length ? doc.points.concat(acces) : doc.points;
  const a = aroundPk({ ...doc, points }, pk, (k) => kindVisible(filters, k) && test(k));
  return { ahead: uniqueItems(a.ahead), behind: uniqueItems(a.behind), inside: uniqueItems(a.inside) };
}

/** Les données contiennent parfois deux fois le même élément (même nom, même PK) : on n'en garde qu'un. */
export function uniqueItems<T extends { kind: string; label: string; pk: number; pkEnd?: number }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = `${it.kind}|${it.label}|${it.pk}|${it.pkEnd ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Détail lisible : pour un quai, « 315 m » est sa longueur, pas une distance. */
export function itemDetail(kind: string, detail: string): string {
  return kind === 'quai' ? detail.replace(/ · (\d+) m$/, ' · quai de $1\u00a0m') : detail;
}
