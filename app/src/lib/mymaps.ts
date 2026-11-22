/** Identifiant d'une carte Google My Maps dans un lien (viewer, edit, kml, lien réseau d'un KMZ…). */
export function myMapsId(text: string): string | null {
  const m = /google\.[a-z.]+\/(?:maps\/d|mymaps)\/[^\s"'<>]*?[?&](?:amp;)?mid=([A-Za-z0-9_-]{10,100})/i.exec(text);
  return m ? m[1] : null;
}

/** Lien court partagé depuis le téléphone (bouton Partager de Google Maps) : maps.app.goo.gl/… ou goo.gl/maps/…. */
export function myMapsShortLink(text: string): string | null {
  const m = /https:\/\/(?:maps\.app\.goo\.gl\/[A-Za-z0-9_-]+|goo\.gl\/maps\/[A-Za-z0-9_-]+)(?:\?[^\s"'<>]*)?/i.exec(text);
  return m ? m[0] : null;
}
