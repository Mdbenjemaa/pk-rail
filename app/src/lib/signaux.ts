/**
 * Dessins de la signalisation du réseau ferré national :
 * bibliothèque « signalisation-rfn-svg » de Nicolas Wurtz, sous licence GPL-3.0.
 * Planche réduite aux dessins utilisés : scripts/build_signal_assets.py.
 */
import { PREVIEW } from './env';

const BASE = new URL(`${import.meta.env.BASE_URL}signaux/`, location.href).href;

/** Planche MapLibre (rfn.json / rfn.png / rfn@2x.*) : images « rfn:<NOM> ». */
export const RFN_SPRITE = `${BASE}rfn`;
/** Pas de dessins dans l'aperçu publié sur claude.ai (fichiers absents) : pastilles de couleur. */
export const SIGNAL_ICONS = !PREVIEW;

export const slugSignal = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** Dessin en grand pour la fiche d'un signal. */
export const signalImage = (name: string) => `${BASE}fiche/${slugSignal(name)}.png`;

export const RFN_CREDIT = 'Dessins de la signalisation : Nicolas Wurtz, « signalisation-rfn-svg » (licence GPL-3.0)';
export const RFN_URL = 'https://github.com/nicolaswurtz/signalisation-rfn-svg';
