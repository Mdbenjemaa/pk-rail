import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Cell, LineDoc } from './data';
import { fmtDist, fmtLine, fmtPk } from './format';
import { combine } from './gps';
import { cellsAround, matchInCells, pickFollowLine, pickLine, searchRadius } from './locate';
import { aroundPk, sectionAt } from './nearby';

const DATA = 'public/data';
const cellsFor = (lon: number, lat: number, radius: number): Cell[] =>
  cellsAround([lon, lat], radius, 4)
    .map((k) => `${DATA}/cells/${k}.json`)
    .filter((p) => existsSync(p))
    .map((p) => JSON.parse(readFileSync(p, 'utf8')) as Cell);
const line = (code: string) => JSON.parse(readFileSync(`${DATA}/lines/${code}.json`, 'utf8')) as LineDoc;

describe('format', () => {
  it('écrit les PK comme la SNCF', () => {
    expect(fmtPk(19.663)).toBe('19+663');
    expect(fmtPk(0.05)).toBe('0+050');
    expect(fmtPk(-0.771)).toBe('-0+771');
  });
  it('écrit distances et lignes', () => {
    expect(fmtDist(85.4)).toBe('85 m');
    expect(fmtDist(1234)).toBe('1,2 km');
    expect(fmtLine('830000')).toBe('830 000');
  });
});

describe('GPS', () => {
  it('combine les mesures en favorisant les plus précises', () => {
    const fix = combine([
      { lon: 2.0, lat: 48.0, accuracy: 30 },
      { lon: 2.0001, lat: 48.0, accuracy: 5 },
      { lon: 2.0001, lat: 48.0, accuracy: 6 },
    ])!;
    expect(fix.accuracy).toBe(5);
    expect(fix.samples).toBe(2);
    expect(fix.lonlat[0]).toBeCloseTo(2.0001, 6);
  });
});

describe('rattachement aux lignes (données réelles)', () => {
  it('retrouve la ligne et le PK du PN 35 de Willer-sur-Thur (ligne 130 000, PK 19+663)', () => {
    const p: [number, number] = [7.068403964258318, 47.843487148602506];
    const m = matchInCells(cellsFor(...p, 60), p, 60);
    const best = pickLine(m.lines)!;
    expect(best.code).toBe('130000');
    expect(Math.abs(best.pk - 19.663) * 1000).toBeLessThan(30);
  });

  it('retrouve la gare de Porte Maillot (ligne 979 000, PK 5+500)', () => {
    const p: [number, number] = [2.282700734140375, 48.87802770024631];
    const m = matchInCells(cellsFor(...p, 60), p, 60);
    const l = m.lines.find((x) => x.code === '979000');
    expect(l).toBeDefined();
    expect(Math.abs(l!.pk - 5.5) * 1000).toBeLessThan(40);
  });

  it('retient la ligne la plus proche', () => {
    const lines = [
      { code: 'A', rg: '1', statut: 'E', dist: 4, pk: 1, point: [0, 0] as [number, number], bearing: 0 },
      { code: 'B', rg: '1', statut: 'E', dist: 19, pk: 2, point: [0, 0] as [number, number], bearing: 0 },
    ];
    expect(pickLine(lines)!.code).toBe('A');
    expect(pickLine([])).toBe(null);
  });

  it('élargit la recherche quand le GPS est imprécis', () => {
    expect(searchRadius(5)).toBeLessThan(searchRadius(40));
    expect(searchRadius(5)).toBeGreaterThanOrEqual(60);
  });
});

describe('éléments autour du PK (données réelles)', () => {
  it('liste le PN 35 près du PK 19+600 de la ligne 130 000', () => {
    const doc = line('130000');
    const around = aroundPk(doc, 19.6, () => true);
    const pn = around.ahead.find((i) => i.kind === 'pn' && i.label === 'PN 35');
    expect(pn).toBeDefined();
    expect(pn!.dist).toBeCloseTo(63, -1);
  });

  it('donne la vitesse nominale au PK', () => {
    const doc = line('130000');
    expect(sectionAt(doc, 'vmax', 19.6)).toMatch(/^\d+$/);
  });
});

describe('voies proches (données réelles)', () => {
  it('trouve les mêmes voies que la recherche complète, en écartant vite les voies lointaines', () => {
    // Paris Gare de Lyon : la case la plus chargée de France.
    const p: [number, number] = [2.373, 48.8443];
    const cells = cellsFor(...p, 60);
    const m = matchInCells(cells, p, 60);
    // Recherche complète, sans tri préalable : toutes les voies nommées à moins de 60 m.
    const brute = new Map<string, number>();
    const R = 6371008.8;
    const kx = (Math.PI / 180) * R * Math.cos((p[1] * Math.PI) / 180);
    const ky = (Math.PI / 180) * R;
    for (const c of cells) {
      for (const [code, name, , runs] of c.v) {
        if (!name) continue;
        for (const run of runs) {
          for (let i = 0; i + 3 < run.length; i += 2) {
            const ax = (run[i] / 1e5 - p[0]) * kx;
            const ay = (run[i + 1] / 1e5 - p[1]) * ky;
            const bx = (run[i + 2] / 1e5 - p[0]) * kx;
            const by = (run[i + 3] / 1e5 - p[1]) * ky;
            const dx = bx - ax;
            const dy = by - ay;
            const t = Math.max(0, Math.min(1, dx || dy ? -(ax * dx + ay * dy) / (dx * dx + dy * dy) : 0));
            const d = Math.hypot(ax + dx * t, ay + dy * t);
            if (d <= 60) brute.set(`${code}|${name}`, Math.min(d, brute.get(`${code}|${name}`) ?? Infinity));
          }
        }
      }
    }
    expect(brute.size).toBeGreaterThan(3);
    expect(new Set(m.tracks.map((t) => `${t.code}|${t.name}`))).toEqual(new Set(brute.keys()));
  });
});

describe('pickFollowLine', () => {
  const cand = (code: string, dist: number) => ({ code, rg: '', statut: '', dist, pk: 1, point: [0, 0] as [number, number], bearing: 0 });
  it('reste sur la ligne suivie quand une autre ligne passe un peu plus près', () => {
    expect(pickFollowLine([cand('B', 4), cand('A', 11)], 'A', 5)?.code).toBe('A');
  });
  it('change de ligne quand la ligne suivie s’éloigne nettement', () => {
    expect(pickFollowLine([cand('B', 3), cand('A', 45)], 'A', 5)?.code).toBe('B');
  });
  it('prend la meilleure ligne quand la ligne suivie n’est plus proche', () => {
    expect(pickFollowLine([cand('B', 3)], 'A', 5)?.code).toBe('B');
  });
});
