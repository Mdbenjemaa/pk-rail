import { useEffect, useState } from 'react';
import { startCompass, subscribeHeading } from '../lib/heading';
import { Icon } from './parts';

/**
 * Bouton boussole. Nord en haut par défaut ; touché, la carte tourne dans la direction du téléphone.
 * L'aiguille rouge montre toujours le nord.
 */
export function OrientButton({ orient, onToggle }: { orient: boolean; onToggle: (on: boolean) => void }) {
  const [heading, setHeading] = useState<number | null>(null);
  useEffect(() => subscribeHeading(setHeading), []);
  const north = orient && heading !== null ? -heading : 0;
  return (
    <button
      className={`orient-btn${orient ? ' on' : ''}`}
      onClick={() => {
        startCompass();
        onToggle(!orient);
      }}
      aria-pressed={orient}
      aria-label={orient ? 'Remettre le nord en haut' : 'Tourner la carte dans ma direction'}
    >
      <span className="compass-needle" style={{ transform: `rotate(${Math.round(north)}deg)` }}>
        <Icon name="compass" size={26} />
      </span>
    </button>
  );
}
