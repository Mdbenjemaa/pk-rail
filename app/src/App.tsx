import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FeatureCollection } from 'geojson';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { ActionBar } from './components/ActionBar';
import { AutourScreen, type AutourTab } from './components/AutourScreen';
import { Banner } from './components/Banner';
import { AroundCard, ErrorCard, HintCard, NextCard } from './components/Cards';
import { Icon } from './components/parts';
import { SearchScreen } from './components/SearchScreen';
import { Disclaimer, FeatureCard, FilterSheet, InfoSheet, MenuSheet, type ImportStatus } from './components/Sheets';
import type { LocateState, Theme } from './components/state';
import { TargetSheet, type Origin, type TargetState } from './components/TargetSheet';
import { InstallBanner } from './components/Install';
import { accesFeatures, loadAcces, readAccesSource, saveAcces, snapAcces, type AccesSet } from './lib/acces';
import { fmtLine, fmtPk } from './lib/format';
import { parsePk, pkRange, positionsAtPk } from './lib/pk';
import { dataUpdate, loadCell, loadLine, loadManifest, type Manifest } from './lib/data';
import type { LonLat } from './lib/geo';
import { acquire, follow, geoErrorMessage, type Acquisition, type Fix } from './lib/gps';
import { accesOnLine, aroundHere } from './lib/lineinfo';
import { PkFilter, type PkEstimate } from './lib/pkfilter';
import { keepScreenOn, type AwakeStatus } from './lib/wakelock';
import { DEFAULT_FILTERS, type FilterKey, type Filters } from './lib/layers';
import { cellsAround, matchInCells, pickFollowLine, pickLine, searchRadius, type LineCandidate } from './lib/locate';
import { loadPref, meFeatures, savePref } from './lib/me';
import { MapView, railSource, type FocusRequest } from './map/MapView';
import { PREVIEW } from './lib/env';
import type { Basemap } from './map/style';

