/**
 * Direction du téléphone, pour le faisceau autour du point GPS.
 * - À l'arrêt et à pied : la boussole (là où pointe le haut du téléphone).
 * - En véhicule (plus de 10 km/h) : la direction de déplacement donnée par le GPS, car la boussole est
 *   faussée par la carrosserie et le moteur.
 * Angles en degrés, dans le sens des aiguilles d'une montre depuis le nord.
 *
 * Aussi : l'orientation de la carte (pour l'aiguille du bouton boussole).
 */
type Listener = (h: number | null) => void;

/** État de la boussole, pour expliquer à l'agent pourquoi rien ne tourne. */
export type CompassState =
  | 'off' // pas encore demandée
  | 'asking' // le téléphone demande l'autorisation
  | 'denied' // autorisation refusée
  | 'waiting' // autorisée, en attente des premières mesures
  | 'ok' // mesures reçues
  | 'unsupported'; // pas de boussole utilisable dans ce navigateur

/** Vitesse à partir de laquelle on prend la direction du GPS (m/s, ≈ 10 km/h). */
export const VEHICLE_SPEED = 2.8;
const COMPASS_MAX_AGE = 3000;
const COURSE_MAX_AGE = 5000;
/** Délai sans aucune mesure de boussole avant de conclure qu'il n'y en a pas. */
const NO_SENSOR_MS = 3500;

const listeners = new Set<Listener>();
const stateListeners = new Set<(s: CompassState) => void>();
let compass: { h: number; t: number } | null = null;
let course: { h: number; t: number } | null = null;
let state: CompassState = 'off';
let listening = false;
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
 * Un événement relatif (sans référence au nord) ne sert à rien : null.
 */
export function compassFromEvent(
  e: { alpha: number | null; absolute?: boolean; webkitCompassHeading?: number },
  screenAngle = 0,
): number | null {
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading) && e.webkitCompassHeading >= 0) {
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

export function compassState(): CompassState {
  return state;
}

function setState(s: CompassState) {
  if (s === state) return;
  state = s;
  for (const l of stateListeners) l(s);
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

function screenAngle(): number {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  const legacy = (window as Window & { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

function onOrientation(ev: Event) {
  const e = ev as DeviceOrientationEvent & { webkitCompassHeading?: number };
  const h = compassFromEvent(e, screenAngle());
  if (h === null) return;
  compass = { h: smoothAngle(compass ? compass.h : null, h, 0.3), t: Date.now() };
  setState('ok');
  emit();
}

function listen() {
  if (!listening) {
    listening = true;
    // Les deux : Android donne le nord dans « deviceorientationabsolute », l'iPhone dans « deviceorientation ».
    window.addEventListener('deviceorientationabsolute', onOrientation);
    window.addEventListener('deviceorientation', onOrientation);
    // Boussole muette (capteur coupé) : le faisceau finit par disparaître.
    setInterval(() => emit(), 1000);
  }
  if (state !== 'ok') {
    setState('waiting');
    setTimeout(() => {
      if (state === 'waiting') setState('unsupported');
    }, NO_SENSOR_MS);
  }
}

/**
 * Démarre la boussole. À appeler directement dans un toucher (« Me repérer », « Suivre le PK », bouton
 * boussole) : sur iPhone, l'autorisation ne peut être demandée qu'à ce moment-là.
 */
export function startCompass(): void {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
    setState('unsupported');
    return;
  }
  if (state === 'asking' || state === 'waiting' || state === 'ok') return;
  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof DOE.requestPermission !== 'function') {
    listen();
    return;
  }
  setState('asking');
  let asked: Promise<string>;
  try {
    asked = DOE.requestPermission();
  } catch {
    setState('denied');
    return;
  }
  asked.then(
    (r) => (r === 'granted' ? listen() : setState('denied')),
    () => setState('denied'),
  );
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

export function subscribeCompassState(l: (s: CompassState) => void): () => void {
  stateListeners.add(l);
  l(state);
  return () => stateListeners.delete(l);
}

/** Pourquoi la carte ne tourne pas : un message clair selon l'état de la boussole et le téléphone. */
export function compassMessage(s: CompassState, ios: boolean): string {
  if (s === 'denied') {
    return ios
      ? 'L’accès à l’orientation a été refusé. Ferme complètement l’appli (balaie-la vers le haut), rouvre-la, touche la boussole et choisis « Autoriser ».'
      : 'Les capteurs de mouvement sont bloqués pour ce site. Dans Chrome : ⋮ › Paramètres › Paramètres des sites › Capteurs de mouvement › Autoriser.';
  }
  if (s === 'asking') return 'Réponds à la question du téléphone sur l’accès à l’orientation, puis touche à nouveau la boussole.';
  return 'Ce téléphone ne donne pas sa boussole à l’appli. La direction s’affichera quand tu te déplaceras en véhicule (GPS). Tu peux aussi tourner la carte avec deux doigts.';
}

/* ---------- Orientation de la carte (aiguille du bouton boussole) ---------- */

const bearingListeners = new Set<(b: number) => void>();
let mapBearing = 0;

export function setMapBearing(b: number): void {
  if (Math.abs(angleDiff(mapBearing, b)) < 0.5) return;
  mapBearing = b;
  for (const l of bearingListeners) l(b);
}

export function subscribeMapBearing(l: (b: number) => void): () => void {
  bearingListeners.add(l);
  l(mapBearing);
  return () => bearingListeners.delete(l);
}

/* ---------- Tests ---------- */

export function _resetHeading(): void {
  compass = null;
  course = null;
  lastSent = null;
  lastSentAt = 0;
  state = 'off';
}

export function _setCompassForTests(h: number, t = Date.now()): void {
  compass = { h, t };
}
