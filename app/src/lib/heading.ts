/**
 * Direction du téléphone, pour le faisceau autour du point GPS.
 * - À l'arrêt et à pied : la boussole (là où pointe le haut du téléphone).
 * - En véhicule (plus de 10 km/h) : la direction de déplacement donnée par le GPS, car la boussole est
 *   faussée par la carrosserie et le moteur.
 * Angles en degrés, dans le sens des aiguilles d'une montre depuis le nord.
 */
type Listener = (h: number | null) => void;

/** Vitesse à partir de laquelle on prend la direction du GPS (m/s, ≈ 10 km/h). */
export const VEHICLE_SPEED = 2.8;
const COMPASS_MAX_AGE = 3000;
const COURSE_MAX_AGE = 5000;

const listeners = new Set<Listener>();
let compass: { h: number; t: number } | null = null;
let course: { h: number; t: number } | null = null;
let started = false;
let lastSent: number | null = null;
let lastSentAt = 0;

export const norm = (a: number) => ((a % 360) + 360) % 360;

/** Écart entre deux angles, de -180 à 180. */
export const angleDiff = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/** Lissage d'un angle (sans saut entre 359° et 0°). */
export function smoothAngle(prev: number | null, next: number, k: number): number {
  if (prev === null) return norm(next);
  return norm(prev + angleDiff(prev, next) * k);
}

/**
 * Cap de la boussole depuis un événement d'orientation, corrigé de la rotation de l'écran.
 * iPhone : webkitCompassHeading. Android : alpha d'un événement « absolu » (par rapport au nord).
 */
export function compassFromEvent(
  e: { alpha: number | null; absolute?: boolean; webkitCompassHeading?: number },
  screenAngle = 0,
): number | null {
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
    return norm(e.webkitCompassHeading + screenAngle);
  }
  if (e.absolute && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) return norm(360 - e.alpha + screenAngle);
  return null;
}

/** Direction à afficher maintenant (null : inconnue). */
export function currentHeading(now = Date.now()): number | null {
  if (course && now - course.t < COURSE_MAX_AGE) return course.h;
  if (compass && now - compass.t < COMPASS_MAX_AGE) return compass.h;
  return null;
}

function emit(force = false) {
  const h = currentHeading();
  const now = Date.now();
  const changed =
    (h === null) !== (lastSent === null) || (h !== null && lastSent !== null && Math.abs(angleDiff(lastSent, h)) >= 2);
  // Au plus 10 fois par seconde : la boussole envoie jusqu'à 60 mesures par seconde.
  if (!force && (!changed || now - lastSentAt < 100)) return;
  lastSent = h;
  lastSentAt = now;
  for (const l of listeners) l(h);
}

function onOrientation(ev: Event) {
  const e = ev as DeviceOrientationEvent & { webkitCompassHeading?: number };
  const angle = typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0;
  const h = compassFromEvent(e, angle);
  if (h === null) return;
  compass = { h: smoothAngle(compass ? compass.h : null, h, 0.3), t: Date.now() };
  emit();
}

/**
 * Démarre la boussole. À appeler directement dans un toucher (« Me repérer », « Suivre le PK ») :
 * sur iPhone, l'autorisation ne peut être demandée qu'à ce moment-là.
 */
export function startCompass(): void {
  if (started || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
  started = true;
  const listen = () => {
    const absolute = 'ondeviceorientationabsolute' in window;
    window.addEventListener(absolute ? 'deviceorientationabsolute' : 'deviceorientation', onOrientation);
    // Boussole muette (pas de capteur, autorisation retirée) : le faisceau finit par disparaître.
    setInterval(() => emit(), 1000);
  };
  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then(
      (r) => (r === 'granted' ? listen() : (started = false)),
      () => (started = false),
    );
  } else listen();
}

/** Direction de déplacement donnée par le GPS (prise seulement en véhicule). */
export function setCourse(heading: number | null | undefined, speed: number | null | undefined, now = Date.now()): void {
  if (typeof speed === 'number' && speed >= VEHICLE_SPEED && typeof heading === 'number' && Number.isFinite(heading)) {
    course = { h: norm(heading), t: now };
  } else if (typeof speed === 'number' && speed < VEHICLE_SPEED) {
    course = null;
  }
  emit();
}

export function subscribeHeading(l: Listener): () => void {
  listeners.add(l);
  l(currentHeading());
  return () => listeners.delete(l);
}

/** Pour les tests. */
export function _resetHeading(): void {
  compass = null;
  course = null;
  lastSent = null;
  lastSentAt = 0;
}

export function _setCompassForTests(h: number, t = Date.now()): void {
  compass = { h, t };
}
