import type { LonLat } from './geo';

export interface Fix {
  lonlat: LonLat;
  /** Rayon de précision annoncé par le téléphone (m, 68 %). */
  accuracy: number;
  samples: number;
  time: number;
}

export interface Sample {
  lon: number;
  lat: number;
  accuracy: number;
}

/**
 * Moyenne pondérée des mesures les plus précises (poids 1/précision²).
 * On écarte celles deux fois moins précises que la meilleure.
 */
export function combine(samples: Sample[]): Fix | null {
  if (!samples.length) return null;
  const best = Math.min(...samples.map((s) => s.accuracy));
  const used = samples.filter((s) => s.accuracy <= Math.max(best * 2, best + 3));
  let w = 0;
  let lon = 0;
  let lat = 0;
  for (const s of used) {
    const k = 1 / Math.max(s.accuracy, 1) ** 2;
    w += k;
    lon += s.lon * k;
    lat += s.lat * k;
  }
  return { lonlat: [lon / w, lat / w], accuracy: best, samples: used.length, time: Date.now() };
}

export function geoErrorMessage(err: GeolocationPositionError | Error): string {
  if ('code' in err) {
    if (err.code === err.PERMISSION_DENIED) {
      return 'Localisation refusée. Sur iPhone : Réglages › Confidentialité › Service de localisation › Safari (ou PK Rail) › « Lorsque l’app est active » et « Position exacte ».';
    }
    if (err.code === err.POSITION_UNAVAILABLE) return 'Position indisponible : dégage la vue du ciel et réessaie.';
    if (err.code === err.TIMEOUT) return 'Le GPS ne répond pas assez vite : réessaie à découvert.';
  }
  return err.message || 'Erreur de localisation';
}

export interface Acquisition {
  promise: Promise<Fix>;
  cancel: () => void;
}

/**
 * Repérage précis : écoute le GPS quelques secondes et combine les mesures.
 * S'arrête plus tôt si la précision visée est atteinte.
 */
export function acquire(
  onUpdate: (current: Fix, elapsedMs: number) => void,
  durationMs = 12000,
  target = 5,
): Acquisition {
  let watchId: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finish: (() => void) | null = null;
  const samples: Sample[] = [];
  const start = Date.now();

  const promise = new Promise<Fix>((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Ce navigateur ne donne pas accès au GPS.'));
      return;
    }
    const done = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (timer) clearTimeout(timer);
      const fix = combine(samples);
      if (fix) resolve(fix);
      else reject(new Error('Aucune position reçue. Vérifie que la localisation est activée.'));
    };
    finish = done;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        samples.push({ lon: pos.coords.longitude, lat: pos.coords.latitude, accuracy: pos.coords.accuracy });
        const current = combine(samples)!;
        const elapsed = Date.now() - start;
        onUpdate(current, elapsed);
        if (samples.length >= 3 && current.accuracy <= target && elapsed >= 3000) done();
      },
      (err) => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        if (timer) clearTimeout(timer);
        if (samples.length) done();
        else reject(err);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: durationMs + 8000 },
    );
    timer = setTimeout(done, durationMs);
  });

  return {
    promise,
    cancel: () => finish?.(),
  };
}

/** Suivi en continu (marche le long des voies). */
export function follow(onFix: (f: Fix) => void, onError: (e: GeolocationPositionError) => void): () => void {
  const id = navigator.geolocation.watchPosition(
    (pos) =>
      onFix({
        lonlat: [pos.coords.longitude, pos.coords.latitude],
        accuracy: pos.coords.accuracy,
        samples: 1,
        time: pos.timestamp,
      }),
    onError,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
