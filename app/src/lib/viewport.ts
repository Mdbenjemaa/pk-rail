import { isInstalled, isIOS } from './install';

/**
 * iPhone, appli installée sur l'écran d'accueil : Safari dessine la page sous la barre d'état, mais selon
 * les versions d'iOS il la raccourcit d'autant. Il reste alors une bande vide en bas de l'écran, de la
 * hauteur de la barre d'état (bogue WebKit connu).
 *
 * On mesure l'écart entre la hauteur de l'écran et celle donnée à la page, et on ne corrige que s'il
 * correspond à la barre d'état : sur un iPhone sans ce bogue, sur Android ou sur ordinateur, rien ne change.
 */
export function standaloneGap(m: {
  standalone: boolean;
  ios: boolean;
  /** Hauteur de la barre d'état (env(safe-area-inset-top)), en px. */
  safeTop: number;
  /** Taille donnée à la page (100 %). */
  width: number;
  height: number;
  /** Taille de l'écran (screen.width / screen.height : toujours en portrait sur iPhone). */
  screenW: number;
  screenH: number;
}): number {
  if (!m.standalone || !m.ios || m.safeTop <= 0) return 0;
  const full = m.width > m.height ? Math.min(m.screenW, m.screenH) : Math.max(m.screenW, m.screenH);
  const gap = full - m.height;
  return gap > 0 && Math.abs(gap - m.safeTop) <= 3 ? gap : 0;
}

function safeTopPx(): number {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

function apply(): void {
  const root = document.documentElement;
  // Pour l'élément racine, clientWidth/clientHeight donnent la taille que « 100 % » prend.
  const width = root.clientWidth;
  const height = root.clientHeight;
  const gap = standaloneGap({
    standalone: isInstalled(),
    ios: isIOS(),
    safeTop: safeTopPx(),
    width,
    height,
    screenW: screen.width,
    screenH: screen.height,
  });
  if (gap > 0) {
    root.style.setProperty('--app-h', `${height + gap}px`);
    root.style.setProperty('--app-gap', `${gap}px`);
  } else {
    root.style.removeProperty('--app-h');
    root.style.removeProperty('--app-gap');
  }
}

/** À appeler une fois au démarrage : la page occupe tout l'écran, jusqu'en bas. */
export function fitStandaloneHeight(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  apply();
  // Après une rotation, iOS donne les bonnes tailles un peu plus tard.
  const later = () => window.setTimeout(apply, 350);
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
}
