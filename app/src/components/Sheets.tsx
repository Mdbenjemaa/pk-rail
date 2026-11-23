import { PREVIEW } from '../lib/env';
import { useEffect, useMemo, useState } from 'react';
import type { Point } from 'geojson';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { loadGares, type GareEntry, type Manifest } from '../lib/data';
import type { AccesSet } from '../lib/acces';
import { fmtLine, fmtPk } from '../lib/format';
import { parsePk, parsePkQuery } from '../lib/pk';
import { NavLinks } from './TargetSheet';
import { bestIndexes, normName } from '../lib/search';
import { RFN_CREDIT, RFN_URL, signalImage, SIGNAL_ICONS } from '../lib/signaux';
import { InstallSteps } from './Install';
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

/** Import et liste des cartes d'accès enregistrées sur le téléphone. */
function AccesManager(p: {
  sets: AccesSet[];
  status: ImportStatus | null;
  onImport: (src: File | string) => void;
  onDelete: (id: string) => void;
  onShow: (set: AccesSet) => void;
}) {
  return (
    <div className="acces-box">
      <div className="field-label">Mes accès</div>
      <p className="muted small">
        Importe une carte d’accès : fichier KML ou KMZ (Google My Maps : menu ⋮ › « Télécharger KML »), ou directement
        le lien de la carte Google My Maps. Chaque accès reçoit sa ligne et son PK. La carte reste uniquement sur ce téléphone.
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
      {p.sets.length > 0 && (
        <ul className="sets">
          {p.sets.map((set) => (
            <li key={set.id}>
              <button className="set-name" onClick={() => p.onShow(set)}>
                <b>{set.name}</b>
                <small>
                  {set.items.length} accès · {set.items.filter((a) => a.code).length} rattachés à une ligne
                </small>
              </button>
              <button
                className="btn btn-small btn-ghost"
                onClick={() => {
                  if (window.confirm(`Supprimer « ${set.name} » de ce téléphone ?`)) p.onDelete(set.id);
                }}
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FilterSheet(p: {
  filters: Filters;
  basemap: Basemap;
  onToggle: (k: FilterKey) => void;
  onBasemap: (b: Basemap) => void;
  acces: AccesSet[];
  importStatus: ImportStatus | null;
  onImport: (src: File | string) => void;
  onDeleteSet: (id: string) => void;
  onShowSet: (set: AccesSet) => void;
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
        <AccesManager sets={p.acces} status={p.importStatus} onImport={p.onImport} onDelete={p.onDeleteSet} onShow={p.onShowSet} />
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
          // Dépannage : on jette l'appli et les données gardées, puis on recharge depuis le site.
          try {
            if ('caches' in globalThis) for (const k of await caches.keys()) if (k === 'pkr-data' || k.startsWith('workbox-precache')) await caches.delete(k);
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
        <li>Deux lignes proches : si ce n’est pas la bonne, touche la tienne dans « Autres lignes proches ».</li>
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

/* ---------- Recherche ---------- */

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

interface SearchResult {
  label: string;
  sub: string;
  at?: LonLat;
  zoom?: number;
  pk?: { code: string; pk: number };
}

const RECENTS_KEY = 'pkr-recherches';
function loadRecents(): SearchResult[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(v) ? v.slice(0, 6) : [];
  } catch {
    return [];
  }
}
function saveRecents(list: SearchResult[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* stockage plein ou bloqué */
  }
}

export function Search(p: {
  manifest: Manifest | null;
  /** Ligne où l'on se trouve (ou celle du chantier) : un PK tapé seul s'y rapporte. */
  currentLine: string | null;
  onGo: (at: LonLat, zoom: number) => void;
  onPk: (code: string, pk: number) => void;
}) {
  const [q, setQ] = useState('');
  const [gares, setGares] = useState<GareEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [recents, setRecents] = useState<SearchResult[]>(() => loadRecents());
  // Noms de gares préparés une fois (accents, « Saint » → « St ») pour chercher vite à chaque lettre.
  const garesNorm = useMemo(() => (gares ?? []).map((g) => normName(g[0])), [gares]);

  useEffect(() => {
    if (open && !gares) loadGares().then(setGares).catch(() => setGares([]));
  }, [open, gares]);

  const nq = norm(q);
  const results: SearchResult[] = [];
  const pkq = parsePkQuery(q);
  if (pkq && p.manifest?.lines[pkq.code]) {
    results.push({
      label: `PK ${fmtPk(pkq.pk)} · ligne ${fmtLine(pkq.code)}`,
      sub: p.manifest.lines[pkq.code].n ?? 'Aller à ce PK',
      pk: pkq,
    });
  }
  // PK tapé seul (« 45+200 », « 45,2 », « PK 45 ») : sur la ligne où l'on est.
  const pkAlone = !pkq && /^\s*(pk\s*)?-?\d{1,4}(\s*[+,.]\s*\d{1,3})?\s*$/i.test(q) && (/[+,.]|pk/i.test(q) || q.trim().length <= 3);
  const alonePk = pkAlone ? parsePk(q) : null;
  if (alonePk !== null) {
    if (p.currentLine && p.manifest?.lines[p.currentLine]) {
      results.push({
        label: `PK ${fmtPk(alonePk)} · ligne ${fmtLine(p.currentLine)}`,
        sub: `${p.manifest.lines[p.currentLine].n ?? ''} (ta ligne)`,
        pk: { code: p.currentLine, pk: alonePk },
      });
    } else {
      results.push({ label: `PK ${fmtPk(alonePk)} : sur quelle ligne ?`, sub: 'Repère-toi d’abord, ou tape la ligne puis le PK : 830000 45+200' });
    }
  }
  if (nq.length >= 2 && !pkq && !(alonePk !== null && /[+,.]|pk/i.test(q))) {
    const digits = nq.replace(/\s/g, '');
    if (/^\d{3,6}$/.test(digits) && p.manifest) {
      for (const [code, info] of Object.entries(p.manifest.lines)) {
        if (code.startsWith(digits) && results.length < 4) {
          const g = gares?.find((x) => x[3] === code);
          if (g) results.push({ label: `Ligne ${fmtLine(code)}`, sub: info.n ?? '', at: [g[1], g[2]], zoom: 11 });
        }
      }
    }
    // Gares : début du nom ou d'un mot d'abord, puis noms approchants (fautes de frappe tolérées).
    for (const i of bestIndexes(q, garesNorm, Math.max(0, 8 - results.length))) {
      const g = gares![i];
      results.push({ label: g[0], sub: `Gare · ligne ${fmtLine(g[3])}`, at: [g[1], g[2]], zoom: 15 });
    }
  }

  const choose = (r: SearchResult) => {
    if (r.pk) p.onPk(r.pk.code, r.pk.pk);
    else if (r.at) p.onGo(r.at, r.zoom ?? 15);
    else return;
    const next = [r, ...recents.filter((x) => x.label !== r.label || x.sub !== r.sub)].slice(0, 6);
    setRecents(next);
    saveRecents(next);
    setQ('');
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const showRecents = open && !q.trim() && recents.length > 0;

  return (
    <div className="search">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder="Gare, ligne, PK…"
        aria-label="Rechercher une gare ou une ligne"
        enterKeyHint="search"
      />
      {showRecents && (
        <ul className="results">
          <li className="results-head">
            <span>Récents</span>
            <button
              className="link-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setRecents([]);
                saveRecents([]);
              }}
            >
              Effacer
            </button>
          </li>
          {recents.map((r, i) => (
            <li key={`r-${i}`}>
              <button onClick={() => choose(r)}>
                <b>{r.label}</b>
                <small>{r.sub}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && results.length > 0 && (
        <ul className="results">
          {results.map((r, i) => (
            <li key={i}>
              <button disabled={!r.pk && !r.at} onClick={() => choose(r)}>
                <b>{r.label}</b>
                <small>{r.sub}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
