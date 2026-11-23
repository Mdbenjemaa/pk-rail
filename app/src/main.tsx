import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { captureInstallPrompt } from './lib/install';
import { updateReady } from './lib/update';

captureInstallPrompt();

// Mise à jour de l'appli : dès qu'une nouvelle version est publiée, elle s'installe ; la page se recharge
// quand elle est au repos (jamais pendant un suivi du PK). On vérifie à l'ouverture, au retour et toutes les 30 min.
registerSW({
  immediate: true,
  onNeedReload: updateReady,
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    const check = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void reg.update().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', check);
    setInterval(check, 30 * 60 * 1000);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
