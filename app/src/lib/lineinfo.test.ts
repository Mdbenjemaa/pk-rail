import { describe, expect, it } from 'vitest';
import type { LineDoc } from './data';
import { DEFAULT_FILTERS } from './layers';
import { aroundHere, cantShort, lineChips, shortLineName } from './lineinfo';

describe('shortLineName', () => {
  it('raccourcit le nom de ligne', () => {
    expect(shortLineName('Ligne de Paris-Lyon à Marseille-St-Charles')).toBe('Paris-Lyon → Marseille-St-Charles');
    expect(shortLineName('Ligne d’Argenteuil à Mantes-Station')).toBe('Argenteuil → Mantes-Station');
    expect(shortLineName('LGV Sud-Est')).toBe('LGV Sud-Est');
    expect(shortLineName(null)).toBe('Ligne sans nom');
  });
});

describe('cantShort', () => {
  it('abrège les cantonnements connus', () => {
    expect(cantShort('Block automatique lumineux')).toBe('BAL');
    expect(cantShort('Block automatique à permissivité restreinte de voie banalisée')).toBe('BAPR VB');
    expect(cantShort('Cantonnement téléphonique assisté par informatique')).toBe('CAPI');
    expect(cantShort('European train control system 2/Transmission voie-machine 300')).toBe('ETCS 2 · TVM 300');
    expect(cantShort('_Autre')).toBeNull();
    expect(cantShort(null)).toBeNull();
  });
});

const doc: LineDoc = {
  code: '830000',
  name: 'Ligne de Paris-Lyon à Marseille-St-Charles',
  pk: [0, 50],
  troncons: [{ rg: 1, pkd: 0, pkf: 50, statut: 'Exploitée', g: [] }],
  sections: {
    vmax: [[26, 44, '160']],
    elec: [[0, 50, '1500 V']],
    cant: [[0, 50, 'Block automatique lumineux']],
    kvb: [[0, 50, 'KVB']],
  },
  points: [
    [29.033, 'sig_carre', 'Carré c905', '', 2.55, 48.6, null, 'CARRE'],
    [28.704, 'sig_carre', 'Carré c906', '', 2.55, 48.6, null, 'CARRE'],
    [30.497, 'gare', 'Lieusaint-Moissy', 'Voyageurs', 2.56, 48.62],
  ],
} as unknown as LineDoc;

describe('lineChips', () => {
  it('donne vitesse, électrification, cantonnement et KVB', () => {
    expect(lineChips(doc, 28.718).map((c) => c.text)).toEqual(['160 km/h', '1500 V', 'BAL', 'KVB']);
  });
});

describe('aroundHere', () => {
  it('trie de part et d’autre du PK et applique le filtre de type', () => {
    const all = aroundHere(doc, 28.718, DEFAULT_FILTERS, 'tout', []);
    expect(all.ahead.map((i) => i.label)).toEqual(['Carré c905', 'Lieusaint-Moissy']);
    expect(all.behind.map((i) => i.label)).toEqual(['Carré c906']);
    expect(Math.round(all.ahead[0].dist)).toBe(315);
    const gares = aroundHere(doc, 28.718, DEFAULT_FILTERS, 'gare', []);
    expect(gares.ahead.map((i) => i.label)).toEqual(['Lieusaint-Moissy']);
    expect(gares.behind).toHaveLength(0);
  });
});

describe('aroundHere — doublons', () => {
  it('ne garde qu’une fois un élément présent deux fois dans les données', () => {
    const quai = [30.329, 'quai', 'Quai 1', 'Lieusaint-Moissy · 315 m', 2.56, 48.62, 30.644] as unknown as LineDoc['points'][number];
    const twice = { ...doc, points: [...doc.points, quai, quai] } as LineDoc;
    const a = aroundHere(twice, 28.718, DEFAULT_FILTERS, 'gare', []);
    expect(a.ahead.map((i) => i.label)).toEqual(['Quai 1', 'Lieusaint-Moissy']);
  });
});
