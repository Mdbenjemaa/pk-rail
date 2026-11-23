import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FeatureCollection } from 'geojson';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { ActionBar } from './components/ActionBar';
import { AutourScreen, type AutourTab } from './components/AutourScreen';
import { Banner } from './components/Banner';
import { AroundCard, ErrorCard, HintCard, NextCard } from './components/Cards';
import { Icon } from './components/parts';
import { SearchScreen } from './components/SearchScreen';
import { AccesSheet, Disclaimer, FeatureCard, FilterSheet, InfoSheet, MenuSheet, type ImportStatus } from './components/Sheets';
import type { LocateState, Theme } from './components/state';
import { TargetSheet, type Origin, type TargetState } from './components/TargetSheet';
import { InstallBanner } from './components/Install';
import { OrientButton } from './components/OrientButton';
import { SignalementSheet, SignalementsSheet, SignalerSheet } from './components/Signalements';
import {
  deleteSignalement,
  listSignalements,
  saveSignalement,
  shareSignalement,
  signalementFeatures,
  type Envoi,
  type Lieu,
  type Signalement,
} from './lib/signalements';
import { accesFeature, accesFeatures, findAccesAt, loadAcces, readAccesSource, saveAcces, snapAcces, type AccesSet } from './lib/acces';
import { setUpdateGate } from './lib/update';
import { setCourse, startCompass } from './lib/heading';
import { fmtLine, fmtPk } from './lib/format';
import { decodeGeom, parsePk, pkRange, positionsAtPk } from './lib/pk';
import { dataUpdate, keepAround, loadCell, loadLine, loadManifest, OFFLINE_MESSAGE, type Manifest } from './lib/data';
import { distance, type LonLat } from './lib/geo';
import { acquire, follow, geoErrorMessage, type Acquisition, type Fix } from './lib/gps';
import { accesOnLine, aroundHere } from './lib/lineinfo';
import { PkFilter, type PkEstimate } from './lib/pkfilter';
import { keepScreenOn, type AwakeStatus } from './lib/wakelock';
import { DEFAULT_FILTERS, type FilterKey, type Filters } from './lib/layers';
import { cellsAround, matchInCells, pickFollowLine, pickLine, searchRadius, type LineCandidate } from './lib/locate';
import { loadPref, meFeatures, savePref } from './lib/me';
import { MapView, type FocusRequest } from './map/MapView';
import { PREVIEW } from './lib/env';
import type { Basemap } from './map/style';

type Panel = 'none' | 'filters' | 'info' | 'menu' | 'search' | 'autour' | 'acces' | 'signaler' | 'signalements';

const darkQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null);

