import { describe, expect, it } from 'vitest';
import { standaloneGap } from './viewport';

// iPhone 15/16 : écran 393 × 852, barre d'état 59 px.
const base = { standalone: true, ios: true, safeTop: 59, width: 393, screenW: 393, screenH: 852 };

describe('bande vide en bas sur iPhone (appli installée)', () => {
  it('corrige quand la page est raccourcie de la hauteur de la barre d’état', () => {
    expect(standaloneGap({ ...base, height: 793 })).toBe(59);
  });
  it('ne fait rien quand iOS donne déjà toute la hauteur', () => {
    expect(standaloneGap({ ...base, height: 852 })).toBe(0);
  });
  it('ne fait rien dans Safari (appli non installée), sur Android ou sans barre d’état transparente', () => {
    expect(standaloneGap({ ...base, standalone: false, height: 793 })).toBe(0);
    expect(standaloneGap({ ...base, ios: false, height: 793 })).toBe(0);
    expect(standaloneGap({ ...base, safeTop: 0, height: 793 })).toBe(0);
  });
  it('ne fait rien pour un écart qui n’est pas la barre d’état (iPad en écran partagé, clavier…)', () => {
    expect(standaloneGap({ ...base, height: 500 })).toBe(0);
  });
  it('en paysage, compare au petit côté de l’écran', () => {
    expect(standaloneGap({ ...base, safeTop: 0, width: 852, height: 393 })).toBe(0);
    expect(standaloneGap({ ...base, safeTop: 24, width: 852, height: 369 })).toBe(24);
  });
});
