import { useEffect, useState } from 'react';
import { installMode, onInstallChange, promptInstall, type InstallMode } from '../lib/install';

const DISMISS_KEY = 'pkr-install-plus-tard';

/** Icône « Partager » de Safari (carré avec flèche vers le haut). */
const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-label="Partager" className="share-ico">
    <path d="M12 3v12M8 7l4-4 4 4M6 11H5v9h14v-9h-1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function useInstallMode(): InstallMode {
  const [mode, setMode] = useState<InstallMode>(() => installMode());
  useEffect(() => onInstallChange(() => setMode(installMode())), []);
  return mode;
}

/** Explication adaptée au téléphone et au navigateur. */
export function InstallSteps({ mode, onInstalled }: { mode: InstallMode; onInstalled?: () => void }) {
  const [busy, setBusy] = useState(false);
  if (mode === 'installed') return <p className="ok small">PK Rail est installée sur cet appareil.</p>;
  if (mode === 'prompt') {
    return (
      <button className="btn primary wide" disabled={busy} onClick={async () => {
        setBusy(true);
        const ok = await promptInstall();
        setBusy(false);
        if (ok) onInstalled?.();
      }}>
        Installer PK Rail
      </button>
    );
  }
  if (mode === 'ios-safari') {
    return (
      <ol className="install-steps">
        <li>Touche <ShareIcon /> <b>Partager</b> en bas de l’écran (sur les iPhone récents : d’abord <b>···</b> en bas à droite ; sur iPad : en haut).</li>
        <li>Fais défiler et touche <b>« Sur l’écran d’accueil »</b>.</li>
        <li>Touche <b>Ajouter</b> : l’icône PK Rail apparaît avec tes applis.</li>
      </ol>
    );
  }
  if (mode === 'ios-other') {
    return (
      <ol className="install-steps">
        <li>Touche <ShareIcon /> <b>Partager</b> (dans la barre d’adresse ou le menu du navigateur).</li>
        <li>Touche <b>« Ajouter à l’écran d’accueil »</b>.</li>
        <li>Si cette ligne n’apparaît pas, ouvre cette adresse dans <b>Safari</b> et recommence.</li>
      </ol>
    );
  }
  if (mode === 'android-menu') {
    return (
      <ol className="install-steps">
        <li>Ouvre le menu du navigateur <b>⋮</b> (en haut à droite).</li>
        <li>Touche <b>« Installer l’application »</b> ou <b>« Ajouter à l’écran d’accueil »</b>.</li>
      </ol>
    );
  }
  return (
    <p className="small">
      Dans Chrome ou Edge, clique sur l’icône d’installation à droite de la barre d’adresse, ou menu ⋮ ›
      « Installer PK Rail ». Sur téléphone, ouvre cette adresse dans le navigateur pour l’ajouter à l’écran d’accueil.
    </p>
  );
}

/** Bandeau proposé une fois (puis toutes les deux semaines si « Plus tard »), tant que l'appli n'est pas installée. */
export function InstallBanner() {
  const mode = useInstallMode();
  const [hidden, setHidden] = useState(() => {
    try {
      const t = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      return Date.now() - t < 14 * 86400e3;
    } catch {
      return false;
    }
  });
  if (hidden || mode === 'installed' || mode === 'desktop-menu') return null;
  const later = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* rien */
    }
    setHidden(true);
  };
  return (
    <section className="install-banner" role="dialog" aria-label="Installer l’appli">
      <div className="install-head">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={44} height={44} />
        <div>
          <b>Installe PK Rail</b>
          <small>Une icône sur ton écran d’accueil, l’appli en plein écran, et elle marche sans réseau.</small>
        </div>
        <button className="icon-btn" onClick={later} aria-label="Plus tard">×</button>
      </div>
      <InstallSteps mode={mode} onInstalled={() => setHidden(true)} />
      {mode !== 'prompt' && <button className="link-btn" onClick={later}>Plus tard</button>}
    </section>
  );
}
