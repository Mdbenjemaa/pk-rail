import { describe, expect, it } from 'vitest';
import { PkFilter } from './pkfilter';

// Bruit pseudo-aléatoire reproductible.
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return (s / 2 ** 31) * 2 - 1;
  };
}

describe('PkFilter', () => {
  it('suit une marche à 1,4 m/s en gommant le bruit GPS', () => {
    const f = new PkFilter();
    const rnd = noise(7);
    let sq = 0;
    let n = 0;
    let last = { pk: 0, v: 0 };
    for (let i = 0; i <= 200; i++) {
      const truth = 19.5 + (1.4 * i) / 1000;
      last = f.update('830000', truth + (rnd() * 6) / 1000, 5, i * 1000);
      if (i > 20) {
        sq += ((last.pk - truth) * 1000) ** 2;
        n++;
      }
    }
    // Bruit brut : ± 6 m (écart type 3,5 m) ; lissé : nettement moins.
    expect(Math.sqrt(sq / n)).toBeLessThan(2.6);
    expect(last.dir).toBe(1);
  });

  it('suit un véhicule à 60 km/h vers les PK décroissants', () => {
    const f = new PkFilter();
    let last = { pk: 0, v: 0 };
    for (let i = 0; i <= 60; i++) last = f.update('830000', 40 - (16.7 * i) / 1000, 4, i * 1000);
    expect(Math.abs(last.pk - (40 - 1.002)) * 1000).toBeLessThan(3);
    expect(last.v).toBeLessThan(-15);
    expect(last.dir).toBe(-1);
  });

  it('n’annonce pas de sens de marche quand on est immobile', () => {
    const f = new PkFilter();
    const rnd = noise(42);
    let moving = 0;
    for (let i = 0; i <= 300; i++) if (f.update('830000', 19.5 + (rnd() * 6) / 1000, 5, i * 1000).dir !== 0) moving++;
    expect(moving).toBeLessThan(8);
  });

  it('suit un freinage puis un redémarrage sans gros retard', () => {
    const f = new PkFilter();
    let x = 0;
    let v = 16.7;
    let worst = 0;
    for (let i = 0; i <= 120; i++) {
      if (i > 30 && i <= 41) v = Math.max(0, v - 1.5);
      if (i > 70 && i <= 81) v = Math.min(16.7, v + 1.5);
      x += v;
      const e = f.update('830000', 40 + x / 1000, 4, i * 1000);
      if (i > 5) worst = Math.max(worst, Math.abs(e.pk * 1000 - 40000 - x));
    }
    expect(worst).toBeLessThan(6);
  });

  it('repart de la mesure après un changement de ligne ou une coupure', () => {
    const f = new PkFilter();
    f.update('830000', 10, 5, 0);
    f.update('830000', 10.001, 5, 1000);
    expect(f.update('420000', 55.2, 5, 2000).pk).toBeCloseTo(55.2, 6);
    expect(f.update('420000', 57, 5, 60000).pk).toBeCloseTo(57, 6);
  });
});

describe('PkFilter : positions répétées', () => {
  it('une même position redonnée par le téléphone ne compte pas deux fois', () => {
    const a = new PkFilter();
    const b = new PkFilter();
    let ea = a.update('830000', 20, 5, 0);
    let eb = b.update('830000', 20, 5, 0);
    for (let i = 1; i <= 20; i++) {
      const pk = 20 + (1.4 * i) / 1000;
      ea = a.update('830000', pk, 5, i * 1000);
      // b reçoit chaque position deux fois (même heure, même PK).
      b.update('830000', pk, 5, i * 1000);
      eb = b.update('830000', pk, 5, i * 1000);
    }
    expect(eb.pk).toBeCloseTo(ea.pk, 6);
    expect(eb.v).toBeCloseTo(ea.v, 6);
  });
});
