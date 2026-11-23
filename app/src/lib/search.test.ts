import { describe, expect, it } from 'vitest';
import type { AccesSet } from './acces';
import { bestMatches, editDistance, matchScore, normName, searchAcces } from './search';

describe('recherche de gares', () => {
  it('ramène Saint à St et ignore accents et tirets', () => {
    expect(normName('Villeneuve-Saint-Georges')).toBe('villeneuve st georges');
    expect(normName("Villeneuve-l'Archevêque")).toBe('villeneuve l archeveque');
  });
  it('compte les fautes, inversions comprises', () => {
    expect(editDistance('melun', 'melun', 2)).toBe(0);
    expect(editDistance('mleun', 'melun', 2)).toBe(1);
    expect(editDistance('lieusain', 'lieusaint', 2)).toBe(1);
  });
  it('trouve malgré « Saint » au lieu de « St »', () => {
    expect(matchScore('villeneuve saint georges', 'Villeneuve-St-Georges')).toBe(0);
    expect(matchScore('saint georges', 'Villeneuve-St-Georges')).toBe(1);
  });
  it('trouve malgré une faute de frappe', () => {
    expect(matchScore('lieusiant', 'Lieusaint-Moissy')).not.toBeNull();
    expect(matchScore('montereaux', 'Montereau')).not.toBeNull();
    expect(matchScore('brunoi', 'Brunoy')).not.toBeNull();
  });
  it('ne trouve pas n’importe quoi', () => {
    expect(matchScore('mel', 'Brunoy')).toBeNull();
    expect(matchScore('paris', 'Melun')).toBeNull();
  });
  it('classe les débuts exacts avant les correspondances approchées', () => {
    const gares = ['Melunière', 'Melun', 'Mlun-Sud', 'Combs-la-Ville'];
    expect(bestMatches('melun', gares, (g) => g, 3)).toEqual(['Melunière', 'Melun', 'Mlun-Sud']);
  });
});

describe('recherche dans mes accès', () => {
  const sets = [
    {
      id: '1', name: 'Accès RVB PSE03 2026', imported: 0,
      items: [
        { name: 'Portail 12 Lieusaint', desc: 'Clé au bungalow', lonlat: [2.56, 48.64] },
        { name: 'Portail 2', desc: '', lonlat: [2.5, 48.6] },
        { name: 'Accès chemin de halage', desc: 'Portail vert', lonlat: [2.4, 48.5] },
      ],
    },
    { id: '2', name: 'Autre chantier', imported: 0, items: [{ name: 'Base vie', desc: '', lonlat: [2.3, 48.4] }] },
  ] as unknown as AccesSet[];

  it('trouve par le nom, même avec une faute, puis par la description', () => {
    expect(searchAcces('portail', sets, 10).hits.map((h) => h.a.name)).toEqual(['Portail 2', 'Portail 12 Lieusaint', 'Accès chemin de halage']);
    expect(searchAcces('lieusint', sets, 10).hits.map((h) => h.a.name)).toEqual(['Portail 12 Lieusaint']);
    expect(searchAcces('bungalow', sets, 10).hits.map((h) => h.a.name)).toEqual(['Portail 12 Lieusaint']);
  });

  it('liste tous les accès d’un fichier par son nom, avec le total', () => {
    const r = searchAcces('PSE03', sets, 2);
    expect(r.total).toBe(3);
    expect(r.hits).toHaveLength(2);
    expect(searchAcces('a', sets, 10).total).toBe(0);
    expect(searchAcces('portail', sets, 10).exact).toBe(true);
    expect(searchAcces('bungalow', sets, 10).exact).toBe(false);
  });
});
