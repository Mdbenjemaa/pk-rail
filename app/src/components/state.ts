import type { LineDoc } from '../lib/data';
import type { Fix } from '../lib/gps';
import type { LineCandidate, Match } from '../lib/locate';

/** Où en est le repérage : rien, GPS en cours, erreur, ou position rattachée à une ligne. */
export type LocateState =
  | { phase: 'idle' }
  | { phase: 'acquiring'; fix: Fix | null; elapsed: number; /** Position prise : calcul de la ligne et du PK en cours. */ computing?: boolean }
  | { phase: 'error'; message: string }
  | LocateResult;

export interface LocateResult {
  phase: 'result';
  fix: Fix;
  mode: 'gps' | 'manuel' | 'suivi';
  radius: number;
  match: Match;
  chosen: LineCandidate | null;
  doc: LineDoc | null;
}

export type Theme = 'auto' | 'jour' | 'nuit';
