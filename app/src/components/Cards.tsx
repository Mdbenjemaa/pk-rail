import { useState } from 'react';
import { fmtDist, fmtPk } from '../lib/format';
import { KIND_BADGE } from '../lib/layers';
import type { Around, AroundItem } from '../lib/nearby';
import { pkText } from './hooks';
import { Badge, Icon } from './parts';

type Focus = (at: [number, number]) => void;

/** Une ligne de la fiche : sens, dessin, nom, PK, distance. */
function NearRow({ it, dir, onFocus }: { it: AroundItem; dir: 1 | -1 | 0; onFocus: Focus }) {
  const sens = dir === 1 ? 'Vers les PK croissants' : dir === -1 ? 'Vers les PK décroissants' : 'Tu es dedans';
  return (
    <button className="near-row" onClick={() => onFocus(it.lonlat)}>
      <span className="dir-dot" role="img" aria-label={sens}>
        <Icon name={dir === 1 ? 'up' : dir === -1 ? 'dn' : 'here'} size={18} />
      </span>
      <Badge kind={it.kind} ic={it.ic} />
      <span className="near-main">
        <b>{it.label}</b>
        <small>{dir === 0 ? `Tu es dedans · ${pkText(it)}` : pkText(it)}</small>
      </span>
      <span className="near-dist">{dir === 0 ? 'ici' : fmtDist(it.dist)}</span>
    </button>
  );
}

function AllButton({ onAll }: { onAll: () => void }) {
  return (
    <button className="pill-link" onClick={onAll}>
      Tout voir
      <Icon name="right" size={20} />
    </button>
  );
}

/** Repéré : le plus proche dans chaque sens (selon les filtres), et « Tout voir ». */
export function AroundCard({ around, onFocus, onAll }: { around: Around; onFocus: Focus; onAll: () => void }) {
  const inside = around.inside[0];
  const up = around.ahead[0];
  const down = around.behind[0];
  return (
    <section className="ucard" aria-label="Autour de toi">
      <div className="ucard-head">
        <span className="ucard-eyebrow">Autour de toi</span>
        <AllButton onAll={onAll} />
      </div>
      {inside && <NearRow it={inside} dir={0} onFocus={onFocus} />}
      {up && <NearRow it={up} dir={1} onFocus={onFocus} />}
      {down && <NearRow it={down} dir={-1} onFocus={onFocus} />}
      {!inside && !up && !down && <p className="ucard-empty">Rien dans les 15 km (selon les filtres).</p>}
    </section>
  );
}

/**
 * Suivi : le prochain élément dans le sens de marche, avec la distance qui diminue et une barre d'approche,
 * puis le suivant. À l'arrêt (sens inconnu), le plus proche de chaque côté.
 */
export function NextCard({ around, dir, onFocus, onAll }: { around: Around; dir: 1 | -1 | 0; onFocus: Focus; onAll: () => void }) {
  const list = dir === 1 ? around.ahead : dir === -1 ? around.behind : null;
  const next = list?.[0] ?? null;
  const then = list?.[1] ?? null;
  const key = next ? `${next.kind}|${next.label}|${next.pk}` : '';
  // Distance au moment où cet élément est devenu « le prochain » : base de la barre d'approche.
  const [start, setStart] = useState({ key, d: next?.dist ?? 0 });
  if (start.key !== key) setStart({ key, d: next?.dist ?? 0 });
  const base = start.key === key ? start.d : (next?.dist ?? 0);
  const pct = next && base > 1 ? Math.max(0, Math.min(100, (1 - next.dist / base) * 100)) : 0;

  if (!list) {
    return (
      <section className="ucard" aria-label="Autour de toi">
        <div className="ucard-head">
          <span className="ucard-eyebrow">Autour de toi</span>
          <AllButton onAll={onAll} />
        </div>
        {around.ahead[0] && <NearRow it={around.ahead[0]} dir={1} onFocus={onFocus} />}
        {around.behind[0] && <NearRow it={around.behind[0]} dir={-1} onFocus={onFocus} />}
        {!around.ahead[0] && !around.behind[0] && <p className="ucard-empty">Rien dans les 15 km (selon les filtres).</p>}
      </section>
    );
  }

  const kind = next ? (KIND_BADGE[next.kind]?.name ?? '') : '';
  return (
    <section className="ucard next-card" aria-label="Prochain élément sur ta route">
      <div className="ucard-head">
        <span className="ucard-eyebrow">Prochain{kind ? ` · ${kind}` : ''}</span>
        <AllButton onAll={onAll} />
      </div>
      {next ? (
        <>
          <button className="next-main" onClick={() => onFocus(next.lonlat)}>
            <Badge kind={next.kind} ic={next.ic} size="xl" />
            <span className="next-name">
              <b>{next.label}</b>
              <small>PK {fmtPk(next.pk)}</small>
            </span>
            <span className="next-dist">{fmtDist(next.dist)}</span>
          </button>
          <div className="next-bar" role="progressbar" aria-label={`Approche : ${next.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <div style={{ width: `${pct}%` }} />
          </div>
          {then && (
            <button className="near-row then-row" onClick={() => onFocus(then.lonlat)}>
              <span className="then-label">Puis</span>
              <Badge kind={then.kind} ic={then.ic} />
              <span className="near-main">
                <b>{then.label}</b>
                <small>{pkText(then)}</small>
              </span>
              <span className="near-dist small">{fmtDist(then.dist)}</span>
            </button>
          )}
        </>
      ) : (
        <p className="ucard-empty">Rien devant toi dans les 15 km (selon les filtres).</p>
      )}
    </section>
  );
}

export function ErrorCard({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <section className="ucard error-card" role="alert">
      <p>{message}</p>
      <button className="round-btn light" onClick={onClose} aria-label="Fermer">
        <Icon name="close" size={20} />
      </button>
    </section>
  );
}

export function HintCard({ text }: { text: string }) {
  return <div className="ucard hint-card">{text}</div>;
}
