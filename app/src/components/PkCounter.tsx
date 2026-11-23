import { useEffect, useRef, useState } from 'react';
import { fmtPk } from '../lib/format';

/**
 * Compteur PK au mètre : entre deux positions GPS, il défile en douceur
 * de l'ancienne valeur à la nouvelle (sans jamais annoncer un PK pas encore atteint).
 */
export function PkCounter({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  const rendered = useRef(value);
  const lastUpdate = useRef(0);

  useEffect(() => {
    const from = shownRef.current;
    const now = performance.now();
    const dur = Math.min(1500, Math.max(250, lastUpdate.current ? now - lastUpdate.current : 0));
    lastUpdate.current = now;
    const set = (x: number) => {
      shownRef.current = x;
      if (Math.round(x * 1000) !== Math.round(rendered.current * 1000)) {
        rendered.current = x;
        setShown(x);
      }
    };
    // Grand saut (changement de ligne, retour du GPS) : affichage direct.
    if (Math.abs(value - from) > 0.3 || dur <= 250) {
      set(value);
      return;
    }
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, Math.max(0, (t - now) / dur));
      set(from + (value - from) * k);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className={className}>{fmtPk(shown)}</span>;
}
