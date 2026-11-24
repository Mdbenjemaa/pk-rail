/** Filtres de la carte, avec les types d'éléments de la liste « autour de moi » qu'ils commandent. */
export type FilterKey =
  | 'signalements'
  | 'acces'
  | 'pk'
  | 'gares'
  | 'quais'
  | 'voies'
  | 'pn'
  | 'tunnels'
  | 'ouvrages'
  | 'sst'
  | 'carres'
  | 'avert'
  | 'tiv'
  | 'sigelec'
  | 'sigautres'
  | 'vitesse'
  | 'elec';

export interface FilterDef {
  key: FilterKey;
  label: string;
  hint?: string;
  group: 'Mes données' | 'Repères' | 'Infrastructure' | 'Signalisation' | 'Caractéristiques de ligne';
  on: boolean;
  /** Couches de la carte concernées. */
  layers: string[];
  /** Types d'éléments de la liste « autour de moi ». */
  kinds: string[];
}

export const FILTERS: FilterDef[] = [
  { key: 'signalements', label: 'Mes signalements', hint: 'Anomalies signalées depuis ce téléphone', group: 'Mes données', on: true, layers: ['u-signal', 'u-signal-label'], kinds: [] },
  { key: 'acces', label: 'Mes accès (importés)', hint: 'Carte d’accès importée sur ce téléphone', group: 'Mes données', on: true, layers: ['u-acces', 'u-acces-label'], kinds: ['acces'] },
  { key: 'pk', label: 'PK calculés', hint: 'Tous les 100 m, recalés sur les repères SNCF et les bornes relevées', group: 'Repères', on: true, layers: ['r-pk-km', 'r-pk-km-label', 'r-pk-hm', 'r-pk-hm-label'], kinds: [] },
  { key: 'gares', label: 'Gares', group: 'Infrastructure', on: true, layers: ['r-gares', 'r-gares-label'], kinds: ['gare'] },
  { key: 'quais', label: 'Quais', group: 'Infrastructure', on: true, layers: ['r-quais', 'r-quais-label'], kinds: ['quai'] },
  { key: 'voies', label: 'Voies et numéros de voie', group: 'Infrastructure', on: true, layers: ['r-voies', 'r-voies-label'], kinds: [] },
  { key: 'pn', label: 'Passages à niveau', group: 'Infrastructure', on: true, layers: ['r-pn', 'r-pn-label'], kinds: ['pn'] },
  { key: 'tunnels', label: 'Tunnels', group: 'Infrastructure', on: true, layers: ['r-tunnels', 'r-tunnels-label'], kinds: ['tunnel'] },
  { key: 'ouvrages', label: 'Ponts-route, passerelles, souterrains', group: 'Infrastructure', on: false, layers: ['r-ouvrages', 'r-ouvrages-label'], kinds: ['pont', 'passerelle', 'souterrain', 'traversee'] },
  { key: 'sst', label: 'Sous-stations', group: 'Infrastructure', on: true, layers: ['r-sst', 'r-sst-label'], kinds: ['sst'] },
  { key: 'carres', label: 'Carrés, sémaphores, carrés violets', group: 'Signalisation', on: true, layers: ['r-sig-carre', 'r-sig-carre-label'], kinds: ['sig_carre'] },
  { key: 'avert', label: 'Avertissements, mirlitons', group: 'Signalisation', on: false, layers: ['r-sig-avert', 'r-sig-avert-label'], kinds: ['sig_avert'] },
  { key: 'tiv', label: 'Pancartes de vitesse (TIV, Z, R)', group: 'Signalisation', on: true, layers: ['r-sig-vitesse', 'r-sig-vitesse-label'], kinds: ['sig_vitesse'] },
  { key: 'sigelec', label: 'Signaux électriques (coupez courant…)', group: 'Signalisation', on: false, layers: ['r-sig-elec', 'r-sig-elec-label'], kinds: ['sig_elec'] },
  { key: 'sigautres', label: 'Autres signaux', group: 'Signalisation', on: false, layers: ['r-sig-autre', 'r-sig-autre-label'], kinds: ['sig_autre'] },
  { key: 'vitesse', label: 'Vitesse maximale (couleurs)', group: 'Caractéristiques de ligne', on: false, layers: ['r-vitesse'], kinds: [] },
  { key: 'elec', label: 'Électrification (couleurs)', group: 'Caractéristiques de ligne', on: false, layers: ['r-elec'], kinds: [] },
];

export type Filters = Record<FilterKey, boolean>;

export const DEFAULT_FILTERS = Object.fromEntries(FILTERS.map((f) => [f.key, f.on])) as Filters;

/** Le type d'élément (liste « autour de moi ») est-il affiché ? */
export function kindVisible(filters: Filters, kind: string): boolean {
  const f = FILTERS.find((d) => d.kinds.includes(kind));
  return f ? filters[f.key] : false;
}

/** Pastille de chaque type d'élément. */
export const KIND_BADGE: Record<string, { text: string; color: string; name: string }> = {
  acces: { text: 'Ac', color: '#047857', name: 'Accès (importé)' },
  gare: { text: 'G', color: '#1f2937', name: 'Gare' },
  quai: { text: 'Q', color: '#64748b', name: 'Quai' },
  pn: { text: 'PN', color: '#d97706', name: 'Passage à niveau' },
  tunnel: { text: 'T', color: '#4b5563', name: 'Tunnel' },
  sst: { text: 'SST', color: '#7c3aed', name: 'Sous-station' },
  pont: { text: 'P', color: '#78716c', name: 'Pont-route' },
  passerelle: { text: 'Pa', color: '#78716c', name: 'Passerelle' },
  souterrain: { text: 'PS', color: '#78716c', name: 'Passage souterrain' },
  traversee: { text: 'TV', color: '#78716c', name: 'Traversée de voie' },
  sig_carre: { text: 'C', color: '#dc2626', name: 'Signal d’arrêt' },
  sig_avert: { text: 'A', color: '#ca8a04', name: 'Avertissement' },
  sig_vitesse: { text: 'V', color: '#111827', name: 'Pancarte de vitesse' },
  sig_elec: { text: 'É', color: '#2563eb', name: 'Signal électrique' },
  sig_autre: { text: 'S', color: '#6b7280', name: 'Signal' },
};
