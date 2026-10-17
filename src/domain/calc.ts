import type { Los, Offer, State, ZusatzPos } from './types';
import { fmtEur, round2 } from './fmt';

export const zkey = (oz: string) => oz.replace(/\./g, '');
export const bewKey = (offerId: string, losId: string) => `${offerId}|${losId}`;
export const emptyBew = () => ({
  ausschluss: '', aufklaerung: '' as const, aufklaerungNotiz: '', qualifikation: '', km: null, auskoemm: false, erlaeuterung: '', zusatz: '',
});
export const getBew = (s: State, offerId: string, losId: string) => ({ ...emptyBew(), ...(s.bew[bewKey(offerId, losId)] ?? {}) });

/** Titel einer Position: Ordnungszahl ohne letzte Ebene (01.1 → 01, 01.02.03 → 01.02). */
export const titelKey = (oz: string) => oz.split('.').slice(0, -1).join('.') || oz;

export const losPositions = (s: State, los: Los) => s.lv.filter((p) => !los.oz || p.oz.startsWith(los.oz + '.'));
/** Wert einer Zusatzposition: Gesamtpreis laut Bieter, sonst Menge × EP. */
export const zusatzWert = (z: ZusatzPos) => z.gp ?? (z.ep != null && z.menge != null ? round2(z.ep * z.menge) : 0);

/** Zusatzposition(en) des Bieters (nicht im Soll-LV) in diesem Los: nach OZ-Präfix, nicht zuordenbare im ersten Los des Angebots. */
export function zusatzOf(s: State, los: Los, o: Offer): ZusatzPos[] {
  const z = o.zusatz ?? [];
  if (!z.length || !los.oz) return z;
  const own = z.filter((p) => p.oz.startsWith(los.oz + '.'));
  const orphans = z.filter((p) => !s.lose.some((l) => l.oz && p.oz.startsWith(l.oz + '.')));
  return o.lose[0] === los.id ? [...own, ...orphans] : own;
}

/** Gesamtsumme netto (vor Nachlass) eines Angebots über das ganze LV inkl. Zusatzpositionen, ohne Bedarfspositionen. */
export function offerWertung(s: State, o: Offer): number {
  let acc = 0;
  for (const p of s.lv) { const ep = o.prices[zkey(p.oz)]?.ep; if (!p.bedarf && ep != null) acc += round2((p.menge ?? 0) * ep); }
  for (const z of o.zusatz ?? []) if (!z.bedarf) acc += zusatzWert(z);
  return round2(acc);
}

export const offerLabel = (o: Offer) => `Nr. ${o.nr}`;

/** LV-Schätzpreis (netto) eines Loses: Menge × geschätzter EP; null ohne Schätzpreise. */
export function schaetzSumme(s: State, los: Los, prefix = ''): number | null {
  let acc = 0, any = false;
  for (const p of losPositions(s, los)) {
    if (p.bedarf || (prefix && !p.oz.startsWith(prefix + '.'))) continue;
    const ep = s.schaetz?.[zkey(p.oz)];
    if (ep == null) continue;
    acc += round2((p.menge ?? 0) * ep); any = true;
  }
  return any ? round2(acc) : null;
}

/** Kostenvoranschlag eines Loses: manuelle Eingabe, sonst aus den LV-Schätzpreisen (in der Kostenbasis brutto/netto). */
export function kostenOf(s: State, los: Los): number | null {
  if (los.kosten != null) return los.kosten;
  const n = schaetzSumme(s, los);
  return n == null ? null : round2(s.project.kostenBasis === 'brutto' ? n * (1 + s.project.mwst / 100) : n);
}

export interface Flag { kind: 'ok' | 'info' | 'warn' | 'bad'; text: string }

export interface Cell {
  offer: Offer;
  los: Los;
  covered: boolean;
  complete: boolean;
  sumNet: number | null; // vor Nachlass
  nachlass: number; // % wirksam
  net: number | null; // nach Nachlass
  gross: number | null;
  missing: number;
  zero: number;
  fileSum: number | null; // Summe der Bieter-GP laut Datei
  rechenDiff: number | null; // Datei − Berechnung (mit aktueller LV-Menge)
  mengeAbw: { oz: string; kurz: string; lv: number | null; bieter: number }[];
  zusatz: ZusatzPos[]; // Positionen des Bieters, die im Soll-LV nicht stehen (in sumNet enthalten)
  excluded: boolean;
  eligible: boolean;
  rankAll: number | null; // Submissionsrang inkl. ausgeschlossener
  rank: number | null; // Wertungsrang
  dMin: number | null;
  dKosten: number | null;
  flags: Flag[];
}

