import type { LonLat } from './geo';

export interface Fix {
  lonlat: LonLat;
  /** Rayon de précision annoncé par le téléphone (m, 68 %). */
  accuracy: number;
  samples: number;
  /** Heure de la mesure (ms), pour le lissage du PK. */
  time: number;
  /** Heure à laquelle le téléphone l'a donnée à l'appli (ms, horloge du téléphone) : pour savoir si le GPS s'est tu. */
  received: number;
  /** Direction de déplacement (degrés depuis le nord) et vitesse (m/s) annoncées par le GPS, si connues. */
  course?: number | null;
  speed?: number | null;
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
  const now = Date.now();
  return { lonlat: [lon / w, lat / w], accuracy: best, samples: used.length, time: now, received: now };
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

  let lastError: GeolocationPositionError | null = null;
  const promise = new Promise<Fix>((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Ce navigateur ne donne pas accès au GPS.'));
      return;
    }
    let settled = false;
    const stop = () => {
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (timer) clearTimeout(timer);
    };
    const done = () => {
      if (settled) return;
      stop();
      const fix = combine(samples);
      if (fix) resolve(fix);
      else reject(lastError ?? new Error('Aucune position reçue. Vérifie que la localisation est activée.'));
    };
    finish = done;
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (settled) return;
        const { longitude: lon, latitude: lat, accuracy } = pos.coords;
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(accuracy)) return;
        samples.push({ lon, lat, accuracy });
        const current = combine(samples)!;
        const elapsed = Date.now() - start;
        onUpdate(current, elapsed);
        if (samples.length >= 3 && current.accuracy <= target && elapsed >= 3000) done();
      },
      (err) => {
        if (settled) return;
        // Refus : inutile d'attendre. Position momentanément indisponible ou trop lente : on continue d'écouter.
        if (err.code === err.PERMISSION_DENIED) {
          stop();
          reject(err);
          return;
        }
        lastError = err;
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

/**
 * Position reçue pendant le suivi. L'heure de la mesure sert au lissage du PK ; si elle est très
 * différente de l'horloge du téléphone (horloge GPS, téléphone mal réglé), on prend l'heure de réception.
 */
export function toFix(
  pos: { coords: { longitude: number; latitude: number; accuracy: number; heading?: number | null; speed?: number | null }; timestamp: number },
  now = Date.now(),
): Fix | null {
  const { longitude, latitude, accuracy, heading, speed } = pos.coords;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(accuracy)) return null;
  const time = Number.isFinite(pos.timestamp) && Math.abs(pos.timestamp - now) < 30000 ? pos.timestamp : now;
  const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { lonlat: [longitude, latitude], accuracy, samples: 1, time, received: now, course: num(heading), speed: num(speed) };
}

/** Suivi en continu (marche le long des voies). */
export function follow(onFix: (f: Fix) => void, onError: (e: GeolocationPositionError) => void): () => void {
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const fix = toFix(pos);
      if (fix) onFix(fix);
    },
    onError,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
