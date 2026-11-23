import { PREVIEW } from '../lib/env';
import { useState } from 'react';
import type { Point } from 'geojson';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { DATA_CACHE, TILES_CACHE, type Manifest } from '../lib/data';
import type { Acces, AccesSet } from '../lib/acces';
import { fmtLine, fmtPk } from '../lib/format';
import { searchAcces } from '../lib/search';
import { NavLinks } from './TargetSheet';
import { RFN_CREDIT, RFN_URL, signalImage, SIGNAL_ICONS } from '../lib/signaux';
import { InstallSteps, useInstallMode } from './Install';
import { Icon } from './parts';
import type { Theme } from './state';
import { MyMapsLink } from './MyMapsLink';
import { installMode } from '../lib/install';
import type { LonLat } from '../lib/geo';
import { FILTERS, type FilterKey, type Filters } from '../lib/layers';
import type { Basemap } from '../map/style';

export function Modal({ title, onClose, children, side }: { title: string; onClose: () => void; children: React.ReactNode; side?: boolean }) {
  return (
    <div className={`modal-back ${side ? 'side' : ''}`} onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Filtres et fond de carte ---------- */

export interface ImportStatus {
  busy: boolean;
  text: string;
  error?: boolean;
}

/** Import d'une carte d'accès : fichier KML/KMZ ou lien Google My Maps. */
function AccesImport(p: { status: ImportStatus | null; onImport: (src: File | string) => void; first: boolean }) {
  return (
    <div className="acces-box">
      <div className="field-label">{p.first ? 'Importer mes accès' : 'Ajouter d’autres accès'}</div>
      <p className="muted small">
        Fichier KML ou KMZ (Google My Maps : menu ⋮ › « Télécharger KML »), ou directement le lien de la carte Google My
        Maps. Chaque accès reçoit sa ligne et son PK. La carte reste uniquement sur ce téléphone.
      </p>
      <label className={`btn file-btn ${p.status?.busy ? 'disabled' : ''}`}>
        {p.status?.busy ? 'Import en cours…' : 'Importer un fichier KML ou KMZ'}
        <input
          type="file"
          disabled={p.status?.busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onImport(f);
            e.target.value = '';
          }}
        />
      </label>
      <MyMapsLink busy={p.status?.busy} onSubmit={p.onImport} />
      {p.status && !p.status.busy && <p className={p.status.error ? 'error small' : 'ok small'}>{p.status.text}</p>}
    </div>
  );
}

function DoorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M3 21h18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14.5" cy="12.5" r="1.3" fill="currentColor" />
    </svg>
  );
}

/** Accès d'un fichier rangés par ligne puis par PK (dans l'ordre du terrain), les autres par nom. */
function sortAcces(items: Acces[]): Acces[] {
  return [...items].sort(
    (x, y) =>
      Number(!x.code) - Number(!y.code) ||
      (x.code ?? '').localeCompare(y.code ?? '') ||
      (x.pk ?? Infinity) - (y.pk ?? Infinity) ||
      x.name.localeCompare(y.name, 'fr', { numeric: true }),
  );
}

const accesLine = (a: Acces) => (a.code ? `Ligne ${fmtLine(a.code)}` : 'Pas rattaché à une ligne');

function AccesRow({ a, sub, onPick }: { a: Acces; sub: string; onPick: (at: LonLat) => void }) {
  return (
    <li>
      <button className="acces-row" onClick={() => onPick(a.lonlat)}>
        <span className="acces-ico">
          <DoorIcon />
        </span>
        <span className="acces-main">
          <b>{a.name || 'Accès sans nom'}</b>
          <small>{sub}</small>
        </span>
        {a.pk !== undefined && <span className="acces-pk">PK {fmtPk(a.pk)}</span>}
      </button>
    </li>
  );
}

