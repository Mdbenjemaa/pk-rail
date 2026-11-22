import { useEffect, useState } from 'react';
import type { AccesSet } from '../lib/acces';
import type { LineDoc, LinePoint, Manifest } from '../lib/data';
import { fmtDist, fmtLine, fmtPk } from '../lib/format';
import type { Fix } from '../lib/gps';
import { kindVisible, KIND_BADGE, type Filters } from '../lib/layers';
import type { LineCandidate, Match } from '../lib/locate';
import { aroundPk, sectionAt, statutAt, type AroundItem } from '../lib/nearby';
import type { PkEstimate } from '../lib/pkfilter';
import type { AwakeStatus } from '../lib/wakelock';
import { PkCounter } from './PkCounter';

export type LocateState =
  | { phase: 'idle' }
  | { phase: 'acquiring'; fix: Fix | null; elapsed: number }
  | { phase: 'error'; message: string }
  | {
      phase: 'result';
      fix: Fix;
      mode: 'gps' | 'manuel' | 'suivi';
      radius: number;
      match: Match;
      chosen: LineCandidate | null;
      doc: LineDoc | null;
    };

interface Props {
  state: LocateState;
  manifest: Manifest | null;
  filters: Filters;
  expanded: boolean;
  following: boolean;
  /** PK lissé pendant le suivi. */
  followPk?: PkEstimate | null;
  awake?: AwakeStatus | null;
  /** La carte a été déplacée à la main pendant le suivi. */
  mapFree?: boolean;
  onToggleFollow?: () => void;
  onRecenter?: () => void;
  onToggleExpand: () => void;
  onChoose: (code: string) => void;
  onGoPk: (code: string, text: string) => void;
  acces: AccesSet[];
  onFocus: (at: [number, number]) => void;
  onStopAcquire: () => void;
  onClose: () => void;
}

/** Secondes écoulées depuis la dernière position, rafraîchies chaque seconde. */
function useSince(time: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.round((now - time) / 1000));
}

/** En-tête du suivi en direct : gros compteur PK au mètre. */
function FollowHead(p: {
  code: string;
  name: string | null;
  pk: number;
  est: PkEstimate | null;
  fix: Fix;
  awake: AwakeStatus | null;
  onToggleExpand: () => void;
}) {
  const since = useSince(p.fix.time);
  const dir = p.est?.dir === 1 ? '▲ PK croissants' : p.est?.dir === -1 ? '▼ PK décroissants' : null;
  return (
    <div className="pk-block follow-block" onClick={p.onToggleExpand}>
      <div className="eyebrow">
        <span className="live-dot" /> Ligne {fmtLine(p.code)} · suivi en direct
      </div>
      <PkCounter value={p.est?.pk ?? p.pk} />
      <div className="muted">
        {dir && <b>{dir} · </b>}
        {p.name ?? 'Ligne sans nom'} · GPS ± {Math.round(p.fix.accuracy)} m
      </div>
      {since >= 8 && <div className="warn small">Signal GPS perdu depuis {since} s : le PK n’avance plus.</div>}
      {p.awake && p.awake !== 'on' && (
        <div className="muted small">L’écran peut se mettre en veille : désactive la mise en veille automatique pendant le suivi.</div>
      )}
    </div>
  );
}

function Badge({ kind }: { kind: string }) {
  const b = KIND_BADGE[kind] ?? { text: '?', color: '#6b7280', name: kind };
  return (
    <span className="badge" style={{ background: b.color }} title={b.name}>
      {b.text}
    </span>
  );
}

function ItemRow({ it, onFocus }: { it: AroundItem; onFocus: (at: [number, number]) => void }) {
  return (
    <li>
      <button className="item" onClick={() => onFocus(it.lonlat)}>
        <Badge kind={it.kind} />
        <span className="item-main">
          <b>{it.label}</b>
          {it.detail && <small>{it.detail}</small>}
        </span>
        <span className="item-side">
          <b>{fmtDist(it.dist)}</b>
          <small>PK {fmtPk(it.pk)}</small>
        </span>
      </button>
    </li>
  );
}

/**
 * Saisie « Aller au PK » : une case pour les kilomètres, une pour les mètres, comme sur une borne
 * (le clavier chiffres de l'iPhone n'a pas de « + »). « 45,2 » dans la première case marche aussi.
 */
