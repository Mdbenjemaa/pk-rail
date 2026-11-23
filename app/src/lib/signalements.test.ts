import { describe, expect, it } from 'vitest';
import { signalementFeatures, signalementText, type Signalement } from './signalements';

const s: Signalement = {
  id: 'a1',
  created: new Date('2026-11-24T08:05:00+01:00').getTime(),
  type: 'vegetation',
  gravite: 'urgente',
  comment: 'Branche sur la voie 2',
  photos: [],
  lonlat: [2.56256, 48.64362],
  accuracy: 4,
  manuel: false,
  code: '830000',
  pk: 28.718,
  ligne: 'Ligne de Paris-Lyon à Marseille-St-Charles',
  voie: 'V2',
};

describe('signalements', () => {
  it('écrit un message lisible avec la ligne, le PK, la voie et un lien de carte', () => {
    const t = signalementText(s);
    expect(t).toContain('Végétation · URGENT');
    expect(t).toContain('Ligne 830 000 (Ligne de Paris-Lyon à Marseille-St-Charles) · PK 28+718 · voie V2');
    expect(t).toContain('(GPS ± 4 m)');
    expect(t).toContain('https://www.google.com/maps?q=48.643620,2.562560');
    expect(t).toContain('Branche sur la voie 2');
  });

  it('dit quand la position a été placée à la main, ou loin de toute ligne', () => {
    const t = signalementText({ ...s, manuel: true, code: undefined, pk: undefined, gravite: 'faible' });
    expect(t).toContain('gravité faible');
    expect(t).toContain('Hors ligne connue');
    expect(t).toContain('(placée sur la carte)');
  });

  it('donne un point coloré selon la gravité pour la carte', () => {
    const fc = signalementFeatures([s]);
    expect(fc.features[0].properties).toMatchObject({ id: 'a1', n: 'Végétation', g: 'urgente', c: '#dc2626' });
  });
});
