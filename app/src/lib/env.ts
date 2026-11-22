/**
 * Version « aperçu » publiée comme page claude.ai : pas de GPS, pas de service worker,
 * pas de fond de carte distant. Les données sont regroupées en paquets.
 * Activée à la construction par VITE_PREVIEW=1 (npm run build:preview).
 */
export const PREVIEW = import.meta.env.VITE_PREVIEW === '1';
