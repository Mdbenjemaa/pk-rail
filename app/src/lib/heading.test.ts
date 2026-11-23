import { beforeEach, describe, expect, it } from 'vitest';
import { _resetHeading, _setCompassForTests, angleDiff, compassFromEvent, currentHeading, setCourse, smoothAngle, VEHICLE_SPEED } from './heading';

describe('direction du téléphone', () => {
  beforeEach(() => _resetHeading());

  it('lit la boussole de l’iPhone et celle d’Android, et tient compte de l’écran tourné', () => {
    expect(compassFromEvent({ alpha: 10, webkitCompassHeading: 45 })).toBe(45);
    expect(compassFromEvent({ alpha: 90, absolute: true })).toBe(270);
    expect(compassFromEvent({ alpha: 90, absolute: true }, 90)).toBe(0);
    // Android sans référence au nord : inutilisable.
    expect(compassFromEvent({ alpha: 90, absolute: false })).toBeNull();
  });

  it('lisse sans sauter entre 359° et 1°', () => {
    expect(smoothAngle(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
  });

  it('en véhicule, la direction du GPS l’emporte sur la boussole', () => {
    const now = Date.now();
    _setCompassForTests(90, now);
    expect(currentHeading(now)).toBe(90);
    setCourse(180, VEHICLE_SPEED + 5, now);
    expect(currentHeading(now)).toBe(180);
    // À l'arrêt ou à pied : retour à la boussole.
    setCourse(180, 0.5, now);
    expect(currentHeading(now)).toBe(90);
  });

  it('une boussole muette depuis 3 s ne compte plus', () => {
    const now = Date.now();
    _setCompassForTests(90, now - 4000);
    expect(currentHeading(now)).toBeNull();
  });
});

describe('boussole : messages et iPhone', () => {
  it('ignore un cap iPhone pas encore étalonné (-1)', () => {
    expect(compassFromEvent({ alpha: 10, webkitCompassHeading: -1 })).toBeNull();
  });
  it('explique un refus différemment sur iPhone et sur Android', async () => {
    const { compassMessage } = await import('./heading');
    expect(compassMessage('denied', true)).toContain('Autoriser');
    expect(compassMessage('denied', false)).toContain('Capteurs de mouvement');
    expect(compassMessage('unsupported', false)).toContain('deux doigts');
  });
});
