/**
 * Installation sur l'écran d'accueil.
 * - Android (Chrome, Edge, Samsung…) et ordinateur (Chrome, Edge) : le navigateur propose sa fenêtre
 *   d'installation, déclenchée par notre bouton (événement beforeinstallprompt).
 * - iPhone et iPad : aucune installation automatique possible, on explique « Partager › Sur l'écran d'accueil ».
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** À appeler au démarrage, avant l'affichage : l'événement peut arriver très tôt. */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export const onInstallChange = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** L'appli tourne déjà depuis l'écran d'accueil. */
export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export type InstallMode =
  | 'installed' // déjà installée
  | 'prompt' // le navigateur peut installer : bouton « Installer »
  | 'ios-safari' // iPhone / iPad dans Safari : Partager › Sur l'écran d'accueil
  | 'ios-other' // iPhone dans Chrome, Firefox… : Partager › Ajouter à l'écran d'accueil (iOS 16.4+), sinon Safari
  | 'android-menu' // Android sans fenêtre d'installation : menu du navigateur
  | 'desktop-menu'; // ordinateur sans fenêtre d'installation

export function installMode(): InstallMode {
  if (isInstalled()) return 'installed';
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/.test(ua)) return 'android-menu';
  return 'desktop-menu';
}

/** Ouvre la fenêtre d'installation du navigateur. Renvoie vrai si l'utilisateur a accepté. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  notify();
  return outcome === 'accepted';
}