type Panel = 'none' | 'filters' | 'info' | 'menu' | 'search' | 'autour';

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
  const [awake, setAwake] = useState<AwakeStatus | null>(null);
  const [me, setMe] = useState<FeatureCollection | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [picked, setPicked] = useState<{ f: MapGeoJSONFeature; at: LonLat } | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const [target, setTarget] = useState<TargetState | null>(null);
  const [targetExpanded, setTargetExpanded] = useState(false);
  const [acces, setAcces] = useState<AccesSet[]>(() => loadAcces());
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomZone = useRef<HTMLDivElement>(null);

  const acquisition = useRef<Acquisition | null>(null);
  const stopFollow = useRef<(() => void) | null>(null);
  const busy = useRef(false);
  const pendingFix = useRef<Fix | null>(null);
  const pkFilter = useRef(new PkFilter());
  const followLine = useRef<string | null>(null);
  const releaseAwake = useRef<(() => void) | null>(null);
  const lastFix = useRef<{ fix: Fix; mode: 'gps' | 'manuel' | 'suivi'; forced?: string } | null>(null);

  useEffect(() => {
    loadManifest().then((m) => {
      setManifest(m);
      if (dataUpdate.hadOffline) {
        // Données PK mises à jour : la carte repart des nouvelles tuiles.
        railSource.reset();
        setMapKey((k) => k + 1);
        showToast('Nouvelles données PK chargées.');
      }
    }, (e: Error) => setDataError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
      setMe(meFeatures(fix.lonlat, fix.accuracy, chosen?.point ?? null));
      if (recenter) focusOn(fix.lonlat, mode === 'suivi' ? undefined : 17);
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
      .then((fix) => analyse(fix, 'gps'))
      .catch((e) => setLoc({ phase: 'error', message: geoErrorMessage(e) }))
      .finally(() => {
        acquisition.current = null;
      });
  };

  const analyseRef = useRef(analyse);
  analyseRef.current = analyse;

  const stopFollowing = () => {
    stopFollow.current?.();
    stopFollow.current = null;
    pendingFix.current = null;
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
    acquisition.current?.cancel();
    stopFollowing();
    setFollowing(true);
    setPicked(null);
    pkFilter.current.reset();
    followLine.current = loc.phase === 'result' ? (loc.chosen?.code ?? null) : null;
    if (lastFix.current) focusOn(lastFix.current.fix.lonlat);
    releaseAwake.current = keepScreenOn(setAwake);
    // Les positions arrivent parfois plus vite que le calcul : on traite toujours la plus récente.
    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        while (pendingFix.current && stopFollow.current) {
          const fix = pendingFix.current;
          pendingFix.current = null;
          const chosen = await analyseRef.current(fix, 'suivi', lastFix.current?.forced, false, followLine.current);
          if (!stopFollow.current) break;
          followLine.current = chosen?.code ?? null;
          const est = chosen ? pkFilter.current.update(chosen.code, chosen.pk, fix.accuracy, fix.time) : null;
          setFollowPk(est);
          if (est && est.dir !== 0) setFollowDir(est.dir);
          setFollowAt(fix.lonlat);
        }
      } finally {
        busy.current = false;
      }
    };
    stopFollow.current = follow(
      (fix) => {
        pendingFix.current = fix;
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
    void analyse({ lonlat: at, accuracy: 5, samples: 1, time: Date.now() }, 'manuel');
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

  const res = loc.phase === 'result' ? loc : null;
  const chosen = res?.chosen ?? null;
  const chosenCode = chosen?.code ?? null;
  const herePk = chosen ? (following && followPk ? followPk.pk : chosen.pk) : null;
  const accesHere = useMemo(() => (chosenCode ? accesOnLine(acces, chosenCode) : []), [acces, chosenCode]);
  const around = res?.doc && herePk !== null ? aroundHere(res.doc, herePk, filters, typeFiltre, accesHere) : null;

  const origin: Origin | null = res && chosen ? { code: chosen.code, pk: chosen.pk, lonlat: res.fix.lonlat } : null;

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
      const items = await snapAcces(points);
      const name = title || (typeof src === 'string' ? 'Carte Google My Maps' : src.name.replace(/\.(kml|kmz|geojson|json)$/i, ''));
      const next = [...acces, { id: String(Date.now()), name, imported: Date.now(), items }];
      if (!saveAcces(next)) throw new Error('Le téléphone a refusé l’enregistrement (stockage plein ?).');
      setAcces(next);
      setFilters((f) => ({ ...f, acces: true }));
      const snapped = items.filter((a) => a.code).length;
      setImportStatus({ busy: false, text: `${items.length} accès importés, dont ${snapped} rattachés à une ligne avec leur PK.` });
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

  const showSet = (set: AccesSet) => {
    if (!set.items.length) return;
    const lon = set.items.reduce((a, x) => a + x.lonlat[0], 0) / set.items.length;
    const lat = set.items.reduce((a, x) => a + x.lonlat[1], 0) / set.items.length;
    setPanel('none');
    focusOn([lon, lat], 11);
  };

  const openAutour = (tab: AutourTab) => {
    setAutourTab(tab);
    setPanel('autour');
  };

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
        acces={acces}
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
        key={mapKey}
        basemap={basemap}
        night={night}
        filters={filters}
        me={me}
        target={targetFC}
        acces={accesFC}
        focus={focus}
        keepInView={following && !mapFree ? followAt : null}
        onUserMove={() => {
          if (stopFollow.current) setMapFree(true);
        }}
        onFeature={(f, at) => setPicked({ f, at })}
        onLongPress={(at) => placeHere(at)}
        onMapTap={() => setPicked(null)}
      />

      <div className={`top-zone ${bannerShown ? 'has-banner' : ''}`}>
        <Banner
          state={loc}
          manifest={manifest}
          following={following}
          followPk={followPk}
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
          onGo={(at, zoom) => showOnMap(at, zoom)}
          onPk={(code, pk) => void goToPk(code, pk)}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'autour' && res && herePk !== null && (
        <AutourScreen
          state={res}
          pk={herePk}
          manifest={manifest}
          filters={filters}
          acces={acces}
          typeFiltre={typeFiltre}
          onTypeFiltre={(k) => {
            setTypeFiltre(k);
            savePref('pkr-type-filtre', k);
          }}
          tab={autourTab}
          onTab={setAutourTab}
          onFocus={(at) => showOnMap(at)}
          onChoose={(code) => {
            if (lastFix.current) void analyse(lastFix.current.fix, lastFix.current.mode, code, false);
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
          acces={acces}
          importStatus={importStatus}
          onImport={(src) => void importAcces(src)}
          onDeleteSet={deleteSet}
          onShowSet={showSet}
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
          onClose={() => setPanel('none')}
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
