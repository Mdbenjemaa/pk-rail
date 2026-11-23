import { useEffect, useRef, useState } from 'react';
import { isIOS } from '../lib/install';
import {
  angleDiff,
  compassMessage,
  compassState,
  currentHeading,
  startCompass,
  subscribeMapBearing,
} from '../lib/heading';
import { Icon } from './parts';

/**
 * Bouton boussole, comme sur Google Maps. L'aiguille rouge montre toujours le nord.
 * - Carte nord en haut : la carte suit la direction du téléphone.
 * - Carte qui suit la direction, ou tournée avec deux doigts : retour nord en haut.
 */
export function OrientButton(p: { orient: boolean; onToggle: (on: boolean) => void; onResetNorth: () => void; onMessage: (m: string) => void }) {
  const [bearing, setBearing] = useState(0);
  useEffect(() => subscribeMapBearing(setBearing), []);
  const check = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (check.current) clearTimeout(check.current);
  }, []);
  const rotated = Math.abs(angleDiff(0, bearing)) > 1;

  const press = () => {
    // Dans le toucher : sur iPhone, c'est le seul moment où l'autorisation peut être demandée.
    startCompass();
    if (check.current) clearTimeout(check.current);
    if (p.orient) return p.onToggle(false);
    if (rotated) return p.onResetNorth();
    p.onToggle(true);
    // Pas de direction au bout de 4 s : on dit pourquoi.
    check.current = setTimeout(() => {
      if (currentHeading() === null) p.onMessage(compassMessage(compassState(), isIOS()));
    }, 4000);
  };

  const label = p.orient || rotated ? 'Remettre le nord en haut' : 'Tourner la carte dans ma direction';
  return (
    <button className={`orient-btn${p.orient ? ' on' : ''}`} onClick={press} aria-pressed={p.orient} aria-label={label} title={label}>
      <span className="compass-needle" style={{ transform: `rotate(${Math.round(-bearing)}deg)` }}>
        <Icon name="compass" size={26} />
      </span>
    </button>
  );
}
