import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { captureInstallPrompt } from './lib/install';

captureInstallPrompt();

// Mise à jour de l'appli : dès qu'une nouvelle version est publiée, elle s'installe et la page se recharge.
// On vérifie à l'ouverture, au retour dans l'appli et toutes les 30 minutes.
registerSW({
  immediate: true,
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
