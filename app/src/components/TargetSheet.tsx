import type { Acces, AccesSet } from '../lib/acces';
import type { LineDoc } from '../lib/data';
import { fmtDist, fmtLine, fmtPk } from '../lib/format';
import { distance, type LonLat } from '../lib/geo';
import { kindVisible, KIND_BADGE, type Filters } from '../lib/layers';
import { aroundPk } from '../lib/nearby';
import { signalImage, SIGNAL_ICONS } from '../lib/signaux';
import { navLinks, type PkPosition } from '../lib/pk';

export interface TargetState {
  code: string;
  pk: number;
  doc: LineDoc;
  positions: PkPosition[];
  idx: number;
  /** Destination de l'itinéraire : le PK lui-même, ou un accès choisi dans la liste. */
  dest: { name: string; lonlat: LonLat };
}

export interface Origin {
  code: string;
  pk: number;
  lonlat: LonLat;
}

/** Boutons d'itinéraire en voiture (ouvrent l'appli de navigation du téléphone). */
export function NavLinks({ at }: { at: LonLat }) {
  return (
    <div className="nav-links">
      {navLinks(at).map((l) => (
        <a key={l.label} className="btn btn-nav" href={l.href} target="_blank" rel="noopener noreferrer">
          {l.label}
        </a>
      ))}
    </div>
  );
}

export function TargetSheet(p: {
  target: TargetState;
  origin: Origin | null;
  acces: AccesSet[];
  filters: Filters;
  expanded: boolean;
  onToggleExpand: () => void;
  onPosition: (idx: number) => void;
  onDest: (dest: { name: string; lonlat: LonLat }) => void;
  onFocus: (at: LonLat) => void;
  onClose: () => void;
}) {
  const { target: t, origin } = p;
  const pos = t.positions[t.idx];
  const sameLine = origin && origin.code === t.code;
  const alongKm = sameLine ? Math.abs(t.pk - origin.pk) : null;
  const direction = sameLine ? (t.pk >= origin.pk ? 'vers les PK croissants' : 'vers les PK décroissants') : null;
  const crow = origin ? distance(origin.lonlat, pos.lonlat) : null;

  const nearAcces: (Acces & { d: number })[] = p.acces
    .flatMap((s) => s.items)
    .map((a) => ({ ...a, d: distance(a.lonlat, pos.lonlat) }))
    .filter((a) => a.d < 5000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);
  const around = aroundPk(t.doc, t.pk, (k) => k !== 'acces' && kindVisible(p.filters, k), 5, 3);
  const nearby = [...around.inside, ...around.behind, ...around.ahead].sort((a, b) => a.dist - b.dist).slice(0, 5);
  const destIsPk = t.dest.lonlat === pos.lonlat;

  return (
    <section className={`sheet ${p.expanded ? 'sheet-full' : 'sheet-peek'}`} aria-live="polite">
      <button className="grab" onClick={p.onToggleExpand} aria-label={p.expanded ? 'Réduire' : 'Agrandir'} />
      <div className="sheet-head">
        <div className="pk-block" onClick={() => p.onFocus(pos.lonlat)}>
          <div className="eyebrow">Destination · ligne {fmtLine(t.code)}</div>
          <div className="pk target-pk">PK {fmtPk(t.pk)}</div>
          <div className="muted">
            {t.doc.name ?? 'Ligne sans nom'}
            {pos.statut && pos.statut !== 'Exploitée' ? ` · ${pos.statut}` : ''}
          </div>
        </div>
        <button className="icon-btn" onClick={p.onClose} aria-label="Fermer">
          ×
        </button>
      </div>

      <div className="sheet-body">
        {alongKm !== null ? (
          <p className="route-line">
            <b>≈ {fmtDist(alongKm * 1000)}</b> le long de la ligne, {direction}
            {crow !== null && <span className="muted"> · {fmtDist(crow)} à vol d’oiseau</span>}
          </p>
        ) : crow !== null ? (
          <p className="route-line">
            <b>{fmtDist(crow)}</b> à vol d’oiseau
            {origin && origin.code !== t.code && <span className="muted"> · tu es sur la ligne {fmtLine(origin.code)}</span>}
          </p>
        ) : null}

        {t.positions.length > 1 && (
          <>
            <p className="muted small">Ce PK existe à {t.positions.length} endroits de la ligne (tronçons distincts) :</p>
            <div className="chips">
              {t.positions.map((x, i) => (
                <button key={i} className={`chip ${i === t.idx ? 'on' : ''}`} onClick={() => p.onPosition(i)}>
                  Endroit {i + 1}
                  {x.statut !== 'Exploitée' ? ` (${x.statut})` : ''}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="field-label">Itinéraire en voiture vers {destIsPk ? `le PK ${fmtPk(t.pk)}` : t.dest.name}</div>
        <NavLinks at={t.dest.lonlat} />
        {!destIsPk && (
          <button className="link-btn" onClick={() => p.onDest({ name: `PK ${fmtPk(t.pk)}`, lonlat: pos.lonlat })}>
            Revenir au PK lui-même
          </button>
        )}

        {nearAcces.length > 0 && (
          <>
            <div className="field-label">Mes accès les plus proches</div>
            <ul className="items">
              {nearAcces.map((a, i) => (
                <li key={i}>
                  <button
                    className={`item ${t.dest.lonlat === a.lonlat ? 'item-on' : ''}`}
                    onClick={() => {
                      p.onDest({ name: a.name, lonlat: a.lonlat });
                      p.onFocus(a.lonlat);
                    }}
                  >
                    <span className="badge" style={{ background: KIND_BADGE.acces.color }}>
                      {KIND_BADGE.acces.text}
                    </span>
                    <span className="item-main">
                      <b>{a.name}</b>
                      {a.desc && <small>{a.desc.split('\n')[0]}</small>}
                    </span>
                    <span className="item-side">
                      <b>{fmtDist(a.d)}</b>
                      {a.pk !== undefined && a.code && (
                        <small>
                          {a.code === t.code ? '' : `L${fmtLine(a.code)} `}PK {fmtPk(a.pk)}
                        </small>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted small">Touche un accès pour en faire la destination de l’itinéraire.</p>
          </>
        )}

        {nearby.length > 0 && (
          <>
            <div className="field-label">Près de ce PK</div>
            <ul className="items">
              {nearby.map((it, i) => {
                const b = KIND_BADGE[it.kind] ?? { text: '?', color: '#6b7280', name: it.kind };
                return (
                  <li key={i}>
                    <button className="item" onClick={() => p.onFocus(it.lonlat)}>
                      {it.ic && SIGNAL_ICONS ? (
                        <span className="badge-sig" title={b.name}>
                          <img src={signalImage(it.ic)} alt="" loading="lazy" />
                        </span>
                      ) : (
                        <span className="badge" style={{ background: b.color }} title={b.name}>
                          {b.text}
                        </span>
                      )}
                      <span className="item-main">
                        <b>{it.label}</b>
                        {it.detail && <small>{it.detail}</small>}
                      </span>
                      <span className="item-side">
                        <b>{it.dist < 1 ? 'Ici' : `${it.pk >= t.pk ? '↑' : '↓'} ${fmtDist(it.dist)}`}</b>
                        <small>PK {fmtPk(it.pk)}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="disclaimer">
          Position du PK calculée à partir des données ouvertes : à confirmer sur place (bornes, pancartes). L’itinéraire
          routier mène au plus près par la route, pas forcément à un accès autorisé aux voies.
        </p>
      </div>
    </section>
  );
}
