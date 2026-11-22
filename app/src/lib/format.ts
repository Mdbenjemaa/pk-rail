/** 12.345 (km) → "12+345" ; -0.2 → "-0+200". */
export function fmtPk(pk: number | null | undefined): string {
  if (pk === null || pk === undefined || !Number.isFinite(pk)) return '—';
  const sign = pk < 0 ? '-' : '';
  const m = Math.round(Math.abs(pk) * 1000);
  return `${sign}${Math.floor(m / 1000)}+${String(m % 1000).padStart(3, '0')}`;
}

/** 1234 (m) → "1,2 km" ; 85 → "85 m". */
export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;
}

/** "830000" → "830 000" (comme dans les documents SNCF). */
export function fmtLine(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
