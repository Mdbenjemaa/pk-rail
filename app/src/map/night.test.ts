import { describe, expect, it } from 'vitest';
import type { LayerSpecification } from 'maplibre-gl';
import { nightColor, nightLayers, parseColor } from './night';

const lum = (c: string) => {
  const [r, g, b] = parseColor(c)!;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
};

describe('parseColor', () => {
  it('lit les formats courants', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('#112f54')).toEqual([17, 47, 84, 1]);
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30, 0.5]);
    expect(parseColor('hsl(0, 0%, 100%)')).toEqual([255, 255, 255, 1]);
    expect(parseColor('Noto Sans Regular')).toBeNull();
    expect(parseColor('park')).toBeNull();
  });
});

describe('nightColor', () => {
  it('assombrit les fonds et éclaircit les textes', () => {
    expect(lum(nightColor('#f2f3f0', 'fond'))).toBeLessThan(0.12);
    expect(lum(nightColor('#ffffff', 'route'))).toBeGreaterThan(lum(nightColor('#f2f3f0', 'fond')));
    expect(lum(nightColor('#666666', 'texte'))).toBeGreaterThan(0.6);
    expect(lum(nightColor('#ffffff', 'halo'))).toBeLessThan(0.1);
    expect(nightColor('rgba(255,255,255,0.4)', 'fond')).toMatch(/^rgba\(.*0\.4\)$/);
  });
});

describe('nightLayers', () => {
  it('ne touche qu’aux propriétés de couleur, même dans les expressions', () => {
    const layers = [
      { id: 'background', type: 'background', paint: { 'background-color': '#f2f3f0' } },
      {
        id: 'landuse', type: 'fill', source: 's', 'source-layer': 'l',
        paint: { 'fill-color': ['match', ['get', 'class'], 'park', '#d8e8c8', '#eeeeee'], 'fill-opacity': 0.5 },
      },
      { id: 'label', type: 'symbol', source: 's', 'source-layer': 'l', layout: { 'text-field': '{name}' }, paint: { 'text-color': '#666666' } },
    ] as LayerSpecification[];
    const out = nightLayers(layers) as unknown as { paint: Record<string, unknown>; layout?: Record<string, unknown> }[];
    expect(lum(out[0].paint['background-color'] as string)).toBeLessThan(0.12);
    const expr = out[1].paint['fill-color'] as unknown[];
    expect(expr[2]).toBe('park');
    expect(lum(expr[3] as string)).toBeLessThan(0.15);
    expect(out[1].paint['fill-opacity']).toBe(0.5);
    expect(out[2].layout?.['text-field']).toBe('{name}');
  });
});

describe('noms du fond plan en français', () => {
  it('remplace les noms anglais, garde les numéros de route', async () => {
    const { frenchLabels } = await import('./night');
    const out = frenchLabels([
      { id: 'pays', type: 'symbol', source: 'o', layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']] } },
      { id: 'route', type: 'symbol', source: 'o', layout: { 'text-field': ['to-string', ['get', 'ref']] } },
      { id: 'eau', type: 'fill', source: 'o' },
    ] as never);
    expect(JSON.stringify(out[0].layout)).toContain('name:fr');
    expect(JSON.stringify(out[1].layout)).toContain('ref');
    expect(out[2]).toEqual({ id: 'eau', type: 'fill', source: 'o' });
  });
});
