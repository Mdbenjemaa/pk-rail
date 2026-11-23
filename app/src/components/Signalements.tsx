import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtLine, fmtPk } from '../lib/format';
import {
  compressPhoto,
  GRAVITES,
  graviteColor,
  graviteLabel,
  TYPES,
  typeLabel,
  type Gravite,
  type Lieu,
  type Signalement,
  type TypeId,
} from '../lib/signalements';
import { Modal } from './Sheets';

const MAX_PHOTOS = 4;

/** Vignettes des photos (adresses temporaires libérées à la fermeture). */
function Photos({ photos, onRemove }: { photos: Blob[]; onRemove?: (i: number) => void }) {
  const urls = useMemo(() => photos.map((b) => URL.createObjectURL(b)), [photos]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  if (!photos.length) return null;
  return (
    <div className="sig-photos">
      {urls.map((u, i) => (
        <div className="sig-photo" key={u}>
          <img src={u} alt={`Photo ${i + 1}`} />
          {onRemove && (
            <button className="sig-photo-x" onClick={() => onRemove(i)} aria-label={`Retirer la photo ${i + 1}`}>
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function LieuLine({ lieu }: { lieu: Lieu }) {
  return (
    <div className="sig-lieu">
      {lieu.code ? (
        <>
          <b>
            Ligne {fmtLine(lieu.code)}
            {lieu.pk !== undefined && <> · PK {fmtPk(lieu.pk)}</>}
          </b>
          {(lieu.ligne || lieu.voie) && (
            <span>
              {lieu.ligne}
              {lieu.voie && <> · voie {lieu.voie}</>}
            </span>
          )}
        </>
      ) : (
        <b>Pas de ligne à proximité</b>
      )}
      <span className="muted small">{lieu.manuel ? 'Position placée sur la carte' : `Position GPS ± ${Math.round(lieu.accuracy)} m`}</span>
    </div>
  );
}

/** Nouveau signalement : type, gravité, commentaire, photos ; la ligne et le PK sont remplis tout seuls. */
export function SignalerSheet(p: {
  lieu: Lieu | null;
  locating: boolean;
  onLocate: () => void;
  onSave: (s: Omit<Signalement, 'id' | 'created'>, send: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<TypeId | null>(null);
  const [gravite, setGravite] = useState<Gravite>('moyenne');
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const addPhotos = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    const out: Blob[] = [];
    for (const f of [...files].slice(0, MAX_PHOTOS - photos.length)) out.push(await compressPhoto(f));
    setPhotos((cur) => [...cur, ...out].slice(0, MAX_PHOTOS));
    setBusy(false);
  };

  const save = async (send: boolean) => {
    if (!p.lieu || !type) return;
    setBusy(true);
    setError(null);
    try {
      await p.onSave({ ...p.lieu, type, gravite, comment, photos }, send);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible.');
      setBusy(false);
    }
  };

  return (
    <Modal title="Signaler" onClose={p.onClose}>
      <div className="field-label">Où</div>
      {p.lieu ? (
        <LieuLine lieu={p.lieu} />
      ) : (
        <div className="sig-lieu">
          <b>{p.locating ? 'Repérage GPS en cours…' : 'Position inconnue'}</b>
          {!p.locating && (
            <button className="btn" onClick={p.onLocate}>
              Me repérer
            </button>
          )}
        </div>
      )}

      <div className="field-label">Quoi</div>
      <div className="chips sig-types" role="radiogroup" aria-label="Type d’anomalie">
        {TYPES.map((t) => (
          <button key={t.id} role="radio" aria-checked={type === t.id} className={`chip ${type === t.id ? 'on' : ''}`} onClick={() => setType(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="field-label">Gravité</div>
      <div className="seg seg-3" role="radiogroup" aria-label="Gravité">
        {GRAVITES.map((g) => (
          <button
            key={g.id}
            role="radio"
            aria-checked={gravite === g.id}
            className={`seg-btn ${gravite === g.id ? 'on' : ''}`}
            style={gravite === g.id ? { background: g.color, color: '#fff' } : undefined}
            onClick={() => setGravite(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>

      <div className="field-label">Commentaire</div>
      <textarea
        className="sig-comment"
        rows={3}
        maxLength={1000}
        placeholder="Ce que tu as vu, où exactement… (le micro du clavier permet de dicter)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        aria-label="Commentaire"
      />

      <div className="field-label">Photos ({photos.length}/{MAX_PHOTOS})</div>
      <Photos photos={photos} onRemove={(i) => setPhotos((cur) => cur.filter((_, k) => k !== i))} />
      {photos.length < MAX_PHOTOS && (
        <button className="btn wide" onClick={() => file.current?.click()} disabled={busy}>
          Prendre ou ajouter une photo
        </button>
      )}
      <input ref={file} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void addPhotos(e.target.files).finally(() => (e.target.value = ''))} />

      {error && <p className="error">{error}</p>}
      {!type && p.lieu && <p className="muted small">Choisis le type d’anomalie pour pouvoir envoyer.</p>}
      <div className="sig-actions">
        <button className="btn primary wide" disabled={!p.lieu || !type || busy} onClick={() => void save(true)}>
          Envoyer
        </button>
        <button className="btn wide" disabled={!p.lieu || !type || busy} onClick={() => void save(false)}>
          Enregistrer sans envoyer
        </button>
      </div>
      <p className="muted small">
        L’envoi ouvre le partage du téléphone (WhatsApp, SMS, mail…) avec la ligne, le PK, la position et les photos déjà
        remplis. Le signalement reste aussi sur ce téléphone, dans « Mes signalements ».
      </p>
    </Modal>
  );
}

const fmtWhen = (t: number) =>
  new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ');

/** Un signalement enregistré : détails, photos, renvoi, suppression. */
export function SignalementSheet(p: { s: Signalement; onSend: () => void; onShow: () => void; onDelete: () => void; onClose: () => void }) {
  const { s } = p;
  return (
    <Modal title={typeLabel(s.type)} onClose={p.onClose}>
      <p>
        <span className="sig-grav" style={{ background: graviteColor(s.gravite) }}>
          {graviteLabel(s.gravite)}
        </span>{' '}
        <span className="muted small">
          le {fmtWhen(s.created)}
          {s.sent ? ` · envoyé le ${fmtWhen(s.sent)}` : ' · pas encore envoyé'}
        </span>
      </p>
      <LieuLine lieu={s} />
      {s.comment.trim() && <p className="sig-text">{s.comment}</p>}
      <Photos photos={s.photos} />
      <div className="sig-actions">
        <button className="btn primary wide" onClick={p.onSend}>
          {s.sent ? 'Envoyer à nouveau' : 'Envoyer'}
        </button>
        <button className="btn wide" onClick={p.onShow}>
          Voir sur la carte
        </button>
        <button className="btn wide danger" onClick={p.onDelete}>
          Supprimer
        </button>
      </div>
    </Modal>
  );
}

/** Liste de mes signalements, du plus récent au plus ancien. */
export function SignalementsSheet(p: { list: Signalement[]; onOpen: (s: Signalement) => void; onNew: () => void; onClose: () => void }) {
  return (
    <Modal title="Mes signalements" onClose={p.onClose}>
      <button className="btn primary wide" onClick={p.onNew}>
        Nouveau signalement
      </button>
      {p.list.length === 0 ? (
        <p className="muted">Aucun signalement pour l’instant.</p>
      ) : (
        <div className="sig-list">
          {p.list.map((s) => (
            <button key={s.id} className="sig-row" onClick={() => p.onOpen(s)}>
              <span className="sig-dot" style={{ background: graviteColor(s.gravite) }} />
              <span className="sig-row-main">
                <b>{typeLabel(s.type)}</b>
                <span className="muted small">
                  {s.code ? `Ligne ${fmtLine(s.code)}${s.pk !== undefined ? ` · PK ${fmtPk(s.pk)}` : ''}` : 'Hors ligne'} · {fmtWhen(s.created)}
                  {s.sent ? '' : ' · non envoyé'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="muted small">Les signalements restent uniquement sur ce téléphone.</p>
    </Modal>
  );
}