export function computeLos(s: State, los: Los): Cell[] {
  const pos = losPositions(s, los);
  const hasLv = pos.length > 0;
  const mw = 1 + s.project.mwst / 100;
  const cells: Cell[] = s.offers
    .filter((o) => o.lose.includes(los.id))
    .map((o) => {
      let sum: number | null = null;
      let missing = 0, zero = 0, fileSum: number | null = null;
      const mengeAbw: Cell['mengeAbw'] = [];
      if (hasLv) {
        let acc = 0, facc = 0, anyFile = false;
        for (const p of pos) {
          if (p.bedarf) continue;
          const pe = o.prices[zkey(p.oz)];
          if (pe?.ep == null) { missing++; continue; }
          if (pe.ep === 0 && (p.menge ?? 0) > 0) zero++;
          acc += round2((p.menge ?? 0) * pe.ep);
          if (pe.gp != null) { facc += pe.gp; anyFile = true; }
          if (pe.gp != null && pe.ep !== 0 && Math.abs(pe.gp - round2((p.menge ?? 0) * pe.ep)) > 0.005)
            mengeAbw.push({ oz: p.oz, kurz: p.kurz, lv: p.menge, bieter: Math.round((pe.gp / pe.ep) * 1000) / 1000 });
        }
        for (const z of zusatzOf(s, los, o)) {
          if (z.bedarf) continue;
          acc += zusatzWert(z);
          if (z.gp != null) { facc += z.gp; anyFile = true; }
        }
        sum = round2(acc);
        fileSum = anyFile ? round2(facc) : null;
      } else {
        const v = o.summen[los.id] ?? null;
        sum = v;
        if (v == null) missing = 1;
      }
      const nl = o.nachlass && (o.nachlassLose.length === 0 || o.nachlassLose.includes(los.id)) ? o.nachlass : 0;
      const net = sum == null ? null : round2(sum * (1 - nl / 100));
      const bew = getBew(s, o.id, los.id);
      const excluded = !!bew.ausschluss.trim() || bew.aufklaerung === 'unangemessen';
      const complete = sum != null && missing === 0 && sum !== 0;
      return {
        offer: o, los, covered: true, complete, sumNet: sum, nachlass: nl, net, gross: net == null ? null : round2(net * mw),
        missing, zero, fileSum, rechenDiff: fileSum != null && sum != null ? round2(fileSum - sum) : null, mengeAbw, zusatz: hasLv ? zusatzOf(s, los, o) : [],
        excluded, eligible: complete && !excluded, rankAll: null, rank: null, dMin: null, dKosten: null, flags: [],
      };
    });

  const kosten = kostenOf(s, los);
  const byRound = new Map<number, Cell[]>();
  for (const c of cells) byRound.set(c.offer.runde, [...(byRound.get(c.offer.runde) ?? []), c]);
  for (const group of byRound.values()) {
    const all = group.filter((c) => c.complete).sort((a, b) => a.net! - b.net!);
    all.forEach((c, i) => (c.rankAll = i + 1));
    const el = all.filter((c) => c.eligible);
    el.forEach((c, i) => (c.rank = i + 1));
    const min = el[0]?.net ?? null;
    for (const c of group) {
      if (c.net != null) {
        if (min) c.dMin = (c.net / min - 1) * 100;
        if (kosten) {
          const v = s.project.kostenBasis === 'brutto' ? c.gross! : c.net;
          c.dKosten = (v / kosten - 1) * 100;
        }
      }
    }
    const t = s.project.schwelle / 100;
    for (const c of group) {
      const b = getBew(s, c.offer.id, los.id);
      if (c.excluded && b.aufklaerung !== 'unangemessen') c.flags.push({ kind: 'bad', text: 'Ausgeschlossen' });
      if (b.aufklaerung === 'unangemessen') c.flags.push({ kind: 'bad', text: 'Preis unangemessen – nicht gewertet' });
      if (!c.complete && !c.excluded) c.flags.push({ kind: 'warn', text: hasLv ? `${c.missing} Position(en) ohne Preis` : 'Kein Preis erfasst' });
      if (c.zero > 0) c.flags.push({ kind: 'info', text: `${c.zero}× Preis 0,00 €` });
      if (c.rechenDiff != null && Math.abs(c.rechenDiff) > 0.01) c.flags.push({ kind: 'warn', text: `Rechenabweichung ${c.rechenDiff > 0 ? '+' : ''}${c.rechenDiff.toFixed(2).replace('.', ',')} € ggü. Bieterdatei` });
      if (c.mengeAbw.length) c.flags.push({ kind: 'warn', text: `Menge weicht ab (${c.mengeAbw.length} Pos.)` });
      if (c.zusatz.length) c.flags.push({ kind: 'info', text: `${c.zusatz.length} neue Position(en) ggü. LV – in der Summe enthalten` });
      if (hasLv && c.offer.check && c.offer.lose[0] === los.id) c.flags.push(...summenFlags(s, c.offer));
      if (c.eligible && c.net != null) {
        const next = el.find((x) => x !== c && x.net! > c.net!)?.net;
        const ref = kosten ? (s.project.kostenBasis === 'brutto' ? c.gross! : c.net) : null;
        const lowKs = kosten && ref != null ? ref < kosten * (1 - t) : false;
        const lowNext = next ? c.net < next * (1 - t) : false;
        if (lowKs || lowNext) {
          if (b.aufklaerung === 'angemessen') c.flags.push({ kind: 'info', text: 'Preis aufgeklärt – angemessen' });
          else c.flags.push({ kind: 'warn', text: `Auffallend niedrig (>${s.project.schwelle} % unter ${lowKs ? 'Kostenvoranschlag' : 'nächstem Angebot'}) – Aufklärung prüfen` });
        }
      }
    }
  }
  return cells.sort((a, b) => a.offer.runde - b.offer.runde || (a.rankAll ?? 99) - (b.rankAll ?? 99) || a.offer.nr - b.offer.nr);
}

