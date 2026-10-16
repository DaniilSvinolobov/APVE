import type { Bidder, State } from './types';

export interface BidderResult {
  bidder: Bidder;
  brutto: number | null; // Summe vor Nachlass (netto, ohne MwSt.)
  net: number | null; // nach Nachlass
  gross: number | null; // inkl. MwSt.
  missing: number; // Positionen ohne Preis
  complete: boolean;
  eligible: boolean; // nicht ausgeschlossen & vollständig bepreist
  rechnerDiff: number | null; // Abweichung zur Summe laut Bieter
  preisPunkte: number | null;
  total: number | null; // Gesamtpunkte
  rank: number | null;
  dKosten: number | null; // % zur Kostenschätzung
  dMin: number | null; // % zum günstigsten
  flags: Flag[];
  formalOk: boolean;
}

export interface Flag {
  kind: 'warn' | 'info' | 'bad';
  text: string;
}

export const formalOk = (b: Bidder, checkIds: string[]) => checkIds.every((id) => b.checks[id]);

export function lineTotal(menge: number | null, ep: number | null): number | null {
  if (menge == null || ep == null) return null;
  return Math.round(menge * ep * 100) / 100;
}

export function computeAll(s: State, checkIds: string[]): BidderResult[] {
  const { project: p } = s;
  const res: BidderResult[] = s.bidders.map((b) => {
    let brutto: number | null = null;
    let missing = 0;
    if (p.mode === 'summe') {
      brutto = b.summe;
      if (brutto == null) missing = 1;
    } else {
      let sum = 0;
      for (const pos of s.positions) {
        if (pos.bedarf) continue;
        const gp = lineTotal(pos.menge, s.prices[pos.id]?.[b.id] ?? null);
        if (gp == null) missing++;
        else sum += gp;
      }
      brutto = s.positions.some((x) => !x.bedarf) ? Math.round(sum * 100) / 100 : null;
    }
    const net = brutto == null ? null : Math.round(brutto * (1 - (b.nachlass ?? 0) / 100) * 100) / 100;
    const complete = brutto != null && missing === 0 && brutto > 0;
    const fOk = formalOk(b, checkIds);
    return {
      bidder: b,
      brutto,
      net,
      gross: net == null ? null : Math.round(net * (1 + p.mwst / 100) * 100) / 100,
      missing,
      complete,
      eligible: !b.excluded && complete && b.aufklaerung !== 'unangemessen',
      rechnerDiff:
        p.mode === 'lv' && b.summeBieter != null && brutto != null
          ? Math.round((b.summeBieter - brutto) * 100) / 100
          : null,
      preisPunkte: null,
      total: null,
      rank: null,
      dKosten: null,
      dMin: null,
      flags: [],
      formalOk: fOk,
    };
  });

  const elig = res.filter((r) => r.eligible).sort((a, b) => a.net! - b.net!);
  const min = elig[0]?.net ?? null;
  const ks = p.kostenschaetzung;
  const wPreis = p.kriterienModus === 'preis' ? 100 : 100 - s.criteria.reduce((a, c) => a + (c.weight || 0), 0);

  for (const r of res) {
    if (r.net != null) {
      if (ks) r.dKosten = (r.net / ks - 1) * 100;
      if (min) r.dMin = (r.net / min - 1) * 100;
    }
    if (r.eligible && min) {
      r.preisPunkte = (min / r.net!) * 100;
      if (p.kriterienModus === 'preis') r.total = r.preisPunkte;
      else {
        let t = (wPreis / 100) * r.preisPunkte;
        for (const c of s.criteria) t += ((c.weight || 0) / 100) * (s.scores[c.id]?.[r.bidder.id] ?? 0) * 10;
        r.total = t;
      }
    }
  }
  [...elig].sort((a, b) => b.total! - a.total! || a.net! - b.net!).forEach((r, i) => (r.rank = i + 1));

  // Hinweise
  for (const r of res) {
    const b = r.bidder;
    if (b.excluded) r.flags.push({ kind: 'bad', text: 'Ausgeschlossen' });
    else if (!r.formalOk) r.flags.push({ kind: 'warn', text: 'Formalprüfung: Mängel offen' });
    if (b.aufklaerung === 'unangemessen' && !b.excluded) r.flags.push({ kind: 'bad', text: 'Preis unangemessen – nicht gewertet' });
    if (!r.complete && !b.excluded) r.flags.push({ kind: 'warn', text: p.mode === 'lv' ? `${r.missing} Position(en) ohne Preis` : 'Kein Preis erfasst' });
    if (r.rechnerDiff != null && Math.abs(r.rechnerDiff) > 0.01)
      r.flags.push({ kind: 'warn', text: `Rechenfehler: ${r.rechnerDiff > 0 ? '+' : ''}${r.rechnerDiff.toFixed(2).replace('.', ',')} € ggü. Bieter` });
    if (r.eligible) {
      const t = p.schwelle / 100;
      const next = elig[elig.indexOf(r) + 1]?.net;
      const lowVsKs = ks ? r.net! < ks * (1 - t) : false;
      const lowVsNext = next ? r.net! < next * (1 - t) : false;
      if (lowVsKs || lowVsNext) {
        const why = lowVsKs ? `${p.schwelle} % unter Kostenschätzung` : `${p.schwelle} % unter nächstem Angebot`;
        if (b.aufklaerung === 'angemessen') r.flags.push({ kind: 'info', text: 'Preis aufgeklärt – angemessen' });
        else if (b.aufklaerung === 'unangemessen') r.flags.push({ kind: 'bad', text: 'Preis unangemessen' });
        else r.flags.push({ kind: 'warn', text: `Auffallend niedrig (>${why}) – Aufklärung nötig` });
      }
      if (ks && r.net! > ks * 1.2) r.flags.push({ kind: 'info', text: 'Über 20 % über Kostenschätzung' });
    }
  }
  return res;
}

/** Ausreißer-Positionen: EP weicht >50 % vom Median ab (ab 3 Bietern). */
export function outlier(s: State, posId: string, bidderId: string): boolean {
  const vals = s.bidders
    .filter((b) => !b.excluded)
    .map((b) => s.prices[posId]?.[b.id])
    .filter((v): v is number => v != null && v > 0);
  const v = s.prices[posId]?.[bidderId];
  if (vals.length < 3 || v == null || v <= 0) return false;
  const sorted = [...vals].sort((a, b) => a - b);
  const m = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return Math.abs(v / m - 1) > 0.5;
}

export function lowestEp(s: State, posId: string): number | null {
  const vals = s.bidders
    .filter((b) => !b.excluded)
    .map((b) => s.prices[posId]?.[b.id])
    .filter((v): v is number => v != null && v > 0);
  return vals.length > 1 ? Math.min(...vals) : null;
}
