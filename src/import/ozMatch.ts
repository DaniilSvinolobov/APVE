import { ozKey, type GaebPos } from '../gaeb/gaeb';
import type { LvPos } from '../domain/types';

/** Zuordnung einer Bieterposition zu einer Soll-LV-Position. art 'oz' = gleiche Ordnungszahl, 'text' = über Text/Einheit/Menge. */
export interface OzMatch { bieter: string; lv: string; score: number; art: 'oz' | 'text' | 'menge' }

/** Ab diesem Wert gilt eine Textzuordnung als sicher; darunter wird sie in den Hinweisen zur Prüfung genannt. */
export const SICHER = 0.8;

const MIN_TEXT = 0.6;
const MIN_SCORE = 0.65;

const tokens = (s: string) => {
  const t = (s || '').toLowerCase().replace(/ß/g, 'ss').replace(/(\d),(\d)/g, '$1.$2').split(/[^a-z0-9äöüé.]+/).map((w) => w.replace(/^\.+|\.+$/g, '')).filter((w) => w.length > 1 || /\d/.test(w));
  const m = new Map<string, number>();
  for (const w of t) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};

/** Dice-Koeffizient auf Wort-Multimengen: 1 = gleicher Text, 0 = nichts gemeinsam. */
const dice = (a: Map<string, number>, b: Map<string, number>) => {
  let na = 0, nb = 0, common = 0;
  for (const v of a.values()) na += v;
  for (const v of b.values()) nb += v;
  if (!na || !nb) return 0;
  for (const [w, v] of a) common += Math.min(v, b.get(w) ?? 0);
  return (2 * common) / (na + nb);
};

interface Side { oz: string; kurz: Map<string, number>; lang: Map<string, number>; all: Map<string, number>; einheit: string; menge: number | null; idx: number; hasText: boolean; rel: number }

const side = (p: { oz: string; kurz: string; lang?: string; einheit: string; menge: number | null }, idx: number, n: number): Side => ({
  oz: p.oz, kurz: tokens(p.kurz), lang: tokens(p.lang ?? ''), all: tokens(`${p.kurz} ${p.lang ?? ''}`), einheit: (p.einheit || '').trim().toLowerCase(), menge: p.menge, idx,
  hasText: !!(p.kurz || p.lang), rel: n > 1 ? idx / (n - 1) : 0,
});

/** Anteil des kürzeren Textes, der im anderen vorkommt – fängt gekürzte oder um Zusätze erweiterte Texte ab. */
const overlap = (a: Map<string, number>, b: Map<string, number>) => {
  let na = 0, nb = 0, common = 0;
  for (const v of a.values()) na += v;
  for (const v of b.values()) nb += v;
  if (!na || !nb) return 0;
  for (const [w, v] of a) common += Math.min(v, b.get(w) ?? 0);
  return common / Math.min(na, nb);
};

const textSim = (a: Side, b: Side) => {
  const k = dice(a.kurz, b.kurz);
  const strict = a.lang.size && b.lang.size ? 0.4 * k + 0.6 * dice(a.lang, b.lang) : k;
  // Bieter kürzen oder formulieren Texte um: Gesamttext (Kurz + Lang) gegeneinander halten, Überdeckung etwas abwerten
  return Math.max(strict, dice(a.all, b.all), 0.9 * overlap(a.all, b.all));
};

const closeMenge = (a: number | null, b: number | null) => a != null && b != null && a > 0 && b > 0 && Math.abs(a - b) <= Math.max(0.015 * b, 0.005);

/**
 * Ordnet Bieterpositionen den Positionen des Soll-LV zu. Bieter nummerieren ihre Leistungsverzeichnisse
 * mitunter anders (andere OZ-Maske, Umnummerierung); eine fehlende OZ heißt dann nicht, dass die Position fehlt.
 * 1. gleiche OZ und nicht widersprüchlicher Text → Treffer
 * 2. Rest: Text (Kurz-/Langtext) vergleichen, Einheit, Menge und Reihenfolge stützen; je Paar höchster Wert zuerst
 */
export function matchPositions(lv: LvPos[], bid: GaebPos[]): OzMatch[] {
  const L = lv.map((p, i) => side(p, i, lv.length));
  // GAEB-90-Bieterdateien enthalten oft nur OZ und Preise: Menge dann aus GP ÷ EP ableiten
  const B = bid.map((p, i) => side({ ...p, menge: p.menge ?? (p.ep && p.gp != null ? p.gp / p.ep : null) }, i, bid.length));
  const out: OzMatch[] = [];
  const usedL = new Set<number>(), usedB = new Set<number>();

  const byKey = new Map(L.map((l) => [ozKey(l.oz), l]));
  for (const b of B) {
    const l = byKey.get(ozKey(b.oz));
    if (!l || usedL.has(l.idx)) continue;
    const s = textSim(b, l);
    if (s >= 0.35 || !b.hasText || !l.hasText) {
      out.push({ bieter: b.oz, lv: l.oz, score: 1, art: 'oz' });
      usedL.add(l.idx); usedB.add(b.idx);
    }
  }

  const pairs: { b: number; l: number; score: number }[] = [];
  for (const b of B) {
    if (usedB.has(b.idx) || !b.hasText) continue;
    for (const l of L) {
      if (usedL.has(l.idx) || !l.hasText) continue;
      const t = textSim(b, l);
      if (t < MIN_TEXT) continue;
      let score = 0.75 * t + 0.05 * (1 - Math.abs(b.rel - l.rel));
      if (b.einheit && l.einheit) score += b.einheit === l.einheit ? 0.1 : -0.15;
      if (b.menge != null && l.menge != null && Math.abs(b.menge - l.menge) < 1e-6) score += 0.1;
      if (score >= MIN_SCORE) pairs.push({ b: b.idx, l: l.idx, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  for (const p of pairs) {
    if (usedB.has(p.b) || usedL.has(p.l)) continue;
    usedB.add(p.b); usedL.add(p.l);
    out.push({ bieter: B[p.b].oz, lv: L[p.l].oz, score: Math.min(1, Math.round(p.score * 100) / 100), art: 'text' });
  }

  // Bieterpositionen ganz ohne Text (z. B. GAEB 90, Satzart 23): in der Reihenfolge ausrichten, wo die Menge übereinstimmt
  const lr = L.filter((l) => !usedL.has(l.idx));
  const br = B.filter((b) => !usedB.has(b.idx) && !b.hasText);
  const dp = Array.from({ length: lr.length + 1 }, () => new Array<number>(br.length + 1).fill(0));
  for (let i = lr.length - 1; i >= 0; i--) for (let j = br.length - 1; j >= 0; j--) {
    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1], closeMenge(lr[i].menge, br[j].menge) ? 1 + dp[i + 1][j + 1] : 0);
  }
  for (let i = 0, j = 0; i < lr.length && j < br.length;) {
    if (closeMenge(lr[i].menge, br[j].menge) && dp[i][j] === 1 + dp[i + 1][j + 1]) { out.push({ bieter: br[j].oz, lv: lr[i].oz, score: 0.7, art: 'menge' }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}