/** Un fichier importé, en menu déroulant (fermé au départ) : ses accès, puis « Voir sur la carte » et « Supprimer ». */
function AccesFile(p: {
  set: AccesSet;
  onToggle: (id: string) => void;
  onShowSet: (set: AccesSet) => void;
  onDeleteSet: (id: string) => void;
  onPick: (at: LonLat) => void;
}) {
  const [open, setOpen] = useState(false);
  const { set } = p;
  return (
    <section className={`acces-file ${open ? 'open' : ''} ${set.hidden ? 'off' : ''}`}>
      <div className="acces-file-top">
      <button className="acces-file-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="acces-file-ico">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="acces-file-name">
          <b>{set.name}</b>
          <small>
            {set.hidden
              ? `Désactivée · ${set.items.length} accès cachés`
              : `${set.items.length} accès · ${set.items.filter((a) => a.code).length} rattachés à une ligne`}
          </small>
        </span>
        <svg className="acces-chev" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <label className="acces-switch" title={set.hidden ? 'Activer cette liste' : 'Désactiver cette liste'}>
        <input type="checkbox" checked={!set.hidden} onChange={() => p.onToggle(set.id)} aria-label={`Liste « ${set.name} » activée`} />
        <span className="switch-ui" aria-hidden="true" />
      </label>
      </div>
      {open && (
        <div className="acces-file-body">
          <ul className="acces-list">
            {sortAcces(set.items).map((a, i) => (
              <AccesRow key={i} a={a} sub={accesLine(a)} onPick={p.onPick} />
            ))}
          </ul>
          <div className="acces-file-actions">
            <button className="btn btn-small" onClick={() => p.onShowSet(set)} disabled={!set.items.length}>
              Voir tout sur la carte
            </button>
            <button
              className="btn btn-small btn-ghost"
              onClick={() => {
                if (window.confirm(`Supprimer « ${set.name} » de ce téléphone ?`)) p.onDeleteSet(set.id);
              }}
            >
              Supprimer le fichier
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Bouton « Accès » : afficher ou cacher mes accès, les retrouver dans une liste, en importer, en supprimer. */
export function AccesSheet(p: {
  sets: AccesSet[];
  shown: boolean;
  onToggleShown: () => void;
  status: ImportStatus | null;
  onImport: (src: File | string) => void;
  onDeleteSet: (id: string) => void;
  onShowSet: (set: AccesSet) => void;
  /** Active ou désactive une liste (un fichier importé). */
  onToggleSet: (id: string) => void;
  onPick: (at: LonLat) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const total = p.sets.reduce((n, s) => n + s.items.length, 0);
  const found = q.trim().length >= 2 ? searchAcces(q, p.sets, 500) : null;
  return (
    <Modal title="Mes accès" onClose={p.onClose}>
      <label className="toggle">
        <span>
          Afficher mes accès sur la carte
          <small>Points verts avec leur nom. Chaque liste s’active ou se désactive avec son bouton.</small>
        </span>
        <input type="checkbox" checked={p.shown} onChange={p.onToggleShown} />
      </label>
      {total > 0 && (
        <>
          <input
            className="acces-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Chercher parmi tes ${total} accès`}
            aria-label="Chercher un accès par son nom, son détail ou son fichier"
            enterKeyHint="search"
          />
          {found ? (
            found.hits.length ? (
              <ul className="acces-list">
                {found.hits.map(({ set, a }, i) => (
                  <AccesRow key={i} a={a} sub={`${accesLine(a)} · ${set.name}`} onPick={p.onPick} />
                ))}
              </ul>
            ) : (
              <p className="muted">Aucun accès ne correspond à « {q.trim()} ».</p>
            )
          ) : (
            p.sets.map((set) => <AccesFile key={set.id} set={set} onToggle={p.onToggleSet} onShowSet={p.onShowSet} onDeleteSet={p.onDeleteSet} onPick={p.onPick} />)
          )}
        </>
      )}
      {PREVIEW ? (
        <p className="muted small">L’import d’accès n’est pas disponible dans cet aperçu.</p>
      ) : (
        <AccesImport status={p.status} onImport={p.onImport} first={total === 0} />
      )}
    </Modal>
  );
}

export function FilterSheet(p: {
  filters: Filters;
  basemap: Basemap;
  onToggle: (k: FilterKey) => void;
  onBasemap: (b: Basemap) => void;
  /** Ouvre « Mes accès » (liste, import, suppression). */
  onOpenAcces: () => void;
  onClose: () => void;
}) {
  const groups = [...new Set(FILTERS.map((f) => f.group))];
  return (
    <Modal title="Couches" onClose={p.onClose}>
      <div className="field-label">Fond de carte</div>
      <div className="chips">
        {(
          [
            ['plan', PREVIEW ? 'Plan simplifié' : 'Plan'],
            ['photo', 'Photo aérienne IGN'],
            ['aucun', 'Aucun (hors-ligne)'],
          ] as [Basemap, string][]
        ).filter(([v]) => !PREVIEW || v !== 'photo').map(([v, l]) => (
          <button key={v} className={`chip ${p.basemap === v ? 'on' : ''}`} onClick={() => p.onBasemap(v)}>
            {l}
          </button>
        ))}
      </div>
      {groups.map((g) => (
        <div key={g}>
          <div className="field-label">{g}</div>
          {FILTERS.filter((f) => f.group === g).map((f) => (
            <label key={f.key} className="toggle">
              <span>
                {f.label}
                {f.hint && <small>{f.hint}</small>}
              </span>
              <input type="checkbox" checked={p.filters[f.key]} onChange={() => p.onToggle(f.key)} />
            </label>
          ))}
        </div>
      ))}
      <p className="muted small">
        Les signaux viennent d’OpenStreetMap : couverture partielle selon les secteurs, et pas toujours à jour.
      </p>
      {!PREVIEW && (
        <button className="btn wide" onClick={p.onOpenAcces}>
          Mes accès : liste, import et suppression
        </button>
      )}
    </Modal>
  );
}

/* ---------- Informations ---------- */

export function InfoSheet(p: { manifest: Manifest | null; onClose: () => void }) {
  const q = p.manifest?.quality;
  return (
    <Modal title="À propos" onClose={p.onClose}>
      <div className="warn-box">
        <b>Aide au repérage uniquement.</b> Ne remplace jamais les documents officiels (renseignements techniques, consignes,
        avis), l’annonce, la protection ou les échanges avec l’agent circulation. Positions, PK et signaux peuvent être
        approximatifs, incomplets ou périmés.
      </div>
      <h3>Installer sur l’écran d’accueil</h3>
      <InstallSteps mode={installMode()} />
      <h3>Version</h3>
      <p className="small">
        Appli du {new Date(__BUILD__).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · données PK du{' '}
        {p.manifest ? new Date(`${p.manifest.version.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '…'}
      </p>
      <button
        className="btn wide"
        onClick={async () => {
          // Sans réseau, tout jeter laisserait le téléphone sans appli ni données : on refuse.
          if (!navigator.onLine) {
            window.alert('Pas de réseau : l’appli et les données gardées sur le téléphone sont conservées. Réessaie avec du réseau.');
            return;
          }
          if (!window.confirm('Recharger l’appli et les données depuis le site ? Les zones gardées pour le hors-ligne seront retéléchargées au fil de l’usage.')) return;
          // Dépannage : on jette l'appli et les données gardées, puis on recharge depuis le site.
          try {
            if ('caches' in globalThis) {
              for (const k of await caches.keys()) if (k === DATA_CACHE || k === TILES_CACHE || k.startsWith('workbox-precache')) await caches.delete(k);
            }
            localStorage.removeItem('pkr-data-version');
            const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
            await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
          } finally {
            location.reload();
          }
        }}
      >
        Recharger l’appli et les données
      </button>
      <p className="muted small">À utiliser si les PK ou l’appli semblent anciens. Il faut du réseau.</p>
      <h3>Sans réseau</h3>
      <p className="small">
        L’appli garde sur le téléphone ce que tu consultes : les données PK sur au moins 20 km autour de chaque
        repérage, et les morceaux de carte des voies déjà affichés. Sans réseau, le repérage, le suivi du PK et la carte
        des voies marchent donc là où tu es déjà passé. Le fond de carte (rues, photo) n’est gardé que pour les endroits vus.
      </p>
      <h3>Comment le PK est calculé</h3>
      <p>
        Le GPS donne ta position ; l’appli la rattache à la ligne SNCF la plus proche et lit le PK à cet endroit. Les PK le long des lignes sont recalés sur les quelque 63 000 repères dont SNCF
        Réseau publie à la fois le PK et la position : PN, gares, ponts-route, quais, extrémités de voies et de sections.
      </p>
      {q && (
        <ul className="small">
          <li>
            Contrôle sur {q.pk_recalage.validation_points?.toLocaleString('fr-FR')} repères masqués : écart médian{' '}
            {q.pk_recalage.erreur_mediane_m} m, 90 % sous {q.pk_recalage.erreur_p90_m} m.
          </li>
          {q.controle_bornes_osm.bornes ? (
            <li>
              Recalage aussi sur {q.reperes.borne?.toLocaleString('fr-FR')} bornes kilométriques relevées dans OpenStreetMap.
              Contrôle sur {q.controle_bornes_osm.bornes.toLocaleString('fr-FR')} bornes mises de côté : 90 % sous{' '}
              {String(q.controle_bornes_osm.apres_p90_m).replace('.', ',')} m (avant : {String(q.controle_bornes_osm.avant_p90_m).replace('.', ',')} m).
              Là où aucune borne n’est relevée, l’écart peut dépasser 100 m : fie-toi aux bornes sur le terrain.
            </li>
          ) : (
            <li>
              Contrôle sur {q.controle_bornes_osm.bornes_comparees?.toLocaleString('fr-FR')} bornes kilométriques relevées dans
              OpenStreetMap : écart médian {q.controle_bornes_osm.ecart_median_m} m, 75 % sous {q.controle_bornes_osm.ecart_p75_m} m.
            </li>
          )}
          <li>À cela s’ajoute l’imprécision du GPS du téléphone (souvent 5 à 15 m).</li>
        </ul>
      )}
      <h3>Astuces</h3>
      <ul className="small">
        <li>« Me repérer » écoute le GPS jusqu’à 12 s et combine les mesures : reste immobile, à découvert.</li>
        <li>Deux lignes proches : si ce n’est pas la bonne, touche le PK puis ta ligne dans « Autres lignes ici ».</li>
        <li>Appui long sur la carte : « me placer ici » (utile si le GPS est mauvais, ou pour préparer une intervention).</li>
        <li>Touche un élément de la carte pour voir son PK et sa ligne.</li>
      </ul>
      <h3>Sources</h3>
      <ul className="small">
        {p.manifest?.sources.map((s) => (
          <li key={s.name}>
            {s.name} — {s.license}
            {s.date ? ` (extrait du ${s.date})` : ''} —{' '}
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.url.replace(/^https?:\/\//, '')}
            </a>
          </li>
        ))}
        <li>Fond plan : OpenFreeMap © OpenMapTiles, données © OpenStreetMap. Photo aérienne : © IGN (Licence Ouverte).</li>
        <li>
          {RFN_CREDIT} —{' '}
          <a href={RFN_URL} target="_blank" rel="noreferrer">
            {RFN_URL.replace(/^https?:\/\//, '')}
          </a>
          . L’appli est elle aussi sous licence GPL-3.0.
        </li>
      </ul>
      <p className="muted small">
        Données SNCF Réseau publiées entre 2020 et 2022 : des modifications récentes du réseau peuvent manquer. Version des
        données : {p.manifest?.version ?? '—'}. Projet personnel, indépendant de la SNCF.
      </p>
    </Modal>
  );
}

/* ---------- Premier lancement ---------- */

export function Disclaimer({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="modal-back">
      <div className="modal">
        <div className="modal-body">
          <h2>PK Rail</h2>
          <p>Pour savoir où tu es sur le réseau : ligne, PK, gares, PN, tunnels, signaux autour de toi.</p>
          {PREVIEW && (
            <p>
              <b>Version d’essai :</b> ici le GPS et les fonds plan et photo sont bloqués. Cherche une gare, puis appuie
              longuement sur la carte près des voies pour te placer.
            </p>
          )}
          <div className="warn-box">
            <b>Aide au repérage, jamais une référence de sécurité.</b> PK et signaux calculés à partir de données ouvertes (SNCF
            Réseau, OpenStreetMap) : ils peuvent être faux, incomplets ou périmés. Ne t’en sers pas pour une annonce, une
            protection de chantier ou une manœuvre ; vérifie toujours sur le terrain et dans les documents officiels.
          </div>
          <button className="btn primary wide" onClick={onAccept}>
            J’ai compris
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Fiche d'un élément touché sur la carte ---------- */

const LAYER_TITLE: Record<string, string> = {
  'r-gares': 'Gare', 'r-pn': 'Passage à niveau', 'r-sst': 'Sous-station', 'r-ouvrages': 'Ouvrage',
  'r-bornes': 'Borne kilométrique (OpenStreetMap)', 'r-pk-km': 'PK calculé', 'r-pk-hm': 'PK calculé',
  'r-sig-carre': 'Signal (OpenStreetMap)', 'r-sig-avert': 'Signal (OpenStreetMap)', 'r-sig-vitesse': 'Pancarte (OpenStreetMap)',
  'r-sig-elec': 'Signal électrique (OpenStreetMap)', 'r-sig-autre': 'Signal (OpenStreetMap)', 'r-quais': 'Quai',
  'r-voies': 'Voie', 'r-tunnels': 'Tunnel (OpenStreetMap)', 'r-lignes': 'Ligne', 'r-lignes-autres': 'Ligne',
  'u-acces': 'Accès (importé)', 'u-target': 'Destination',
};

export function FeatureCard(p: {
  feature: MapGeoJSONFeature;
  at: LonLat;
  manifest: Manifest | null;
  onPlaceHere: (at: LonLat) => void;
  onClose: () => void;
}) {
  const f = p.feature;
  const pr = f.properties as Record<string, string | undefined>;
  const layer = f.layer.id;
  // « -ic » : même couche, signaux dessinés.
  const title = LAYER_TITLE[layer.replace(/-ic$/, '')] ?? 'Élément';
  let name = pr.n ?? pr.l ?? '';
  if (layer.startsWith('r-pk')) name = `PK ${pr.p}`;
  if (layer === 'r-bornes') name = `Borne ${pr.p}`;
  if (layer === 'r-voies') name = pr.n ? `Voie ${pr.n}` : 'Voie sans nom';
  if (layer.startsWith('r-lignes')) name = `Ligne ${fmtLine(pr.c ?? '')}`;
  const lineName = pr.c ? p.manifest?.lines[pr.c]?.n : null;
  const point = f.geometry.type === 'Point' ? ((f.geometry as Point).coordinates as LonLat) : p.at;
  const dessin = SIGNAL_ICONS && pr.ic ? pr.ic : null;

  return (
    <section className="card">
      <div className="sheet-head">
        <div>
          <div className="eyebrow">{title}</div>
          <div className="card-title">{name}</div>
        </div>
        <button className="icon-btn" onClick={p.onClose} aria-label="Fermer">
          ×
        </button>
      </div>
      {dessin && (
        <figure className="sig-figure">
          <img src={signalImage(dessin)} alt={`Dessin du signal : ${name}`} />
          <figcaption>
            Dessin type de ce signal. Le signal réel peut différer : vérifie toujours sur le terrain.
          </figcaption>
        </figure>
      )}
      <dl className="facts">
        {pr.pk && (
          <>
            <dt>PK</dt>
            <dd>{pr.pk}</dd>
          </>
        )}
        {pr.c && (
          <>
            <dt>Ligne</dt>
            <dd>
              {fmtLine(pr.c)}
              {lineName ? ` — ${lineName}` : ''}
            </dd>
          </>
        )}
        {pr.d && (
          <>
            <dt>Détail</dt>
            <dd>{pr.d}</dd>
          </>
        )}
        {pr.g && (
          <>
            <dt>Gare</dt>
            <dd>{pr.g}</dd>
          </>
        )}
        {layer === 'r-voies' && pr.t && (
          <>
            <dt>Type SNCF</dt>
            <dd>{pr.t}</dd>
          </>
        )}
        {layer === 'r-gares' && (
          <>
            <dt>Service</dt>
            <dd>{pr.k === 'V' ? 'Voyageurs' : 'Fret / service'}</dd>
          </>
        )}
        {pr.set && (
          <>
            <dt>Carte</dt>
            <dd>{pr.set}</dd>
          </>
        )}
      </dl>
      {f.geometry.type === 'Point' && (
        <>
          <div className="field-label">Itinéraire en voiture</div>
          <NavLinks at={point} />
        </>
      )}
      <button className="btn" onClick={() => p.onPlaceHere(point)}>
        Me placer ici
      </button>
    </section>
  );
}

/* ---------- Menu « … » ---------- */

const THEMES: [Theme, string][] = [
  ['auto', 'Auto'],
  ['jour', 'Jour'],
  ['nuit', 'Nuit'],
];

export function MenuSheet(p: {
  theme: Theme;
  onTheme: (t: Theme) => void;
  /** Une position est affichée : on peut l'effacer. */
  located: boolean;
  onClear: () => void;
  onInfo: () => void;
  /** Nombre de signalements gardés sur le téléphone. */
  signalements: number;
  onSignalements: () => void;
  onClose: () => void;
}) {
  const mode = useInstallMode();
  return (
    <Modal title="Menu" onClose={p.onClose}>
      <div className="field-label">Affichage</div>
      <div className="seg seg-3" role="radiogroup" aria-label="Affichage">
        {THEMES.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={p.theme === v} className={`seg-btn ${p.theme === v ? 'on' : ''}`} onClick={() => p.onTheme(v)}>
            {l}
          </button>
        ))}
      </div>
      <p className="muted small">
        Nuit : appli et carte sombres, pour travailler de nuit sans être ébloui. Auto suit le mode sombre du téléphone.
      </p>
      {p.located && (
        <button className="menu-row" onClick={p.onClear}>
          <Icon name="close" size={22} />
          <span>Effacer ma position</span>
        </button>
      )}
      <button className="menu-row" onClick={p.onSignalements}>
        <Icon name="alert" size={20} />
        <span>Mes signalements{p.signalements ? ` (${p.signalements})` : ''}</span>
        <Icon name="right" size={18} />
      </button>
      <button className="menu-row" onClick={p.onInfo}>
        <Icon name="info" size={22} />
        <span>À propos, sources et version</span>
        <Icon name="right" size={20} />
      </button>
      {mode !== 'installed' && (
        <>
          <div className="field-label">Installer sur l’écran d’accueil</div>
          <InstallSteps mode={mode} />
        </>
      )}
    </Modal>
  );
}