/** Passt das geladene LV zu den Angeboten? Weichen bei mindestens der Hälfte Mengen ab, fehlen Preise oder gibt es neue Positionen, wurde vermutlich nach einer anderen LV-Fassung kalkuliert. */
export function lvFremd(s: State, cells: Cell[]): string | null {
  if (!s.lv.length) return null;
  const abw = cells.filter((c) => c.mengeAbw.length + c.zusatz.length + c.missing >= 3);
  if (!abw.length || abw.length * 2 < cells.length) return null;
  const max = (f: (c: Cell) => number) => Math.max(...cells.map(f));
  return `Die Angebote passen nicht zum geladenen LV${s.lvInfo?.lv ? ` (${s.lvInfo.lv}, ${s.lv.length} Positionen)` : ''}: bei ${abw.length} von ${cells.length} Angeboten weichen Mengen ab (${max((c) => c.mengeAbw.length)} Pos.), stehen neue Positionen (${max((c) => c.zusatz.length)}) oder fehlen Preise (${max((c) => c.missing)}). Vermutlich haben die Bieter nach einer anderen LV-Fassung kalkuliert – bitte im Schritt „Vergabe“ das aktuelle LV laden. Die Summen sind so nicht belastbar.`;
}

/** Gegenprobe der Angebotssumme: Wertungssumme gegen Endsumme der GAEB-Datei und gegen die Endsumme im PDF des Bieters. */
export function summenFlags(s: State, o: Offer): Flag[] {
  const ck = o.check;
  if (!ck) return [];
  const out: Flag[] = [];
  const w = offerWertung(s, o);
  const gleich = (a: number, b: number) => Math.abs(a - b) <= 0.01;
  const ref = ck.gaeb ?? ck.positionen;
  const quelle = ck.gaeb != null ? 'Bieterdatei (GAEB)' : 'Summe der Positionen in der Bieterdatei';
  if (ref > 0) out.push(gleich(w, ref) ? { kind: 'ok', text: `Summe stimmt mit ${quelle} überein` } : { kind: 'bad', text: `Summe ${fmtEur(w)} weicht von ${quelle} ${fmtEur(ref)} ab (${w - ref > 0 ? '+' : ''}${fmtEur(round2(w - ref))})` });
  if (ck.gaeb != null && !gleich(ck.gaeb, ck.positionen)) out.push({ kind: 'warn', text: `GAEB-Datei in sich widersprüchlich: Endsumme ${fmtEur(ck.gaeb)}, Summe der Positionen ${fmtEur(ck.positionen)}` });
  const pdf = ck.pdf;
  if (pdf) {
    if (!pdf.lesbar) out.push({ kind: 'info', text: `PDF „${pdf.datei}“ ohne lesbaren Text (Scan) – Endsumme dort nicht automatisch prüfbar` });
    else if (pdf.betrag != null && !gleich(pdf.betrag, ref)) out.push({ kind: 'bad', text: `PDF „${pdf.datei}“ nennt Endsumme ${fmtEur(pdf.betrag)}, GAEB ${fmtEur(ref)}` });
    else if (pdf.gefunden || pdf.betrag != null) out.push({ kind: 'ok', text: 'Endsumme im PDF bestätigt' });
    else out.push({ kind: 'info', text: `Endsumme nicht im PDF „${pdf.datei}“ gefunden` });
  }
  return out;
}

