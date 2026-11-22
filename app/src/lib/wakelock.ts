/** Garde l'écran allumé pendant le suivi (Wake Lock). */
export type AwakeStatus = 'on' | 'off' | 'unsupported';

interface Sentinel extends EventTarget {
  release: () => Promise<void>;
}

export function keepScreenOn(onStatus: (s: AwakeStatus) => void): () => void {
  const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Sentinel> } }).wakeLock;
  if (!wl?.request) {
    onStatus('unsupported');
    return () => undefined;
  }
  let active = true;
  let sentinel: Sentinel | null = null;
  const request = async () => {
    if (!active || document.visibilityState !== 'visible' || sentinel) return;
    try {
      const s = await wl.request('screen');
      if (!active) {
        void s.release().catch(() => undefined);
        return;
      }
      sentinel = s;
      onStatus('on');
      s.addEventListener('release', () => {
        sentinel = null;
        if (active) onStatus('off');
      });
    } catch {
      onStatus('off');
    }
  };
  // Le verrou saute quand on quitte l'appli : on le reprend au retour.
  const onVisible = () => {
    if (document.visibilityState === 'visible') void request();
  };
  document.addEventListener('visibilitychange', onVisible);
  void request();
  return () => {
    active = false;
    document.removeEventListener('visibilitychange', onVisible);
    void sentinel?.release().catch(() => undefined);
    sentinel = null;
  };
}
