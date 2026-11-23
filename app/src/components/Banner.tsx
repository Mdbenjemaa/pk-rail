import type { Manifest } from '../lib/data';
import { fmtLine, fmtPk } from '../lib/format';
import { lineChips, shortLineName } from '../lib/lineinfo';
import type { PkEstimate } from '../lib/pkfilter';
import type { AwakeStatus } from '../lib/wakelock';
import { PkCounter } from './PkCounter';
import { useSince } from './hooks';
import { Icon } from './parts';
import type { LocateResult, LocateState } from './state';

interface Props {
  state: LocateState;
  manifest: Manifest | null;
  following: boolean;
  followPk: PkEstimate | null;
  awake: AwakeStatus | null;
  onMenu: () => void;
  /** Toucher le PK : détails de la ligne. */
  onDetails: () => void;
  /** Repérage en cours : garder la position actuelle sans attendre. */
  onUseFix: () => void;
}

/** Précision du GPS en couleur : vert (bonne), orange (moyenne), rouge (faible). */
function GpsPill({ accuracy, compact }: { accuracy: number; compact?: boolean }) {
  const a = Math.round(accuracy);
  const level = a <= 10 ? '' : a <= 25 ? 'moyen' : 'faible';
  return (
    <span className={`gps-pill ${level}`} title="Précision du GPS">
      <i />
      {compact ? '' : 'GPS '}± {a} m
    </span>
  );
}

function MenuButton({ onMenu }: { onMenu: () => void }) {
  return (
    <button className="round-btn" onClick={onMenu} aria-label="Menu : affichage jour ou nuit, effacer ma position, installer, à propos">
      <Icon name="dots" size={22} />
    </button>
  );
}

/** Voie la plus proche sur la ligne retenue. */
function nearestTrack(res: LocateResult) {
  const code = res.chosen?.code;
  return code ? (res.match.tracks.find((t) => t.code === code) ?? null) : null;
}

/** Suivi en direct : gros compteur PK, sens de marche, vitesse, état du GPS et de l'écran. */
function LiveBanner({ res, followPk, awake }: { res: LocateResult | null; followPk: PkEstimate | null; awake: AwakeStatus | null }) {
  const live = res?.mode === 'suivi' ? res : null;
  const chosen = live?.chosen ?? null;
  const fix = live?.fix ?? null;
  const since = useSince(fix?.time ?? 0);
  const pk = chosen ? (followPk?.pk ?? chosen.pk) : null;
  const dir = followPk?.dir ?? 0;
  const kmh = followPk && dir !== 0 ? Math.round(Math.abs(followPk.v) * 3.6) : 0;
  const track = live ? nearestTrack(live) : null;
  return (
    <header className="banner live">
      <div className="banner-row">
        <span className="live-pill">
          <span className="live-dot" />
          EN DIRECT
        </span>
        <span className="banner-pills">
          {awake === 'on' && (
            <span className="pill-dark" title="L’écran reste allumé pendant le suivi">
              <Icon name="sun" size={16} />
              <span className="hide-narrow">Écran allumé</span>
            </span>
          )}
          {fix && <GpsPill accuracy={fix.accuracy} compact />}
        </span>
      </div>
      {chosen && pk !== null ? (
        <>
          <div className="pk-row">
            <span className="pk-label">PK</span>
            <PkCounter value={pk} className="pk-digits live" />
          </div>
          <div className="dir-row">
            {dir === 0 ? (
              <span>À l’arrêt · le sens s’affiche quand tu avances</span>
            ) : (
              <>
                <Icon name={dir === 1 ? 'up' : 'dn'} size={20} />
                <b>{dir === 1 ? 'Vers les PK croissants' : 'Vers les PK décroissants'}</b>
                {kmh >= 2 && <span>· {kmh} km/h</span>}
              </>
            )}
          </div>
          <div className="banner-sub">
            Ligne {fmtLine(chosen.code)}
            {track ? ` · voie ${track.name} à ${Math.round(track.dist)} m` : ''}
          </div>
        </>
      ) : live && !chosen ? (
        <div className="banner-wait">Aucune ligne à moins de {live.radius} m</div>
      ) : (
        <div className="banner-wait">Recherche du GPS…</div>
      )}
      {fix && since >= 8 && <div className="banner-warn">GPS perdu depuis {since} s : le PK n’avance plus.</div>}
      {awake && awake !== 'on' && (
        <div className="banner-note">Pense à couper la mise en veille de l’écran pendant le suivi.</div>
      )}
    </header>
  );
}

/** Bandeau du haut : le PK en très gros, la ligne, la voie et les caractéristiques utiles. */
export function Banner(p: Props) {
  const { state } = p;
  if (p.following) return <LiveBanner res={state.phase === 'result' ? state : null} followPk={p.followPk} awake={p.awake} />;

  if (state.phase === 'acquiring') {
    const { fix } = state;
    return (
      <header className="banner">
        <div className="banner-row">
          <span className="banner-eyebrow">Repérage GPS…</span>
          <span className="banner-pills">
            {fix && <GpsPill accuracy={fix.accuracy} />}
            <MenuButton onMenu={p.onMenu} />
          </span>
        </div>
        <div className="banner-big">{fix ? `± ${Math.round(fix.accuracy)} m` : 'Recherche des satellites'}</div>
        <div className="banner-sub wrap">
          {fix ? `${fix.samples} mesure(s) · ${Math.round(state.elapsed / 1000)} s · ` : ''}Reste immobile, téléphone vers le ciel.
        </div>
        {fix && (
          <button className="banner-btn" onClick={p.onUseFix}>
            Utiliser cette position
          </button>
        )}
      </header>
    );
  }

  if (state.phase !== 'result') return null;
  const { chosen, doc, fix, mode, radius } = state;
  const name = chosen ? (p.manifest?.lines[chosen.code]?.n ?? doc?.name) : null;
  const track = nearestTrack(state);
  const chips = chosen && doc ? lineChips(doc, chosen.pk) : [];
  return (
    <header className="banner">
      <div className="banner-row">
        <span className="banner-eyebrow">{chosen ? `Ligne ${fmtLine(chosen.code)}` : 'Aucune ligne trouvée'}</span>
        <span className="banner-pills">
          {mode === 'manuel' ? <span className="pill-dark">Placé à la main</span> : <GpsPill accuracy={fix.accuracy} />}
          <MenuButton onMenu={p.onMenu} />
        </span>
      </div>
      {chosen ? (
        <button className="banner-main" onClick={p.onDetails} aria-label={`PK ${fmtPk(chosen.pk)} : voir les détails de la ligne`}>
          <span className="pk-row">
            <span className="pk-label">PK</span>
            <span className="pk-digits">{fmtPk(chosen.pk)}</span>
          </span>
          <span className="banner-sub">
            {shortLineName(name)} · {track ? `voie ${track.name} à ${Math.round(track.dist)} m` : `à ${Math.round(chosen.dist)} m de l’axe`}
          </span>
          {chips.length > 0 && (
            <span className="banner-chips">
              {chips.map((c) => (
                <span key={c.text} className={`bchip ${c.warn ? 'warn' : ''}`}>
                  {c.text}
                </span>
              ))}
            </span>
          )}
        </button>
      ) : (
        <div className="banner-main">
          <div className="banner-big">Pas de ligne à moins de {radius} m</div>
          <div className="banner-sub wrap">
            Rapproche-toi des voies, ou appuie longuement sur la carte près des voies pour te placer.
          </div>
        </div>
      )}
    </header>
  );
}
