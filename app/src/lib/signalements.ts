/**
 * Signalements : une anomalie relevée sur le terrain (type, gravité, commentaire, photos), avec la ligne, le PK
 * et la position. Gardés uniquement sur le téléphone (IndexedDB, à cause des photos) et envoyés par le
 * partage du téléphone (WhatsApp, SMS, mail…). Aucun serveur.
 */
import type { Feature, FeatureCollection } from 'geojson';
import { fmtLine, fmtPk } from './format';
import type { LonLat } from './geo';

export const TYPES = [
  { id: 'vegetation', label: 'Végétation' },
  { id: 'cloture', label: 'Clôture ou portail' },
  { id: 'signal', label: 'Signalisation' },
  { id: 'voie', label: 'Voie ou ballast' },
  { id: 'catenaire', label: 'Caténaire' },
  { id: 'pn', label: 'Passage à niveau' },
  { id: 'acces', label: 'Accès' },
  { id: 'ouvrage', label: 'Ouvrage ou talus' },
  { id: 'depot', label: 'Dépôt ou encombrant' },
  { id: 'autre', label: 'Autre' },
] as const;
export type TypeId = (typeof TYPES)[number]['id'];

export const GRAVITES = [
  { id: 'faible', label: 'Faible', color: '#ca8a04' },
  { id: 'moyenne', label: 'Moyenne', color: '#ea580c' },
  { id: 'urgente', label: 'Urgente', color: '#dc2626' },
] as const;
export type Gravite = (typeof GRAVITES)[number]['id'];

/** Où se trouve l'agent au moment du signalement. */
export interface Lieu {
  lonlat: LonLat;
  accuracy: number;
  /** Position GPS, ou placée à la main sur la carte. */
  manuel: boolean;
  code?: string;
  pk?: number;
  ligne?: string;
  voie?: string;
}

export interface Signalement extends Lieu {
  id: string;
  created: number;
  type: TypeId;
  gravite: Gravite;
  comment: string;
  photos: Blob[];
  /** Dernier envoi par le partage du téléphone. */
  sent?: number;
}

export const typeLabel = (t: string) => TYPES.find((x) => x.id === t)?.label ?? 'Autre';
export const graviteLabel = (g: string) => GRAVITES.find((x) => x.id === g)?.label ?? g;
export const graviteColor = (g: string) => GRAVITES.find((x) => x.id === g)?.color ?? '#ea580c';

const fmtDate = (t: number) =>
  new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ');

/** Texte envoyé avec le signalement : lisible tel quel dans un SMS ou un mail. */
export function signalementText(s: Signalement): string {
  const [lon, lat] = s.lonlat;
  const lines = [
    `Signalement PK Rail · ${typeLabel(s.type)}${s.gravite === 'urgente' ? ' · URGENT' : ` · gravité ${graviteLabel(s.gravite).toLowerCase()}`}`,
  ];
  if (s.code) {
    const ligne = `Ligne ${fmtLine(s.code)}${s.ligne ? ` (${s.ligne})` : ''}`;
    lines.push(`${ligne}${s.pk !== undefined ? ` · PK ${fmtPk(s.pk)}` : ''}${s.voie ? ` · voie ${s.voie}` : ''}`);
  } else {
    lines.push('Hors ligne connue');
  }
  lines.push(`Position : ${lat.toFixed(5)}, ${lon.toFixed(5)}${s.manuel ? ' (placée sur la carte)' : ` (GPS ± ${Math.round(s.accuracy)} m)`}`);
  lines.push(`Carte : https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`);
  lines.push(`Le ${fmtDate(s.created)}`);
  if (s.comment.trim()) lines.push('', s.comment.trim());
  return lines.join('\n');
}

/** Points des signalements, pour la carte (couleur selon la gravité). */
export function signalementFeatures(list: Signalement[]): FeatureCollection {
  const features: Feature[] = list.map((s) => ({
    type: 'Feature',
    properties: { id: s.id, n: typeLabel(s.type), g: s.gravite, c: graviteColor(s.gravite) },
    geometry: { type: 'Point', coordinates: s.lonlat },
  }));
  return { type: 'FeatureCollection', features };
}

/* ---------- Photos ---------- */

/** Photo réduite (1600 px au plus, JPEG) : légère à garder et à envoyer. */
export async function compressPhoto(file: Blob, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.75));
    return out ?? file;
  } catch {
    return file;
  }
}

/* ---------- Stockage sur le téléphone (IndexedDB) ---------- */

const DB = 'pkr-signalements';
const STORE = 's';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = run(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(r.result);
    };
    t.onerror = t.onabort = () => {
      db.close();
      reject(t.error ?? new Error('Enregistrement impossible sur ce téléphone.'));
    };
  });
}

export async function listSignalements(): Promise<Signalement[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const all = await tx<Signalement[]>('readonly', (s) => s.getAll() as IDBRequest<Signalement[]>);
    return all.sort((a, b) => b.created - a.created);
  } catch {
    return [];
  }
}

export function saveSignalement(s: Signalement): Promise<unknown> {
  return tx('readwrite', (st) => st.put(s));
}

export function deleteSignalement(id: string): Promise<unknown> {
  return tx('readwrite', (st) => st.delete(id));
}

/* ---------- Envoi ---------- */

export type Envoi = 'partage' | 'texte' | 'copie' | 'annule';

/**
 * Envoi par le partage du téléphone, avec les photos quand c'est possible. Sinon le texte seul, sinon
 * le texte est copié pour être collé dans un message.
 */
export async function shareSignalement(s: Signalement): Promise<Envoi> {
  const title = `Signalement PK Rail · ${typeLabel(s.type)}`;
  const text = signalementText(s);
  const files = s.photos.map((b, i) => new File([b], `signalement-${i + 1}.jpg`, { type: b.type || 'image/jpeg' }));
  try {
    if (files.length && navigator.canShare?.({ files })) {
      await navigator.share({ title, text, files });
      return 'partage';
    }
    if (navigator.share) {
      await navigator.share({ title, text });
      return 'texte';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'annule';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copie';
  } catch {
    return 'annule';
  }
}
