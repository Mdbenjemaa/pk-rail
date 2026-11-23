import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquire, combine, toFix } from './gps';

/** Faux GPS du téléphone : on envoie soi-même positions et erreurs. */
function fakeGeo() {
  let ok: (p: GeolocationPosition) => void = () => undefined;
  let ko: (e: GeolocationPositionError) => void = () => undefined;
  const geo = {
    watchPosition: vi.fn((s: typeof ok, e: typeof ko) => {
      ok = s;
      ko = e;
      return 7;
    }),
    clearWatch: vi.fn(),
  };
  vi.stubGlobal('navigator', { geolocation: geo });
  return {
    geo,
    send: (lon: number, lat: number, accuracy: number) =>
      ok({ coords: { longitude: lon, latitude: lat, accuracy }, timestamp: Date.now() } as GeolocationPosition),
    fail: (code: 1 | 2 | 3) =>
      ko({ code, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: `erreur ${code}` } as GeolocationPositionError),
  };
}

describe('acquire (Me repérer)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ne s’arrête pas sur une « position momentanément indisponible »', async () => {
    const g = fakeGeo();
    const acq = acquire(() => undefined);
    g.fail(2);
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(1000);
      g.send(2.56256, 48.64362, 4);
    }
    const fix = await acq.promise;
    // Précision visée atteinte après 3 mesures et 3 s : on n'attend pas les 12 s.
    expect(fix.samples).toBe(3);
    expect(fix.accuracy).toBe(4);
    expect(g.geo.clearWatch).toHaveBeenCalledWith(7);
  });

  it('s’arrête tout de suite si la localisation est refusée', async () => {
    const g = fakeGeo();
    const acq = acquire(() => undefined);
    g.fail(1);
    await expect(acq.promise).rejects.toMatchObject({ code: 1 });
    expect(g.geo.clearWatch).toHaveBeenCalled();
  });

  it('rend la dernière erreur s’il n’y a eu aucune position au bout du temps', async () => {
    const g = fakeGeo();
    const acq = acquire(() => undefined, 12000);
    g.fail(3);
    const result = expect(acq.promise).rejects.toMatchObject({ code: 3 });
    vi.advanceTimersByTime(12000);
    await result;
  });

  it('« Utiliser cette position » garde ce qui a été mesuré', async () => {
    const g = fakeGeo();
    const acq = acquire(() => undefined);
    g.send(2.5, 48.6, 12);
    acq.cancel();
    const fix = await acq.promise;
    expect(fix.samples).toBe(1);
    // Rien ne se passe pour les positions qui arrivent ensuite.
    g.send(3, 49, 3);
  });
});

describe('combine', () => {
  it('pondère par la précision et écarte les mesures bien moins précises', () => {
    const fix = combine([
      { lon: 2, lat: 48, accuracy: 4 },
      { lon: 2.0001, lat: 48, accuracy: 4 },
      { lon: 2.01, lat: 48.01, accuracy: 60 },
    ])!;
    expect(fix.samples).toBe(2);
    expect(fix.lonlat[0]).toBeCloseTo(2.00005, 6);
  });
});

describe('toFix (suivi)', () => {
  it('prend l’heure de la mesure quand elle est cohérente', () => {
    const f = toFix({ coords: { longitude: 2, latitude: 48, accuracy: 5 }, timestamp: 1_000_000 - 800 }, 1_000_000)!;
    expect(f.time).toBe(999_200);
    expect(f.received).toBe(1_000_000);
  });
  it('prend l’heure de réception si l’horloge GPS est décalée', () => {
    const f = toFix({ coords: { longitude: 2, latitude: 48, accuracy: 5 }, timestamp: 1_000_000 - 3_600_000 }, 1_000_000)!;
    expect(f.time).toBe(1_000_000);
  });
  it('ignore une position illisible', () => {
    expect(toFix({ coords: { longitude: NaN, latitude: 48, accuracy: 5 }, timestamp: 0 }, 1)).toBeNull();
  });
});
