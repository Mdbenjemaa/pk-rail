import { useRef, useState } from 'react';
import { fmtDist, fmtPk } from '../lib/format';
import { KIND_BADGE } from '../lib/layers';
import type { Around, AroundItem } from '../lib/nearby';
import { pkText } from './hooks';
import { useDragDown } from './drag';
import { Badge, Icon } from './parts';

type Focus = (at: [number, number]) => void;

/** Fiche du bas réduite ou non (le choix est gardé). */
interface Fold {
  folded: boolean;
  onFold: (folded: boolean) => void;
}

function FoldButton({ onFold }: { onFold: () => void }) {
  return (
    <button className="icon-btn fold-btn" onClick={onFold} aria-label="Réduire la fiche">
      <Icon name="down" size={22} />
    </button>
  );
}

/**
 * Fiche réduite : une ligne avec l'élément le plus proche et sa distance. Un toucher, ou un glissé vers
 * le haut, la rouvre.
 */
function MiniCard({ eyebrow, item, accent, onOpen }: { eyebrow: string; item: { label: string; dist: string } | null; accent?: boolean; onOpen: () => void }) {
  const y0 = useRef<number | null>(null);
  return (
    <button
      className="ucard-mini"
      onClick={onOpen}
      onPointerDown={(e) => (y0.current = e.clientY)}
      onPointerUp={(e) => {
        if (y0.current !== null && y0.current - e.clientY > 24) onOpen();
        y0.current = null;
      }}
      aria-label={`Agrandir la fiche : ${eyebrow}${item ? `, ${item.label}, ${item.dist}` : ''}`}
    >
      <span className="mini-chev" aria-hidden="true">
        <Icon name="chevup" size={20} />
      </span>
      <span className="mini-main">
        <small>{eyebrow}</small>
        <b>{item ? item.label : 'Rien dans les 15 km'}</b>
      </span>
      {item && <span className={`mini-dist${accent ? ' accent' : ''}`}>{item.dist}</span>}
    </button>
  );
}

/** Le plus proche : l'élément où l'on se trouve, sinon le plus près des deux côtés. */
function nearest(inside: AroundItem | undefined, a: AroundItem | undefined, b: AroundItem | undefined) {
  if (inside) return { label: inside.label, dist: 'ici' };
  const n = a && b ? (a.dist <= b.dist ? a : b) : (a ?? b);
  return n ? { label: n.label, dist: fmtDist(n.dist) } : null;
}

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
export function AroundCard({ around, onFocus, onAll, folded, onFold }: { around: Around; onFocus: Focus; onAll: () => void } & Fold) {
  const inside = around.inside[0];
  const up = around.ahead[0];
  const down = around.behind[0];
  const [dragRef, dragProps] = useDragDown<HTMLElement>(() => onFold(true));
  if (folded) return <MiniCard eyebrow="Autour de toi" item={nearest(inside, up, down)} onOpen={() => onFold(false)} />;
  return (
    <section className="ucard foldable" aria-label="Autour de toi" ref={dragRef} {...dragProps}>
      <div className="grip" aria-hidden="true" />
      <div className="ucard-head">
        <span className="ucard-eyebrow">Autour de toi</span>
        <span className="ucard-actions">
          <AllButton onAll={onAll} />
          <FoldButton onFold={() => onFold(true)} />
        </span>
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
export function NextCard({ around, dir, onFocus, onAll, folded, onFold }: { around: Around; dir: 1 | -1 | 0; onFocus: Focus; onAll: () => void } & Fold) {
  const list = dir === 1 ? around.ahead : dir === -1 ? around.behind : null;
  const next = list?.[0] ?? null;
  const then = list?.[1] ?? null;
  const key = next ? `${next.kind}|${next.label}|${next.pk}` : '';
  // Distance au moment où cet élément est devenu « le prochain » : base de la barre d'approche.
  const [start, setStart] = useState({ key, d: next?.dist ?? 0 });
  if (start.key !== key) setStart({ key, d: next?.dist ?? 0 });
  const base = start.key === key ? start.d : (next?.dist ?? 0);
  const pct = next && base > 1 ? Math.max(0, Math.min(100, (1 - next.dist / base) * 100)) : 0;
  const [dragRef, dragProps] = useDragDown<HTMLElement>(() => onFold(true));
  const kind = next ? (KIND_BADGE[next.kind]?.name ?? '') : '';

  if (folded) {
    return list ? (
      <MiniCard
        eyebrow={`Prochain${kind ? ` · ${kind}` : ''}`}
        item={next && { label: next.label, dist: fmtDist(next.dist) }}
        accent
        onOpen={() => onFold(false)}
      />
    ) : (
      <MiniCard eyebrow="Autour de toi" item={nearest(undefined, around.ahead[0], around.behind[0])} onOpen={() => onFold(false)} />
    );
  }

  if (!list) {
    return (
      <section className="ucard foldable" aria-label="Autour de toi" ref={dragRef} {...dragProps}>
        <div className="grip" aria-hidden="true" />
        <div className="ucard-head">
          <span className="ucard-eyebrow">Autour de toi</span>
          <span className="ucard-actions">
            <AllButton onAll={onAll} />
            <FoldButton onFold={() => onFold(true)} />
          </span>
        </div>
        {around.ahead[0] && <NearRow it={around.ahead[0]} dir={1} onFocus={onFocus} />}
        {around.behind[0] && <NearRow it={around.behind[0]} dir={-1} onFocus={onFocus} />}
        {!around.ahead[0] && !around.behind[0] && <p className="ucard-empty">Rien dans les 15 km (selon les filtres).</p>}
      </section>
    );
  }

  return (
    <section className="ucard next-card foldable" aria-label="Prochain élément sur ta route" ref={dragRef} {...dragProps}>
      <div className="grip" aria-hidden="true" />
      <div className="ucard-head">
        <span className="ucard-eyebrow">Prochain{kind ? ` · ${kind}` : ''}</span>
        <span className="ucard-actions">
          <AllButton onAll={onAll} />
          <FoldButton onFold={() => onFold(true)} />
        </span>
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
