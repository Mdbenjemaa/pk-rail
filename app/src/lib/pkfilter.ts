/**
 * Lissage du PK pendant le suivi (filtre de Kalman à vitesse constante, en mètres le long de la ligne).
 * Il s'adapte tout seul : à pied il gomme le tremblement du GPS, en véhicule il suit la vitesse.
 */
export interface PkEstimate {
  /** PK lissé (km). */
  pk: number;
  /** Vitesse le long de la ligne (m/s, positive vers les PK croissants), bruitée à l'arrêt. */
  v: number;
  /** Sens de marche sur les 10 dernières secondes : 1 PK croissants, -1 décroissants, 0 à l'arrêt. */
  dir: 1 | -1 | 0;
}

const DIR_WINDOW_MS = 10000;
const DIR_MIN_M = 8; // en dessous, c'est le tremblement du GPS, pas un déplacement

const MAX_GAP_S = 20; // au-delà, on repart de zéro (tunnel, appli en veille)

export class PkFilter {
  /** Incertitude d'accélération (m/s²), pour les freinages et démarrages. */
  private readonly accel: number;

  constructor(accel = 0.8) {
    this.accel = accel;
  }

  private code: string | null = null;
  private x = 0;
  private v = 0;
  private p00 = 0;
  private p01 = 0;
  private p11 = 0;
  private t = 0;
  /** Dernière mesure reçue (m), pour ignorer les positions répétées. */
  private lastZ = NaN;
  private history: { t: number; x: number }[] = [];

  reset(): void {
    this.code = null;
  }

  update(code: string, pkKm: number, accuracy: number, timeMs: number): PkEstimate {
    const z = pkKm * 1000;
    const r = Math.max(accuracy, 2) ** 2 * 0.6;
    const dt = (timeMs - this.t) / 1000;
    if (this.code !== code || dt > MAX_GAP_S || dt < -1) return this.start(code, z, r, timeMs);
    // Même position redonnée par le téléphone (même heure, même PK) : elle ne compte pas deux fois.
    if (dt <= 0 && Math.abs(z - this.lastZ) < 0.01) return { pk: this.x / 1000, v: this.v, dir: this.direction(timeMs) };
    this.lastZ = z;
    if (dt > 0) {
      // Prédiction
      this.x += this.v * dt;
      const q = this.accel * this.accel;
      const p00 = this.p00 + dt * (2 * this.p01 + dt * this.p11) + (q * dt ** 4) / 4;
      const p01 = this.p01 + dt * this.p11 + (q * dt ** 3) / 2;
      const p11 = this.p11 + q * dt * dt;
      this.p00 = p00;
      this.p01 = p01;
      this.p11 = p11;
      this.t = timeMs;
    }
    // Saut de PK (discontinuité de ligne, GPS qui revient de loin) : on repart de la mesure.
    const s = this.p00 + r;
    const innov = z - this.x;
    if (Math.abs(innov) > Math.max(150, 6 * Math.sqrt(s))) return this.start(code, z, r, timeMs);
    const k0 = this.p00 / s;
    const k1 = this.p01 / s;
    this.x += k0 * innov;
    this.v += k1 * innov;
    const p00 = (1 - k0) * this.p00;
    const p01 = (1 - k0) * this.p01;
    const p11 = this.p11 - k1 * this.p01;
    this.p00 = p00;
    this.p01 = p01;
    this.p11 = p11;
    return this.estimate(timeMs);
  }

  private estimate(timeMs: number): PkEstimate {
    this.history.push({ t: timeMs, x: this.x });
    while (this.history.length > 1 && this.history[1].t <= timeMs - DIR_WINDOW_MS) this.history.shift();
    return { pk: this.x / 1000, v: this.v, dir: this.direction(timeMs) };
  }

  private direction(timeMs: number): 1 | -1 | 0 {
    const old = this.history[0];
    if (!old) return 0;
    const moved = this.x - old.x;
    return timeMs - old.t >= DIR_WINDOW_MS / 2 && Math.abs(moved) >= DIR_MIN_M ? (moved > 0 ? 1 : -1) : 0;
  }

  private start(code: string, z: number, r: number, timeMs: number): PkEstimate {
    this.code = code;
    this.x = z;
    this.v = 0;
    this.p00 = r;
    this.p01 = 0;
    this.p11 = 100;
    this.t = timeMs;
    this.lastZ = z;
    this.history = [];
    return this.estimate(timeMs);
  }
}