function PkForm({ onGo }: { onGo: (text: string) => void }) {
  const [km, setKm] = useState('');
  const [m, setM] = useState('');
  const kmClean = km.trim();
  const decimal = /[.,]/.test(kmClean);
  const submit = () => {
    if (!kmClean) return;
    onGo(!decimal && m.trim() ? `${kmClean}+${m.trim().padStart(3, '0')}` : kmClean);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  return (
    <form
      className="pk-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="go-pk">Aller au PK</label>
      <input
        id="go-pk"
        className="pk-km"
        value={km}
        onChange={(e) => setKm(e.target.value.replace(/[^\d.,-]/g, ''))}
        inputMode="decimal"
        placeholder="45"
        aria-label="Kilomètres"
        autoComplete="off"
      />
      <span className="pk-plus" aria-hidden="true">
        +
      </span>
      <input
        className="pk-m"
        value={m}
        onChange={(e) => setM(e.target.value.replace(/\D/g, '').slice(0, 3))}
        inputMode="numeric"
        placeholder="200"
        aria-label="Mètres"
        autoComplete="off"
        disabled={decimal}
      />
      <button className="btn btn-small" type="submit" disabled={!kmClean}>
        Go
      </button>
    </form>
  );
}

export function LocatePanel(p: Props) {
  const { state } = p;
  if (state.phase === 'idle') return null;

  if (state.phase === 'acquiring') {
    return (
      <section className="sheet sheet-peek" aria-live="polite">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Repérage GPS en cours…</div>
            <div className="big">{state.fix ? `± ${Math.round(state.fix.accuracy)} m` : 'Recherche des satellites'}</div>
            <div className="muted">
              {state.fix ? `${state.fix.samples} mesure(s) · ${Math.round(state.elapsed / 1000)} s` : 'Reste immobile, téléphone vers le ciel.'}
            </div>
          </div>
          <button className="btn" onClick={p.onStopAcquire}>
            Utiliser
          </button>
        </div>
      </section>
    );
  }

  if (state.phase === 'error') {
    return (
      <section className="sheet sheet-peek">
        <div className="sheet-head">
          <div className="error">{state.message}</div>
          <button className="icon-btn" onClick={p.onClose} aria-label="Fermer">
            ×
          </button>
        </div>
      </section>
    );
  }

  const { fix, match, chosen, doc, mode, radius } = state;
  const name = chosen ? (p.manifest?.lines[chosen.code]?.n ?? doc?.name) : null;
  const tracks = chosen ? match.tracks.filter((t) => t.code === chosen.code).slice(0, 3) : [];
  const accesHere: LinePoint[] = chosen
    ? p.acces.flatMap((set) =>
        set.items
          .filter((a) => a.code === chosen.code && a.pk !== undefined)
          .map((a): LinePoint => [a.pk!, 'acces', a.name, a.desc.split('\n')[0] ?? '', a.lonlat[0], a.lonlat[1]]),
      )
    : [];
  const around =
    doc && chosen ? aroundPk({ ...doc, points: doc.points.concat(accesHere) }, chosen.pk, (k) => kindVisible(p.filters, k)) : null;
  const vmax = doc && chosen ? sectionAt(doc, 'vmax', chosen.pk) : null;
  const elec = doc && chosen ? sectionAt(doc, 'elec', chosen.pk) : null;
  const cant = doc && chosen ? sectionAt(doc, 'cant', chosen.pk) : null;
  const kvb = doc && chosen ? sectionAt(doc, 'kvb', chosen.pk) : null;
  const ecart = doc && chosen ? sectionAt(doc, 'ecart', chosen.pk) : null;
  const statut = doc && chosen ? statutAt(doc, chosen.pk) : null;
  const others = match.lines.filter((l) => l.code !== chosen?.code);

  return (
    <section className={`sheet ${p.expanded ? 'sheet-full' : 'sheet-peek'}`} aria-live="polite">
      <button className="grab" onClick={p.onToggleExpand} aria-label={p.expanded ? 'Réduire' : 'Agrandir'} />
      <div className="sheet-head">
        {chosen && p.following && mode === 'suivi' ? (
          <FollowHead
            code={chosen.code}
            name={name ?? null}
            pk={chosen.pk}
            est={p.followPk ?? null}
            fix={fix}
            awake={p.awake ?? null}
            onToggleExpand={p.onToggleExpand}
          />
        ) : chosen ? (
          <div className="pk-block" onClick={p.onToggleExpand}>
            <div className="eyebrow">
              Ligne {fmtLine(chosen.code)}
              {mode === 'manuel' ? ' · position placée à la main' : mode === 'suivi' ? ' · suivi en continu' : ''}
            </div>
            <div className="pk">PK {fmtPk(chosen.pk)}</div>
            <div className="muted">
              {name ?? 'Ligne sans nom'} · à {Math.round(chosen.dist)} m de l’axe{mode !== 'manuel' && ` · GPS ± ${Math.round(fix.accuracy)} m`}
            </div>
          </div>
        ) : (
          <div>
            <div className="eyebrow">Aucune ligne trouvée</div>
            <div className="muted">
              Pas de ligne SNCF à moins de {radius} m (GPS ± {Math.round(fix.accuracy)} m). Rapproche-toi des voies ou indique une
              distance plus grande.
            </div>
          </div>
        )}
        <button className="icon-btn" onClick={p.onClose} aria-label="Fermer">
          ×
        </button>
      </div>

      {chosen && mode !== 'manuel' && p.onToggleFollow && (
        <div className="follow-row">
          {p.following ? (
            <>
              {p.mapFree && (
                <button className="btn btn-small" onClick={p.onRecenter}>
                  ◎ Recentrer
                </button>
              )}
              <button className="btn btn-small btn-stop" onClick={p.onToggleFollow}>
                ■ Arrêter le suivi
              </button>
            </>
          ) : (
            <button className="btn primary wide" onClick={p.onToggleFollow}>
              ▶ Suivre le PK en direct
            </button>
          )}
        </div>
      )}

      <div className="sheet-body">
        {chosen && <PkForm onGo={(text) => p.onGoPk(chosen.code, text)} />}
        {tracks.length > 0 && (
          <p className="muted small">
            Voie la plus proche (indicatif) :{' '}
            {tracks.map((t, i) => (
              <span key={t.name}>
                {i > 0 && ' · '}
                <b>{t.name}</b> {Math.round(t.dist)} m
              </span>
            ))}
          </p>
        )}

        {others.length > 0 && (
          <>
            <div className="field-label">Autres lignes proches</div>
            <div className="chips">
              {others.slice(0, 5).map((l) => (
                <button key={l.code} className="chip" onClick={() => p.onChoose(l.code)}>
                  {fmtLine(l.code)} · {Math.round(l.dist)} m · PK {fmtPk(l.pk)}
                </button>
              ))}
            </div>
          </>
        )}

        {chosen && (
          <dl className="facts">
            {statut && (
              <>
                <dt>Statut</dt>
                <dd>{statut}</dd>
              </>
            )}
            {vmax && (
              <>
                <dt>Vitesse nominale</dt>
                <dd>{vmax} km/h</dd>
              </>
            )}
            <dt>Électrification</dt>
            <dd>{elec ?? 'Non électrifiée (ou non renseigné)'}</dd>
            {cant && (
              <>
                <dt>Cantonnement</dt>
                <dd>{cant}</dd>
              </>
            )}
            <dt>KVB</dt>
            <dd>{kvb ? 'Ligne équipée' : 'Non renseigné'}</dd>
            {ecart && (
              <>
                <dt>Écartement</dt>
                <dd>{ecart}</dd>
              </>
            )}
          </dl>
        )}

        {around && around.inside.length > 0 && (
          <>
            <div className="field-label">Vous êtes dans</div>
            <ul className="items">
              {around.inside.map((it, i) => (
                <ItemRow key={`in-${i}`} it={it} onFocus={p.onFocus} />
              ))}
            </ul>
          </>
        )}
        {around && (
          <div className="sides">
            <div>
              <div className="field-label">↑ Vers les PK croissants</div>
              {around.ahead.length ? (
                <ul className="items">
                  {around.ahead.map((it, i) => (
                    <ItemRow key={`a-${i}`} it={it} onFocus={p.onFocus} />
                  ))}
                </ul>
              ) : (
                <p className="muted small">Rien dans les 15 km (selon les filtres).</p>
              )}
            </div>
            <div>
              <div className="field-label">↓ Vers les PK décroissants</div>
              {around.behind.length ? (
                <ul className="items">
                  {around.behind.map((it, i) => (
                    <ItemRow key={`b-${i}`} it={it} onFocus={p.onFocus} />
                  ))}
                </ul>
              ) : (
                <p className="muted small">Rien dans les 15 km (selon les filtres).</p>
              )}
            </div>
          </div>
        )}
        <p className="disclaimer">
          Aide au repérage, à vérifier sur le terrain (bornes, pancartes). Jamais pour l’annonce, la protection ou une manœuvre :
          seuls les documents et consignes officiels font foi.
        </p>
      </div>
    </section>
  );
}
