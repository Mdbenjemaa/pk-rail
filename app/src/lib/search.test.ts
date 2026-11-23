import { describe, expect, it } from 'vitest';
import { bestMatches, editDistance, matchScore, normName } from './search';

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
