import { useEffect, useMemo, useState } from 'react';
import { loadGares, type GareEntry, type Manifest } from '../lib/data';
import { fmtLine, fmtPk } from '../lib/format';
import type { LonLat } from '../lib/geo';
import { parsePk, parsePkQuery } from '../lib/pk';
import { bestIndexes, normName } from '../lib/search';
import { Icon, type IconName } from './parts';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

function iconFor(r: SearchResult): IconName {
  if (r.pk) return 'pin';
  if (r.label.startsWith('Ligne ')) return 'line';
  return 'train';
}

function ResultRow({ r, icon, onChoose }: { r: SearchResult; icon?: IconName; onChoose: (r: SearchResult) => void }) {
  return (
    <li>
      <button className="result" disabled={!r.pk && !r.at} onClick={() => onChoose(r)}>
        <span className="result-ico">
          <Icon name={icon ?? iconFor(r)} size={22} />
        </span>
        <span className="result-main">
          <b>{r.label}</b>
          <small>{r.sub}</small>
        </span>
      </button>
    </li>
  );
}

/** Écran « Rechercher » : une gare, une ligne, ou un PK (sur ta ligne, ou « 830000 45+200 »). */
export function SearchScreen(p: {
  manifest: Manifest | null;
  /** Ligne où l'on se trouve : un PK tapé seul s'y rapporte. */
  currentLine: string | null;
  onGo: (at: LonLat, zoom: number) => void;
  onPk: (code: string, pk: number) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [gares, setGares] = useState<GareEntry[] | null>(null);
  const [recents, setRecents] = useState<SearchResult[]>(() => loadRecents());
  // Noms de gares préparés une fois (accents, « Saint » → « St ») pour chercher vite à chaque lettre.
  const garesNorm = useMemo(() => (gares ?? []).map((g) => normName(g[0])), [gares]);

  useEffect(() => {
    loadGares()
      .then(setGares)
      .catch(() => setGares([]));
  }, []);

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
        label: `Aller au PK ${fmtPk(alonePk)} · ligne ${fmtLine(p.currentLine)}`,
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
  };
  const empty = !q.trim();

  return (
    <div className="screen" role="dialog" aria-label="Rechercher">
      <header className="screen-head search-head">
        <button className="round-btn" onClick={p.onClose} aria-label="Retour à la carte">
          <Icon name="back" />
        </button>
        <input
          className="search-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Gare, ligne ou PK"
          aria-label="Rechercher une gare, une ligne ou un PK"
          enterKeyHint="search"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) choose(results[0]);
          }}
        />
        {!empty && (
          <button className="round-btn" onClick={() => setQ('')} aria-label="Effacer">
            <Icon name="close" size={20} />
          </button>
        )}
      </header>
      <div className="screen-body">
        {empty && (
          <div className="search-tips">
            <b>Tu peux taper</b>
            <span>
              <Icon name="train" size={18} /> une gare : Lieusaint
            </span>
            <span>
              <Icon name="pin" size={18} /> un PK sur ta ligne : 30+100{!p.currentLine && ' (repère-toi d’abord)'}
            </span>
            <span>
              <Icon name="line" size={18} /> une ligne et un PK : 830000 45+200
            </span>
          </div>
        )}
        {empty && recents.length > 0 && (
          <>
            <div className="results-head">
              <span>Récents</span>
              <button
                className="link-btn"
                onClick={() => {
                  setRecents([]);
                  saveRecents([]);
                }}
              >
                Effacer
              </button>
            </div>
            <ul className="results-list">
              {recents.map((r, i) => (
                <ResultRow key={`r-${i}`} r={r} icon="history" onChoose={choose} />
              ))}
            </ul>
          </>
        )}
        {results.length > 0 && (
          <ul className="results-list">
            {results.map((r, i) => (
              <ResultRow key={i} r={r} onChoose={choose} />
            ))}
          </ul>
        )}
        {!empty && nq.length >= 2 && results.length === 0 && gares && <p className="muted center">Rien trouvé pour « {q.trim()} ».</p>}
      </div>
    </div>
  );
}
