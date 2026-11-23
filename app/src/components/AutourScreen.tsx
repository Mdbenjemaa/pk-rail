import type { AccesSet } from '../lib/acces';
import type { Manifest } from '../lib/data';
import { fmtLine, fmtPk } from '../lib/format';
import type { Filters } from '../lib/layers';
import { accesOnLine, aroundHere, cantShort, TYPES } from '../lib/lineinfo';
import { sectionAt, statutAt } from '../lib/nearby';
import { Deroulant, Icon, ItemRow, PkForm } from './parts';
import type { LocateResult } from './state';

export type AutourTab = 'autour' | 'ligne';

interface Props {
  state: LocateResult;
  /** PK affiché (lissé pendant le suivi). */
  pk: number;
  manifest: Manifest | null;
  filters: Filters;
  acces: AccesSet[];
  typeFiltre: string;
  onTypeFiltre: (key: string) => void;
  tab: AutourTab;
  onTab: (tab: AutourTab) => void;
  onFocus: (at: [number, number]) => void;
  onChoose: (code: string) => void;
  onGoPk: (code: string, text: string) => void;
  onClose: () => void;
}

/** Écran « Autour de toi » : tout ce qu'il y a de part et d'autre du PK, et les caractéristiques de la ligne. */
export function AutourScreen(p: Props) {
  const { match, chosen, doc } = p.state;
  if (!chosen) return null;
  const code = chosen.code;
  const name = p.manifest?.lines[code]?.n ?? doc?.name ?? 'Ligne sans nom';
  const tracks = match.tracks.filter((t) => t.code === code).slice(0, 3);
  const accesHere = accesOnLine(p.acces, code);
  const around = doc ? aroundHere(doc, p.pk, p.filters, p.typeFiltre, accesHere) : null;
  const others = match.lines.filter((l) => l.code !== code);
  const statut = doc ? statutAt(doc, p.pk) : null;
  const vmax = doc ? sectionAt(doc, 'vmax', p.pk) : null;
  const elec = doc ? sectionAt(doc, 'elec', p.pk) : null;
  const cant = doc ? sectionAt(doc, 'cant', p.pk) : null;
  const cantAbr = cantShort(cant);
  const kvb = doc ? sectionAt(doc, 'kvb', p.pk) : null;
  const ecart = doc ? sectionAt(doc, 'ecart', p.pk) : null;

  return (
    <div className="screen" role="dialog" aria-label="Autour de toi">
      <header className="screen-head">
        <button className="round-btn" onClick={p.onClose} aria-label="Retour à la carte">
          <Icon name="back" />
        </button>
        <div className="screen-title">
          <b>Autour de toi</b>
          <small>
            PK {fmtPk(p.pk)} · ligne {fmtLine(code)}
            {tracks[0] ? ` · voie ${tracks[0].name}` : ''}
          </small>
        </div>
      </header>
      <div className="seg" role="tablist" aria-label="Vue">
        <button role="tab" aria-selected={p.tab === 'autour'} className={`seg-btn ${p.tab === 'autour' ? 'on' : ''}`} onClick={() => p.onTab('autour')}>
          Autour
        </button>
        <button role="tab" aria-selected={p.tab === 'ligne'} className={`seg-btn ${p.tab === 'ligne' ? 'on' : ''}`} onClick={() => p.onTab('ligne')}>
          La ligne
        </button>
      </div>

      {p.tab === 'autour' ? (
        <div className="screen-body">
          <div className="type-chips" role="group" aria-label="Filtrer par type">
            {TYPES.filter((t) => t.key !== 'acces' || accesHere.length > 0 || p.typeFiltre === 'acces').map((t) => (
              <button key={t.key} className={`chip ${p.typeFiltre === t.key ? 'on' : ''}`} aria-pressed={p.typeFiltre === t.key} onClick={() => p.onTypeFiltre(t.key)}>
                {t.label}
              </button>
            ))}
          </div>
          {around && around.inside.length > 0 && (
            <div className="deroulant open">
              <div className="deroulant-head static">
                <span className="dir-dot dark">
                  <Icon name="here" size={18} />
                </span>
                <span className="deroulant-title">Tu es dans</span>
              </div>
              <ul className="items">
                {around.inside.map((it, i) => (
                  <ItemRow key={`in-${i}`} it={it} here onFocus={p.onFocus} />
                ))}
              </ul>
            </div>
          )}
          {around ? (
            <>
              <Deroulant dir={1} items={around.ahead} onFocus={p.onFocus} />
              <Deroulant dir={-1} items={around.behind} onFocus={p.onFocus} />
            </>
          ) : (
            <p className="muted">Détails de la ligne indisponibles pour le moment (pas de réseau ?).</p>
          )}
          <p className="disclaimer">
            Aide au repérage, à vérifier sur le terrain (bornes, pancartes). Jamais pour l’annonce, la protection ou une
            manœuvre : seuls les documents et consignes officiels font foi.
          </p>
        </div>
      ) : (
        <div className="screen-body">
          <dl className="facts-list">
            <div>
              <dt>Ligne</dt>
              <dd>
                {fmtLine(code)} · {name}
              </dd>
            </div>
            {statut && (
              <div>
                <dt>Statut</dt>
                <dd className={statut !== 'Exploitée' ? 'warn-text' : ''}>{statut}</dd>
              </div>
            )}
            {vmax && (
              <div>
                <dt>Vitesse maximale ici</dt>
                <dd>{vmax} km/h</dd>
              </div>
            )}
            <div>
              <dt>Électrification</dt>
              <dd>{elec ? (elec === '1500 V' ? '1500 V continu' : elec) : 'Non électrifiée (ou non renseigné)'}</dd>
            </div>
            {cant && !cant.startsWith('_') && (
              <div>
                <dt>Cantonnement</dt>
                <dd>
                  {cant}
                  {cantAbr && cantAbr !== cant && !cantAbr.includes(' · ') ? ` (${cantAbr})` : ''}
                </dd>
              </div>
            )}
            <div>
              <dt>Contrôle de vitesse</dt>
              <dd>{kvb ? 'KVB' : 'Non renseigné'}</dd>
            </div>
            {ecart && (
              <div>
                <dt>Écartement</dt>
                <dd>{ecart}</dd>
              </div>
            )}
            {tracks.length > 0 && (
              <div>
                <dt>Voie la plus proche (indicatif)</dt>
                <dd>
                  {tracks.map((t, i) => (
                    <span key={t.name}>
                      {i > 0 && ' · '}
                      {t.name} à {Math.round(t.dist)} m
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>

          {others.length > 0 && (
            <>
              <div className="field-label">Autres lignes ici</div>
              <div className="other-lines">
                {others.slice(0, 5).map((l) => (
                  <button key={l.code} className="other-line" onClick={() => p.onChoose(l.code)}>
                    <span>
                      <b>Ligne {fmtLine(l.code)}</b>
                      <small>
                        PK {fmtPk(l.pk)} · à {Math.round(l.dist)} m
                        {p.manifest?.lines[l.code]?.n ? ` · ${p.manifest.lines[l.code].n}` : ''}
                      </small>
                    </span>
                    <Icon name="right" size={20} />
                  </button>
                ))}
              </div>
              <p className="muted small">Ce n’est pas ta ligne ? Touche la bonne pour recalculer le PK.</p>
            </>
          )}

          <PkForm onGo={(text) => p.onGoPk(code, text)} />
          <p className="disclaimer">
            Caractéristiques issues des données ouvertes SNCF Réseau (2020-2022) : elles peuvent avoir changé depuis.
          </p>
        </div>
      )}
    </div>
  );
}
