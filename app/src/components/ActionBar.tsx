import { Icon } from './parts';

interface Props {
  following: boolean;
  acquiring: boolean;
  /** La carte a été déplacée à la main pendant le suivi. */
  mapFree: boolean;
  onSearch: () => void;
  onFollow: () => void;
  onLocate: () => void;
  onRecenter: () => void;
  onStop: () => void;
}

/** Grosse barre d'actions en bas, sous le pouce (utilisable avec des gants). */
export function ActionBar(p: Props) {
  if (p.following) {
    return (
      <nav className="action-bar live" aria-label="Commandes du suivi">
        <button className={`act act-row ${p.mapFree ? 'act-hot' : ''}`} onClick={p.onRecenter}>
          <Icon name="locate" />
          Recentrer
        </button>
        <button className="act act-row act-stop" onClick={p.onStop}>
          <Icon name="stop" size={20} />
          Arrêter
        </button>
      </nav>
    );
  }
  return (
    <nav className="action-bar" aria-label="Actions principales">
      <button className="act" onClick={p.onSearch}>
        <Icon name="search" />
        Rechercher
      </button>
      <button className="act act-main" onClick={p.onFollow}>
        <Icon name="play" size={22} />
        Suivre le PK
      </button>
      <button className="act" onClick={p.onLocate} disabled={p.acquiring}>
        <Icon name="locate" />
        {p.acquiring ? 'GPS…' : 'Me repérer'}
      </button>
    </nav>
  );
}
