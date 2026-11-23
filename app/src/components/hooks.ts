import { useEffect, useState } from 'react';
import { fmtPk } from '../lib/format';
import type { AroundItem } from '../lib/nearby';

/** Secondes écoulées depuis `time` (ms), rafraîchies chaque seconde. */
export function useSince(time: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.round((now - time) / 1000));
}

/** « PK 29+033 » ou « PK 30+329 → 30+644 » pour une zone (quai, tunnel). */
export function pkText(it: AroundItem): string {
  return `PK ${fmtPk(it.pk)}${it.pkEnd !== undefined ? ` → ${fmtPk(it.pkEnd)}` : ''}`;
}