/** PK Rail : se repérer sur le réseau (ligne et PK), suivre le PK en direct, aller à un PK, voir ses accès. */
export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => ({ ...DEFAULT_FILTERS, ...loadPref<Partial<Filters>>('pkr-filters', {}) }));
  const [basemap, setBasemap] = useState<Basemap>(() => loadPref<Basemap>('pkr-basemap', 'plan'));
  const [theme, setTheme] = useState<Theme>(() => loadPref<Theme>('pkr-theme', 'auto'));
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? false);
  const [ack, setAck] = useState(() => loadPref('pkr-ack-v1', false));
  const [panel, setPanel] = useState<Panel>('none');
  const [autourTab, setAutourTab] = useState<AutourTab>('autour');
  const [loc, setLoc] = useState<LocateState>({ phase: 'idle' });
  const [typeFiltre, setTypeFiltre] = useState(() => loadPref<string>('pkr-type-filtre', 'tout'));
  const [following, setFollowing] = useState(false);
  const [followPk, setFollowPk] = useState<PkEstimate | null>(null);
  /** Dernier sens de marche connu (on le garde pendant les arrêts). */
  const [followDir, setFollowDir] = useState<1 | -1 | 0>(0);
  const [followAt, setFollowAt] = useState<LonLat | null>(null);
  const [mapFree, setMapFree] = useState(false);
  /** Carte tournée dans la direction du téléphone (bouton boussole). */
  const [orient, setOrient] = useState(false);
  /** Mes signalements (gardés sur le téléphone) et celui ouvert. */
  const [signals, setSignals] = useState<Signalement[]>([]);
  const [openSignal, setOpenSignal] = useState<Signalement | null>(null);
  useEffect(() => {
    void listSignalements().then(setSignals);
  }, []);
  const [awake, setAwake] = useState<AwakeStatus | null>(null);
  const [me, setMe] = useState<FeatureCollection | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [picked, setPicked] = useState<{ f: MapGeoJSONFeature; at: LonLat } | null>(null);
  const [target, setTarget] = useState<TargetState | null>(null);
  const [targetExpanded, setTargetExpanded] = useState(false);
  const [acces, setAcces] = useState<AccesSet[]>(() => loadAcces());
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Suivi : problème en cours (données de la zone indisponibles sans réseau…). */
  const [followIssue, setFollowIssue] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomZone = useRef<HTMLDivElement>(null);

  const acquisition = useRef<Acquisition | null>(null);
  const stopFollow = useRef<(() => void) | null>(null);
  /** Numéro du suivi en cours : un calcul lancé par un suivi arrêté entre-temps est ignoré. */
  const followGen = useRef(0);
  const pkFilter = useRef(new PkFilter());
  /** Dernier endroit autour duquel les données ont été gardées sur le téléphone (et si c'est fini). */
  const kept = useRef<{ at: LonLat; time: number; ok: boolean } | null>(null);
  const followLine = useRef<string | null>(null);
  const releaseAwake = useRef<(() => void) | null>(null);
  const lastFix = useRef<{ fix: Fix; mode: 'gps' | 'manuel' | 'suivi'; forced?: string } | null>(null);

  useEffect(() => {
    let done = false;
    const load = () =>
      loadManifest().then(
        (m) => {
          if (done) return;
          done = true;
          setManifest(m);
          setDataError(null);
          if (dataUpdate.changed) showToast('Nouvelles données PK chargées.');
          void resnapAcces(m);
        },
        (e: Error) =>
          setDataError(
            e.message === OFFLINE_MESSAGE
              ? 'pas de réseau, et les données PK ne sont pas encore sur ce téléphone. Ouvre l’appli une première fois avec du réseau.'
              : e.message,
          ),
      );
    void load();
    // Réseau revenu : on réessaie.
    const retry = () => {
      if (!done) void load();
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Accès importés avec une autre version des données (ou sans réseau) : on recalcule leur ligne et leur PK,
   * pour qu'ils restent justes quand les PK sont recalés.
   */
  const resnapAcces = async (m: Manifest) => {
    for (const set of loadAcces()) {
      if (set.v === m.version || !set.items.length) continue;
      try {
        const { items, complete, version } = await snapAcces(set.items);
        if (!complete) continue;
        setAcces((cur) => {
          const next = cur.map((s) => (s.id === set.id ? { ...s, items, v: version } : s));
          saveAcces(next);
          return next;
        });
      } catch {
        /* pas de réseau : ce sera pour la prochaine ouverture */
      }
    }
  };
  useEffect(() => savePref('pkr-filters', filters), [filters]);
  useEffect(() => savePref('pkr-basemap', basemap), [basemap]);
  useEffect(() => savePref('pkr-theme', theme), [theme]);

  // Mode nuit : choisi dans le menu, ou en « Auto » selon le mode sombre du téléphone.
  useEffect(() => {
    const mq = darkQuery();
    if (!mq) return;
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const night = theme === 'nuit' || (theme === 'auto' && systemDark);
  useEffect(() => {
    document.documentElement.classList.toggle('night', night);
  }, [night]);

  // Hauteur du bas de l'écran (fiche + barre) : pour placer l'échelle de la carte et le bandeau d'installation au-dessus.
  useEffect(() => {
    const el = bottomZone.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--bz', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const focusOn = useCallback((center: LonLat, zoom?: number) => setFocus((f) => ({ center, zoom, seq: (f?.seq ?? 0) + 1 })), []);

  /** Rattache une position aux lignes proches et prépare l'affichage. */
  const analyse = useCallback(
    async (fix: Fix, mode: 'gps' | 'manuel' | 'suivi', forcedCode?: string, recenter = true, prefer?: string | null): Promise<LineCandidate | null> => {
      const m = manifest ?? (await loadManifest());
      if (!manifest) {
        setManifest(m);
        setDataError(null);
      }
      lastFix.current = { fix, mode, forced: forcedCode };
      const radius = searchRadius(fix.accuracy);
      const known = new Set(m.cells);
      const cells = (
        await Promise.all(cellsAround(fix.lonlat, radius, m.cellsPerDegree).map((k) => loadCell(k, known)))
      ).filter((c) => c !== null);
      const match = matchInCells(cells, fix.lonlat, radius);
      const chosen =
        (forcedCode && match.lines.find((l) => l.code === forcedCode)) ||
        (mode === 'suivi' ? pickFollowLine(match.lines, prefer, fix.accuracy) : pickLine(match.lines));
      const doc = chosen ? await loadLine(chosen.code).catch(() => null) : null;
      setLoc({ phase: 'result', fix, mode, radius, match, chosen: chosen ?? null, doc });
      setMe(meFeatures(fix.lonlat, fix.accuracy, chosen?.point ?? null, mode !== 'manuel'));
      if (recenter) focusOn(fix.lonlat, mode === 'suivi' ? undefined : 17);
      // Données autour gardées sur le téléphone (une fois tous les 3 km, ou une minute après un échec) :
      // la suite marche sans réseau.
      const k = kept.current;
      if (!k || distance(k.at, fix.lonlat) > 3000 || (!k.ok && Date.now() - k.time > 60_000)) {
        const entry = { at: fix.lonlat, time: Date.now(), ok: false };
        kept.current = entry;
        const near = matchInCells(cells, fix.lonlat, 2500).lines.map((l) => l.code);
        setTimeout(() => {
          keepAround(fix.lonlat, near).then(
            (ok) => (entry.ok = ok),
            () => undefined,
          );
        }, 1500);
      }
      return chosen ?? null;
    },
    [manifest, focusOn],
  );

  const showToast = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  const gpsBlocked = () =>
    showToast('Le GPS est bloqué dans cet aperçu. Cherche une gare, puis appuie longuement sur la carte à côté des voies : l’appli calcule le PK de ce point.');

  const locate = () => {
    if (PREVIEW) return gpsBlocked();
    startCompass();
    stopFollowing();
    setPicked(null);
    setTarget(null);
    setLoc({ phase: 'acquiring', fix: null, elapsed: 0 });
    const acq = acquire((fix, elapsed) => {
      setLoc({ phase: 'acquiring', fix, elapsed });
      setMe(meFeatures(fix.lonlat, fix.accuracy, null));
    });
    acquisition.current = acq;
    acq.promise
      .then((fix) => {
        // Le réseau peut être lent : on dit que le PK est en calcul.
        setLoc({ phase: 'acquiring', fix, elapsed: 0, computing: true });
        return analyse(fix, 'gps');
      })
      .catch((e) => setLoc({ phase: 'error', message: geoErrorMessage(e) }))
      .finally(() => {
        acquisition.current = null;
      });
  };

  const analyseRef = useRef(analyse);
  analyseRef.current = analyse;

  const stopFollowing = () => {
    followGen.current++;
    stopFollow.current?.();
    stopFollow.current = null;
    setFollowIssue(null);
    releaseAwake.current?.();
    releaseAwake.current = null;
    followLine.current = null;
    setFollowing(false);
    setFollowPk(null);
    setFollowDir(0);
    setFollowAt(null);
    setMapFree(false);
    setAwake(null);
  };

  /**
   * Suivi en direct : chaque position GPS est rattachée à la ligne en cours, le PK est lissé
   * puis affiché au mètre. La carte reste libre ; elle ne bouge que si le point va sortir de l'écran.
   */
  const startFollowing = () => {
    if (PREVIEW) return gpsBlocked();
    if (!('geolocation' in navigator)) return showToast('Ce téléphone ne donne pas accès au GPS.');
    startCompass();
    acquisition.current?.cancel();
    stopFollowing();
    setFollowing(true);
    setPicked(null);
    pkFilter.current.reset();
    followLine.current = loc.phase === 'result' ? (loc.chosen?.code ?? null) : null;
    if (lastFix.current) focusOn(lastFix.current.fix.lonlat);
    releaseAwake.current = keepScreenOn(setAwake);
    const gen = followGen.current;
    const alive = () => gen === followGen.current;
    // Les positions arrivent parfois plus vite que le calcul : on traite toujours la plus récente.
    let pending: Fix | null = null;
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        while (pending && alive()) {
          const fix: Fix = pending;
          pending = null;
          try {
            const chosen = await analyseRef.current(fix, 'suivi', lastFix.current?.forced, false, followLine.current);
            if (!alive()) break;
            followLine.current = chosen?.code ?? null;
            const est = chosen ? pkFilter.current.update(chosen.code, chosen.pk, fix.accuracy, fix.time) : null;
            setFollowPk(est);
            if (est && est.dir !== 0) setFollowDir(est.dir);
            setFollowIssue(null);
          } catch (e) {
            // Zone pas encore sur le téléphone et pas de réseau : on montre la position, le PK attend.
            if (!alive()) break;
            setFollowIssue(e instanceof Error ? e.message : 'Données indisponibles ici.');
            setMe(meFeatures(fix.lonlat, fix.accuracy, null));
          }
          setFollowAt(fix.lonlat);
        }
      } finally {
        running = false;
      }
    };
    stopFollow.current = follow(
      (fix) => {
        if (!alive()) return;
        setCourse(fix.course, fix.speed);
        pending = fix;
        void run();
      },
      (e) => {
        // Tunnel, tranchée : le GPS se tait un moment, le suivi continue. Seul un refus l'arrête.
        if (e.code === e.PERMISSION_DENIED) {
          setLoc({ phase: 'error', message: geoErrorMessage(e) });
          stopFollowing();
        }
      },
    );
  };

  const recenter = () => {
    setMapFree(false);
    const at = followAt ?? lastFix.current?.fix.lonlat;
    if (at) focusOn(at);
  };

  const placeHere = (at: LonLat) => {
    stopFollowing();
    setPicked(null);
    setTarget(null);
    const now = Date.now();
    analyse({ lonlat: at, accuracy: 5, samples: 1, time: now, received: now }, 'manuel').catch((e: Error) =>
      setLoc({ phase: 'error', message: e.message }),
    );
  };

  const closeLocate = () => {
    acquisition.current?.cancel();
    stopFollowing();
    setLoc({ phase: 'idle' });
    setMe(null);
    lastFix.current = null;
  };

  const toggleFilter = (k: FilterKey) => setFilters((f) => ({ ...f, [k]: !f[k] }));

  /** Va voir un élément sur la carte (pendant le suivi, la carte devient libre jusqu'à « Recentrer »). */
  const showOnMap = (at: LonLat, zoom = 17) => {
    setPanel('none');
    if (following) setMapFree(true);
    focusOn(at, zoom);
  };

  /** « Aller au PK » : position du PK sur la ligne, distance depuis ma position, accès proches. */
  const goToPk = async (code: string, input: number | string) => {
    const pk = typeof input === 'number' ? input : parsePk(input);
    if (pk === null) return showToast('PK non reconnu : écris par exemple 45,2 ou 45+200.');
    try {
      const doc = await loadLine(code);
      const positions = positionsAtPk(doc, pk);
      if (!positions.length) {
        const [lo, hi] = pkRange(doc);
        return showToast(`Le PK ${fmtPk(pk)} n’est pas sur la ligne ${fmtLine(code)} (PK ${fmtPk(lo)} à ${fmtPk(hi)}).`);
      }
      setPicked(null);
      setPanel('none');
      setTargetExpanded(false);
      setTarget({ code, pk, doc, positions, idx: 0, dest: { name: `PK ${fmtPk(pk)}`, lonlat: positions[0].lonlat } });
      focusOn(positions[0].lonlat, 15);
    } catch {
      showToast('Ligne indisponible pour le moment (pas de réseau ?).');
    }
  };

  /** Une ligne cherchée par son numéro : on la montre en entier. */
  const showLine = async (code: string) => {
    try {
      const doc = await loadLine(code);
      let w = Infinity;
      let s = Infinity;
      let e = -Infinity;
      let n = -Infinity;
      for (const t of doc.troncons) {
        for (const [lon, lat] of t.g ? decodeGeom(t.g) : []) {
          w = Math.min(w, lon);
          e = Math.max(e, lon);
          s = Math.min(s, lat);
          n = Math.max(n, lat);
        }
      }
      if (!Number.isFinite(w)) return showToast(`Tracé de la ligne ${fmtLine(code)} indisponible.`);
      setPanel('none');
      if (following) setMapFree(true);
      setFocus((f) => ({ center: [(w + e) / 2, (s + n) / 2], bounds: [[w, s], [e, n]], seq: (f?.seq ?? 0) + 1 }));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Ligne indisponible.');
    }
  };

  const res = loc.phase === 'result' ? loc : null;
  const chosen = res?.chosen ?? null;
  const chosenCode = chosen?.code ?? null;
  const herePk = chosen ? (following && followPk ? followPk.pk : chosen.pk) : null;
  /** Listes d'accès activées : les seules affichées sur la carte, dans les recherches et autour du PK. */
  const accesOn = useMemo(() => acces.filter((s) => !s.hidden), [acces]);
  const accesHere = useMemo(() => (chosenCode ? accesOnLine(accesOn, chosenCode) : []), [accesOn, chosenCode]);
  const resDoc = res?.doc ?? null;
  const around = useMemo(
    () => (resDoc && herePk !== null ? aroundHere(resDoc, herePk, filters, typeFiltre, accesHere) : null),
    [resDoc, herePk, filters, typeFiltre, accesHere],
  );

  const origin: Origin | null = res && chosen ? { code: chosen.code, pk: chosen.pk, lonlat: res.fix.lonlat } : null;

  /** Où l'on est, pour un signalement : ligne, PK (celui du suivi s'il tourne), voie la plus proche. */
  const lieu: Lieu | null = res
    ? {
        lonlat: res.fix.lonlat,
        accuracy: res.fix.accuracy,
        manuel: res.mode === 'manuel',
        code: chosen?.code,
        pk: chosen ? Math.round((herePk ?? chosen.pk) * 1000) / 1000 : undefined,
        ligne: (chosen && manifest?.lines[chosen.code]?.n) || undefined,
        voie: chosen ? res.match.tracks.find((t) => t.code === chosen.code && t.name)?.name : undefined,
      }
    : null;
  const signalFC = useMemo(() => signalementFeatures(signals), [signals]);

  const envoiToast = (r: Envoi) =>
    showToast(
      r === 'copie'
        ? 'Partage indisponible ici : le texte du signalement est copié, colle-le dans un message.'
        : r === 'annule'
          ? 'Signalement enregistré sur le téléphone, pas envoyé.'
          : 'Signalement envoyé.',
    );

  /** Envoi par le partage du téléphone (appelé directement dans le toucher : sinon le téléphone refuse). */
  const sendSignal = (s: Signalement) => {
    const sending = shareSignalement(s);
    void sending.then(async (r) => {
      envoiToast(r);
      if (r === 'annule') return;
      const done = { ...s, sent: Date.now() };
      await saveSignalement(done).catch(() => undefined);
      setSignals((cur) => cur.map((x) => (x.id === s.id ? done : x)));
      setOpenSignal((o) => (o && o.id === s.id ? done : o));
    });
  };

  const newSignal = async (draft: Omit<Signalement, 'id' | 'created'>, send: boolean) => {
    const s: Signalement = { ...draft, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: Date.now() };
    if (send) sendSignal(s);
    await saveSignalement(s);
    setSignals((cur) => [s, ...cur.filter((x) => x.id !== s.id)]);
    setFilters((f) => ({ ...f, signalements: true }));
    setPanel('none');
    if (!send) showToast('Signalement enregistré sur le téléphone.');
  };

  const openSignaler = () => {
    setPanel('signaler');
    if (loc.phase === 'idle' || loc.phase === 'error') locate();
  };

  const targetFC = useMemo<FeatureCollection | null>(() => {
    if (!target) return null;
    const at = target.positions[target.idx].lonlat;
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { label: `PK ${fmtPk(target.pk)}`, n: `PK ${fmtPk(target.pk)}`, c: target.code }, geometry: { type: 'Point', coordinates: at } }],
    };
  }, [target]);
  const accesFC = useMemo(() => accesFeatures(acces), [acces]);

  /** « Mes accès » : fichier KML/KMZ/GeoJSON ou lien Google My Maps ; gardés sur ce téléphone. */
  const importAcces = async (src: File | string) => {
    setImportStatus({ busy: true, text: '' });
    try {
      const { title, points } = await readAccesSource(src);
      if (!points.length) throw new Error('Aucun point trouvé dans ce fichier.');
      const { items, complete, version } = await snapAcces(points);
      const name = title || (typeof src === 'string' ? 'Carte Google My Maps' : src.name.replace(/\.(kml|kmz|geojson|json)$/i, ''));
      const set: AccesSet = { id: String(Date.now()), name, imported: Date.now(), items, v: complete ? version : undefined };
      const next = [...acces, set];
      if (!saveAcces(next)) throw new Error('Le téléphone a refusé l’enregistrement (stockage plein ?).');
      setAcces(next);
      setFilters((f) => ({ ...f, acces: true }));
      const snapped = items.filter((a) => a.code).length;
      setImportStatus({
        busy: false,
        text:
          `${items.length} accès importés, dont ${snapped} rattachés à une ligne avec leur PK.` +
          (complete ? '' : ' Sans réseau, certains n’ont pas encore leur PK : il sera calculé au prochain lancement avec du réseau.'),
      });
    } catch (e) {
      setImportStatus({ busy: false, error: true, text: e instanceof Error ? e.message : 'Import impossible.' });
    }
  };

  const deleteSet = (id: string) => {
    const next = acces.filter((s) => s.id !== id);
    saveAcces(next);
    setAcces(next);
    setImportStatus(null);
  };

  /** Active ou désactive une liste d'accès (gardé sur le téléphone). */
  const toggleSet = (id: string) => {
    const next = acces.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s));
    saveAcces(next);
    setAcces(next);
  };

  const showSet = (set: AccesSet) => {
    if (!set.items.length) return;
    const lon = set.items.reduce((a, x) => a + x.lonlat[0], 0) / set.items.length;
    const lat = set.items.reduce((a, x) => a + x.lonlat[1], 0) / set.items.length;
    setPanel('none');
    focusOn([lon, lat], 11);
  };

  /** Un de mes accès trouvé dans la recherche : on le montre sur la carte avec sa fiche. */
  const openAcces = (at: LonLat) => {
    const hit = findAccesAt(acces, at);
    // Accès d'une liste désactivée (vu dans « Mes accès ») : on réactive sa liste pour qu'il apparaisse.
    if (hit?.set.hidden) toggleSet(hit.set.id);
    setPanel('none');
    setFilters((f) => (f.acces ? f : { ...f, acces: true }));
    if (hit) setPicked({ f: { ...accesFeature(hit.a, hit.set.name), layer: { id: 'u-acces' } } as unknown as MapGeoJSONFeature, at });
    if (following) setMapFree(true);
    focusOn(at, 17);
  };

  const openAutour = (tab: AutourTab) => {
    setAutourTab(tab);
    setPanel('autour');
  };

  // Nouvelle version de l'appli : rechargement seulement au repos (jamais pendant un suivi ou un repérage).
  const updateBusy = following || loc.phase === 'acquiring' || !!importStatus?.busy;
  const updateIdle = panel === 'none' && !target && !picked && (loc.phase === 'idle' || loc.phase === 'error');
  useEffect(() => setUpdateGate({ busy: updateBusy, idle: updateIdle }), [updateBusy, updateIdle]);

  // Le bandeau du haut, et la fiche du bas selon la situation.
  const bannerShown = following || loc.phase === 'acquiring' || loc.phase === 'result';
  const bannerHasMenu = bannerShown && !following;
  let card: ReactNode = null;
  if (picked && loc.phase !== 'acquiring') {
    card = <FeatureCard feature={picked.f} at={picked.at} manifest={manifest} onPlaceHere={placeHere} onClose={() => setPicked(null)} />;
  } else if (target) {
    card = (
      <TargetSheet
        target={target}
        origin={origin}
        acces={accesOn}
        filters={filters}
        expanded={targetExpanded}
        onToggleExpand={() => setTargetExpanded((e) => !e)}
        onPosition={(idx) => setTarget((t) => t && { ...t, idx, dest: { name: `PK ${fmtPk(t.pk)}`, lonlat: t.positions[idx].lonlat } })}
        onDest={(dest) => setTarget((t) => t && { ...t, dest })}
        onFocus={(at) => focusOn(at, 16)}
        onClose={() => setTarget(null)}
      />
    );
  } else if (loc.phase === 'error') {
    card = <ErrorCard message={loc.message} onClose={closeLocate} />;
  } else if (around && following) {
    card = <NextCard around={around} dir={followDir} onFocus={(at) => showOnMap(at)} onAll={() => openAutour('autour')} />;
  } else if (around) {
    card = <AroundCard around={around} onFocus={(at) => showOnMap(at)} onAll={() => openAutour('autour')} />;
  } else if (loc.phase === 'idle' && !following) {
    card = (
      <HintCard
        text={
          PREVIEW
            ? 'Aperçu sans GPS : appui long sur la carte, près des voies = me placer ici.'
            : 'Appuie sur « Me repérer » pour voir ta ligne et ton PK, ou fais un appui long sur la carte près des voies.'
        }
      />
    );
  }

  return (
    <div className="app">
      <MapView
        basemap={basemap}
        night={night}
        filters={filters}
        me={me}
        target={targetFC}
        acces={accesFC}
        focus={focus}
        keepInView={following && !mapFree ? followAt : null}
        orient={orient && !!me}
        signal={signalFC}
        onUserMove={() => {
          if (stopFollow.current) setMapFree(true);
        }}
        onFeature={(f, at) => {
          if (f.layer.id === 'u-signal') {
            const s = signals.find((x) => x.id === f.properties?.id);
            if (s) return setOpenSignal(s);
          }
          setPicked({ f, at });
        }}
        onLongPress={(at) => placeHere(at)}
        onMapTap={() => setPicked(null)}
      />

      <div className={`top-zone ${bannerShown ? 'has-banner' : ''}`}>
        <Banner
          state={loc}
          manifest={manifest}
          following={following}
          followPk={followPk}
          followIssue={followIssue}
          awake={awake}
          onMenu={() => setPanel('menu')}
          onDetails={() => openAutour('ligne')}
          onUseFix={() => acquisition.current?.cancel()}
        />
        {dataError && <div className="toast error">Données indisponibles : {dataError}</div>}
        {toast && (
          <div className="toast" role="status" onClick={() => setToast(null)}>
            {toast}
          </div>
        )}
        <div className="tools-row">
          {me ? <OrientButton orient={orient} onToggle={setOrient} /> : <span />}
        <div className="map-tools">
          {!bannerHasMenu && (
            <button className="tool-btn round" onClick={() => setPanel('menu')} aria-label="Menu : affichage jour ou nuit, installer, à propos">
              <Icon name="dots" size={22} />
            </button>
          )}
          <button className="tool-btn" onClick={() => setPanel('filters')} aria-label="Couches et fond de carte">
            <Icon name="layers" />
            <span>Couches</span>
          </button>
          <button className="tool-btn" onClick={() => setPanel('acces')} aria-label="Mes accès : afficher, chercher, importer">
            <Icon name="door" />
            <span>Accès</span>
          </button>
          <button className="tool-btn" onClick={openSignaler} aria-label="Signaler une anomalie ici">
            <Icon name="alert" />
            <span>Signaler</span>
          </button>
        </div>
        </div>
      </div>

      <div className="bottom-zone" ref={bottomZone}>
        {card}
        <ActionBar
          following={following}
          acquiring={loc.phase === 'acquiring'}
          mapFree={mapFree}
          onSearch={() => setPanel('search')}
          onFollow={startFollowing}
          onLocate={locate}
          onRecenter={recenter}
          onStop={stopFollowing}
        />
      </div>

      {panel === 'search' && (
        <SearchScreen
          manifest={manifest}
          currentLine={chosenCode}
          acces={accesOn}
          onGo={(at, zoom) => showOnMap(at, zoom)}
          onLine={(code) => void showLine(code)}
          onPk={(code, pk) => void goToPk(code, pk)}
          onAcces={openAcces}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'autour' && res && herePk !== null && (
        <AutourScreen
          state={res}
          pk={herePk}
          manifest={manifest}
          filters={filters}
          acces={accesOn}
          typeFiltre={typeFiltre}
          onTypeFiltre={(k) => {
            setTypeFiltre(k);
            savePref('pkr-type-filtre', k);
          }}
          tab={autourTab}
          onTab={setAutourTab}
          onFocus={(at) => showOnMap(at)}
          onChoose={(code) => {
            if (lastFix.current) analyse(lastFix.current.fix, lastFix.current.mode, code, false).catch((e: Error) => showToast(e.message));
          }}
          onGoPk={(code, text) => void goToPk(code, text)}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'filters' && (
        <FilterSheet
          filters={filters}
          basemap={basemap}
          onToggle={toggleFilter}
          onBasemap={setBasemap}
          onOpenAcces={() => setPanel('acces')}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'acces' && (
        <AccesSheet
          sets={acces}
          shown={filters.acces}
          onToggleShown={() => toggleFilter('acces')}
          status={importStatus}
          onImport={(src) => void importAcces(src)}
          onDeleteSet={deleteSet}
          onShowSet={showSet}
          onToggleSet={toggleSet}
          onPick={openAcces}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'menu' && (
        <MenuSheet
          theme={theme}
          onTheme={setTheme}
          located={loc.phase === 'result'}
          onClear={() => {
            closeLocate();
            setPanel('none');
          }}
          onInfo={() => setPanel('info')}
          signalements={signals.length}
          onSignalements={() => setPanel('signalements')}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'signaler' && (
        <SignalerSheet
          lieu={lieu}
          locating={loc.phase === 'acquiring'}
          onLocate={locate}
          onSave={newSignal}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'signalements' && (
        <SignalementsSheet
          list={signals}
          onOpen={(s) => {
            setPanel('none');
            setOpenSignal(s);
          }}
          onNew={openSignaler}
          onClose={() => setPanel('none')}
        />
      )}
      {openSignal && (
        <SignalementSheet
          s={openSignal}
          onSend={() => sendSignal(openSignal)}
          onShow={() => {
            showOnMap(openSignal.lonlat, 17);
            setOpenSignal(null);
          }}
          onDelete={() => {
            if (!window.confirm('Supprimer ce signalement du téléphone ? Les photos seront effacées.')) return;
            const id = openSignal.id;
            void deleteSignalement(id).then(() => setSignals((cur) => cur.filter((x) => x.id !== id)));
            setOpenSignal(null);
          }}
          onClose={() => setOpenSignal(null)}
        />
      )}
      {panel === 'info' && <InfoSheet manifest={manifest} onClose={() => setPanel('none')} />}
      {ack && !PREVIEW && panel === 'none' && !following && <InstallBanner />}
      {!ack && (
        <Disclaimer
          onAccept={() => {
            savePref('pkr-ack-v1', true);
            setAck(true);
          }}
        />
      )}
    </div>
  );
}