/** Maßgebliche Runde = letzte Runde mit wertbaren Angeboten. */
export function finalRound(cells: Cell[]): number {
  const r = cells.filter((c) => c.eligible).map((c) => c.offer.runde);
  return r.length ? Math.max(...r) : Math.max(1, ...cells.map((c) => c.offer.runde));
}

export function zuschlagCell(s: State, los: Los, cells: Cell[]): Cell | undefined {
  const forced = s.zuschlag[los.id];
  const f = forced && cells.find((c) => c.offer.id === forced && c.eligible);
  if (f) return f;
  const fr = finalRound(cells);
  return cells.filter((c) => c.offer.runde === fr).find((c) => c.rank === 1);
}

export interface Auff {
  guenstig: { oz: string; kurz: string; ep: number; avg: number; delta: number }[];
  hoch: { oz: string; kurz: string; ep: number; avg: number; delta: number }[];
  titel: { oz: string; name: string; sum: number; avg: number }[];
}

/** Auffällige Einzelpreise und Titel gegenüber dem Mittel der übrigen Angebote derselben Runde. */
export function auffaelligkeiten(s: State, los: Los, cells: Cell[], c: Cell): Auff {
  const peers = cells.filter((x) => x !== c && x.offer.runde === c.offer.runde && x.complete && !x.excluded);
  const res: Auff = { guenstig: [], hoch: [], titel: [] };
  if (!peers.length || !c.complete) return res;
  const th = s.project.abweichung / 100;
  const pos = losPositions(s, los).filter((p) => !p.bedarf);
  const titelSum = new Map<string, { me: number; peers: number[] }>();
  const losSum = c.sumNet ?? 0;
  for (const p of pos) {
    const me = c.offer.prices[zkey(p.oz)]?.ep;
    if (me == null) continue;
    const pe = peers.map((x) => x.offer.prices[zkey(p.oz)]?.ep).filter((v): v is number => v != null);
    const ts = titelKey(p.oz);
    const t = titelSum.get(ts) ?? { me: 0, peers: peers.map(() => 0) };
    t.me += (p.menge ?? 0) * me;
    peers.forEach((x, i) => (t.peers[i] += (p.menge ?? 0) * (x.offer.prices[zkey(p.oz)]?.ep ?? 0)));
    titelSum.set(ts, t);
    if (!pe.length || me <= 0) continue;
    const avg = pe.reduce((a, b) => a + b, 0) / pe.length;
    if (avg <= 0) continue;
    const delta = round2(((p.menge ?? 0) * (me - avg)));
    if (Math.abs(delta) < Math.max(50, losSum * 0.0005)) continue;
    const row = { oz: p.oz, kurz: p.kurz, ep: me, avg, delta };
    if (me < avg * (1 - th)) res.guenstig.push(row);
    else if (me > avg * (1 + th)) res.hoch.push(row);
  }
  res.guenstig.sort((a, b) => a.delta - b.delta);
  res.hoch.sort((a, b) => b.delta - a.delta);
  for (const [oz, t] of titelSum) {
    const avg = t.peers.reduce((a, b) => a + b, 0) / t.peers.length;
    if (avg > 0 && t.me < avg * (1 - th) && avg - t.me > losSum * 0.01) res.titel.push({ oz, name: s.titles[oz] ?? '', sum: t.me, avg });
  }
  res.titel.sort((a, b) => a.avg - a.sum - (b.avg - b.sum));
  return res;
}

/** Offene Punkte der Vollständigkeitsprüfung eines Angebots. */
export function pruefStatus(s: State, o: Offer) {
  const rows = s.unterlagen.map((u) => ({ u, p: o.pruef?.[u.id] }));
  return {
    fehlt: rows.filter((r) => ['fehlt', 'leer', 'teil', 'unsign'].includes(r.p?.s ?? '')).map((r) => r.u.label),
    nurPdf: rows.filter((r) => r.p?.s === 'pdf').map((r) => r.u.label),
    nach: rows.filter((r) => r.p?.s === 'nach').map((r) => ({ label: r.u.label, d: r.p!.d })),
    ungeprueft: rows.filter((r) => !r.p).length,
  };
}

/** Zusammenfassung über alle Lose eines Angebots (für Bieterliste „ungeprüft“). */
export function offerBrutto(s: State, o: Offer): number | null {
  let t = 0;
  for (const l of s.lose) {
    if (!o.lose.includes(l.id)) continue;
    const c = computeLos(s, l).find((x) => x.offer.id === o.id);
    if (!c || c.gross == null) return null;
    t += c.gross;
  }
  return round2(t);
}
