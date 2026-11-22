import { useState } from 'react';

/** Import par lien Google My Maps : on colle le lien de la carte, l'appli va chercher les points. */
export function MyMapsLink({ busy, onSubmit }: { busy?: boolean; onSubmit: (link: string) => void }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  if (!open) {
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        Ou importer depuis un lien Google My Maps
      </button>
    );
  }
  return (
    <form
      className="mymaps-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (link.trim()) onSubmit(link.trim());
      }}
    >
      <input
        type="text"
        inputMode="url"
        placeholder="Colle le lien de la carte (maps.app.goo.gl/…)"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        disabled={busy}
      />
      <button className="btn primary btn-small" disabled={busy || !link.trim()}>
        {busy ? '…' : 'Importer'}
      </button>
    </form>
  );
}
