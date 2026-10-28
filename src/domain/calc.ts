import type { HsEintrag, Los, Nachunternehmer, Offer, State, ZusatzPos } from './types';
import { fmtEur, round2 } from './fmt';

export const zkey = (oz: string) => oz.replace(/\./g, '');
export const bewKey = (offerId: string, losId: string) => `${offerId}|${losId}`;
export const emptyBew = () => ({
  ausschluss: '', aufklaerung: '' as const, aufklaerungNotiz: '', qualifikation: '', km: null, auskoemm: false, erlaeuterung: '', zusatz: '', nichtGewertet: '',
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
      const excluded = !!bew.ausschluss.trim() || bew.aufklaerung === 'unangemessen' || !!o.status;
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
    // zurückgezogene Angebote erhalten keinen Rang; formal ausgeschlossene bleiben in der Submissionsrangfolge (rankAll)
    const all = group.filter((c) => c.complete && c.offer.status !== 'zurueck').sort((a, b) => a.net! - b.net!);
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
      if (c.offer.status === 'zurueck') c.flags.push({ kind: 'bad', text: 'Angebot zurückgezogen' });
      else if (c.offer.status === 'formal') c.flags.push({ kind: 'bad', text: `Bei der formalen Prüfung ausgeschlossen${c.offer.statusGrund?.trim() ? `: ${c.offer.statusGrund.trim()}` : ''}` });
      else if (c.excluded && b.aufklaerung !== 'unangemessen') c.flags.push({ kind: 'bad', text: 'Ausgeschlossen' });
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

/** Angebote der ersten Runde, die einzeln technisch und wirtschaftlich geprüft werden (engere Wahl): nach Submissionsrang, ohne zurückgezogene und formal ausgeschlossene.
 *  Automatisch die ersten N (Projekteinstellung) und ein abweichend gewählter Zuschlagsempfänger; sonst die von Hand gewählten Angebote (manuell = true). */
export function engereWahl(s: State, cells: Cell[]): { take: Cell[]; ranked: Cell[]; manuell: boolean } {
  if (!cells.length) return { take: [], ranked: [], manuell: false };
  const hr = Math.min(...cells.map((c) => c.offer.runde));
  const ranked = cells.filter((c) => c.offer.runde === hr && c.rankAll && !c.offer.status).sort((a, b) => a.rankAll! - b.rankAll!);
  const losId = cells[0].los.id;
  const wahl = s.engere?.[losId];
  const manuell = wahl ? ranked.filter((c) => wahl.includes(c.offer.id)) : [];
  if (manuell.length) return { take: manuell, ranked, manuell: true };
  const forced = s.zuschlag[losId];
  return { take: ranked.filter((c, i) => i < Math.max(1, s.project.engereWahl) || c.offer.id === forced), ranked, manuell: false };
}

export function zuschlagCell(s: State, los: Los, cells: Cell[]): Cell | undefined {
  const forced = s.zuschlag[los.id];
  const f = forced && cells.find((c) => c.offer.id === forced && c.eligible);
  if (f) return f;
  const fr = finalRound(cells);
  return cells.filter((c) => c.offer.runde === fr).find((c) => c.rank === 1);
}

export interface Auff { // ref = Median der übrigen Bieter
  guenstig: { oz: string; kurz: string; ep: number; ref: number; delta: number }[];
  hoch: { oz: string; kurz: string; ep: number; ref: number; delta: number }[];
  titel: { oz: string; name: string; sum: number; ref: number }[];
}

/** Auffällige Einzelpreise und Titel gegenüber den übrigen Angeboten derselben Runde – dieselbe Regel wie Preisspiegel und Rückfrage
 *  (positionsVergleich): EP weicht um mehr als „abweichung“ % vom Median der übrigen Bieter ab und wirkt sich mit mindestens mindestEuro aus. */
export function auffaelligkeiten(s: State, los: Los, cells: Cell[], c: Cell): Auff {
  const res: Auff = { guenstig: [], hoch: [], titel: [] };
  const peers = vergleichsAngebote(cells, c, []);
  if (!peers.length || !c.complete) return res;
  const min = mindestEuro(cells, c.offer.runde);
  for (const v of positionsVergleich(s, los, cells, c, min)) {
    if (v.status !== 'auffaellig' || v.refQuelle !== 'bieter') continue;
    (v.delta < 0 ? res.guenstig : res.hoch).push({ oz: v.oz, kurz: v.kurz, ep: v.ep, ref: v.ref!, delta: v.delta });
  }
  const th = s.project.abweichung / 100;
  const pm = peerMedian(s, los, cells, c);
  const titel = new Set(losPositions(s, los).filter((p) => !p.bedarf).map((p) => titelKey(p.oz)));
  for (const oz of titel) {
    const me = titelSumme(s, los, c, oz);
    const ref = pm.titel(oz);
    if (ref && me < ref * (1 - th) && ref - me >= 2 * min) res.titel.push({ oz, name: s.titles[oz] ?? '', sum: me, ref });
  }
  res.titel.sort((a, b) => a.sum - a.ref - (b.sum - b.ref));
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

/** Abweichung eines Angebots von den LV-Schätzpreisen: Titel und Positionen außerhalb der Schwelle (Projekteinstellung „abweichung“). */
export interface Angemessen {
  titel: { oz: string; name: string; sum: number; schaetz: number; pct: number; peer: number | null }[]; // pct = Angebot in % des geschätzten Titelpreises; peer = Median der übrigen Angebote
  pos: { oz: string; kurz: string; ep: number; schaetz: number; pct: number; delta: number; peer: number | null }[];
}

/** Titelsumme eines Angebots (ohne Bedarfspositionen). */
const titelSumme = (s: State, los: Los, c: Cell, tk: string) =>
  round2(losPositions(s, los).filter((p) => !p.bedarf && titelKey(p.oz) === tk).reduce((a, p) => a + round2((p.menge ?? 0) * (c.offer.prices[zkey(p.oz)]?.ep ?? 0)), 0));

/** Median der übrigen wertbaren Angebote derselben Runde (EP einer Position bzw. Summe eines Titels); null ohne Vergleichsangebote. */
function peerMedian(s: State, los: Los, cells: Cell[], c: Cell) {
  const peers = vergleichsAngebote(cells, c, []);
  const ep = (oz: string) => { const v = peers.map((x) => x.offer.prices[zkey(oz)]?.ep).filter((e): e is number => e != null); return v.length ? median(v) : null; };
  const titel = (tk: string) => (peers.length ? median(peers.map((x) => titelSumme(s, los, x, tk))) : null);
  return { ep, titel };
}

export function angemessenheit(s: State, los: Los, c: Cell, cells: Cell[] = []): Angemessen {
  const res: Angemessen = { titel: [], pos: [] };
  if (!c.complete || !Object.keys(s.schaetz ?? {}).length) return res;
  const th = s.project.abweichung / 100;
  const min = mindestEuro(cells, c.offer.runde);
  const t = new Map<string, { me: number; sch: number }>();
  const pm = peerMedian(s, los, cells, c);
  for (const p of losPositions(s, los)) {
    if (p.bedarf) continue;
    const me = c.offer.prices[zkey(p.oz)]?.ep;
    const sch = s.schaetz[zkey(p.oz)];
    if (me == null || sch == null) continue;
    const m = p.menge ?? 0;
    const tk = titelKey(p.oz);
    const x = t.get(tk) ?? { me: 0, sch: 0 };
    x.me += round2(m * me); x.sch += round2(m * sch);
    t.set(tk, x);
    if (sch <= 0) continue;
    const delta = round2(m * (me - sch));
    // nur Positionen mit spürbarer Auswirkung (wie im Preisspiegel und in der Rückfrage)
    if (Math.abs(delta) < min) continue;
    if (me > sch * (1 + th) || me < sch * (1 - th)) res.pos.push({ oz: p.oz, kurz: p.kurz, ep: me, schaetz: sch, pct: (me / sch) * 100, delta, peer: pm.ep(p.oz) });
  }
  for (const [oz, x] of t) {
    if (x.sch <= 0 || Math.abs(x.me - x.sch) < 2 * min) continue;
    if (x.me > x.sch * (1 + th) || x.me < x.sch * (1 - th)) res.titel.push({ oz, name: s.titles[oz] ?? '', sum: round2(x.me), schaetz: round2(x.sch), pct: (x.me / x.sch) * 100, peer: pm.titel(oz) });
  }
  res.titel.sort((a, b) => a.oz.localeCompare(b.oz, 'de', { numeric: true }));
  res.pos.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return res;
}

/** Prüfzeile der Vollständigkeitsprüfung zu einem Formblatt (z. B. „233“). */
export const unterlageZeile = (s: State, nr: string) => s.unterlagen.find((u) => new RegExp(`\\b${nr}\\b`).test(u.label));

/**
 * Nachunternehmer eines Angebots: von Hand bzw. von der KI erfasste Liste, sonst aus den handschriftlichen Eintragungen
 * im VVB 233 (Befunde älterer Prüfungen). `undefined` = unbekannt (kein VVB 233 geprüft).
 */
export function nuOf(s: State, o: Offer): Nachunternehmer[] | undefined {
  if (o.nu) return o.nuQuelle === 'user' ? o.nu : nuZusammen(o.nu);
  const ki = (o.kiDocs ?? []).flatMap((k) => k.nachunternehmer ?? []);
  if (ki.length) return nuZusammen(ki);
  const z = unterlageZeile(s, '233');
  const docs = (o.kiDocs ?? []).filter((k) => (z && k.zeilen?.includes(z.id)) || /\b233\b|Nachunternehmer/i.test(k.art));
  if (!docs.length) return undefined;
  const out = docs.flatMap((k) => nuAusHandschrift(Array.isArray(k.handschrift) ? k.handschrift : []));
  if (out.length) return out;
  return docs.every((k) => k.inhalt === 'leer' || k.vorlage) ? [] : undefined;
}

/** Erste Wörter des Firmennamens, klein („Luhs & Voigt Inh. …“ und „Luhs & Voigt“ gelten als dasselbe Unternehmen). */
const firmaKey = (f: string) => f.toLowerCase().replace(/^(fa\.|firma)\s*/, '').replace(/[^a-zäöüß0-9&]+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
const gleicheFirma = (a: string, b: string) => { const x = firmaKey(a), y = firmaKey(b); return !!x && !!y && (x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `)); };
const leistungKey = (l: string) => l.toLowerCase().replace(/[^a-zäöüß0-9]+/g, '');

/**
 * Dasselbe Unternehmen für dieselbe Teilleistung steht oft in VVB 233 (Nachunternehmer) und VVB 235 (Kapazitäten) –
 * das ist eine Angabe, keine zwei: zusammenführen (Werte aus 233, Art „beide“). Doppelte Zeilen fallen weg.
 */
export function nuZusammen(liste: Nachunternehmer[]): Nachunternehmer[] {
  const out: Nachunternehmer[] = [];
  for (const n of [...liste].sort((a, b) => Number(a.art === 'kapazitaet') - Number(b.art === 'kapazitaet'))) {
    const x = out.find((y) => gleicheFirma(y.firma, n.firma) && leistungKey(y.leistung) === leistungKey(n.leistung));
    if (!x) { out.push({ ...n }); continue; }
    if ((x.art ?? 'nu') !== (n.art ?? 'nu')) x.art = 'beide';
    if (!x.oz.trim()) x.oz = n.oz;
    if (!x.pq?.trim() && n.pq?.trim()) x.pq = n.pq;
  }
  return out;
}

/** Zeilen der Tabelle im VVB 233 aus der Handschrift (Feld „OZ/Leistungsbereich“, „Beschreibung …“, „Name des Unternehmens“). */
export function nuAusHandschrift(hs: HsEintrag[]): Nachunternehmer[] {
  const out: Nachunternehmer[] = [];
  let cur: Nachunternehmer | null = null;
  const put = (k: 'oz' | 'leistung' | 'firma', v: string) => {
    if (!cur || cur[k]) { cur = { oz: '', leistung: '', firma: '' }; out.push(cur); }
    cur[k] = k === 'firma' ? v.replace(/^(Fa\.|Firma)\s*/i, '') : v;
  };
  for (const e of hs) {
    const f = e.feld;
    if (/OZ|Leistungsbereich/i.test(f)) put('oz', e.wert);
    else if (/Name|Unternehm|Firma/i.test(f)) put('firma', e.wert);
    else if (/Beschreib|Teilleist|Leistung/i.test(f)) put('leistung', e.wert);
  }
  return out.filter((n) => n.firma || n.leistung);
}

/** Eignungsnachweis eines Angebots: Präqualifikation oder Eigenerklärung (VVB 124) laut Vollständigkeitsprüfung. */
/** Formblatt über Nachunternehmer bzw. andere Unternehmen (VVB 233/235) – dort genannte PQ-Nummern gehören nicht dem Bieter. */
export const istNuDok = (k: { art: string; nachunternehmer?: unknown[] }) => !!k.nachunternehmer?.length || /\b23[35]\b|nachunternehmer|kapazit|anderer unternehmen/i.test(k.art);

/** Hat die KI die PQ-Nummer aus einem Formblatt 233/235 gelesen (ältere Prüfungen)? Dann gehört sie einem anderen Unternehmen. */
export function pqFremd(o: Offer): boolean {
  if (!o.pqQuelle || !o.pq?.trim()) return false;
  const k = (o.kiDocs ?? []).find((x) => x.datei.split('/').pop() === o.pqQuelle);
  return !!k && istNuDok(k);
}

/** PQ-Nummer des Bieters selbst (ohne Nummern anderer Unternehmen). */
export const bieterPq = (o: Offer) => (pqFremd(o) ? '' : o.pq?.trim() ?? '');

export function eignungsNachweis(s: State, o: Offer): 'pq' | '124' | null {
  if (bieterPq(o)) return 'pq';
  const z = unterlageZeile(s, '124');
  const p = z && o.pruef?.[z.id];
  return p && (p.s === 'ok' || p.s === 'nach') ? '124' : null;
}

/** Bewertung einer Position für die Rückfrage:
 *  auffaellig = EP weicht deutlich vom Vergleichspreis ab und wirkt sich spürbar auf die Angebotssumme aus;
 *  gering = weicht deutlich ab, aber mit geringer Auswirkung; schaetz = der Bieter liegt bei den übrigen Bietern, nur unser
 *  LV-Schätzpreis weicht ab (eher Schätzung prüfen); ok = unauffällig. */
export type AufklStatus = 'auffaellig' | 'gering' | 'schaetz' | 'ok';

/** Position im Vergleich: ref = Median der EP der übrigen Bieter (sonst LV-Schätzpreis), delta = Mehr-/Minderkosten ggü. ref (Menge × EP-Differenz). */
export interface AufklPos {
  oz: string; kurz: string; menge: number; einheit: string;
  ep: number; gp: number; peer: number | null; schaetz: number | null;
  ref: number | null; refQuelle: 'bieter' | 'schaetz' | null; pct: number | null; delta: number; status: AufklStatus;
}

const median = (v: number[]) => { const a = [...v].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/** Übrige Angebote derselben Runde als Vergleich (vollständig, nicht ausgeschlossen, nicht in „ohne“). */
const vergleichsAngebote = (cells: Cell[], c: Cell, ohne: string[]) => cells.filter((x) => x !== c && x.offer.runde === c.offer.runde && x.complete && !x.excluded && !ohne.includes(x.offer.id));

/** Mindestauswirkung je Position (Menge × EP-Differenz), ab der eine Abweichung überall als auffällig gilt – Preisspiegel, Wertung,
 *  Vermerk und Rückfrage: 0,5 % der mittleren Angebotssumme der Runde, mindestens 250 €, auf 50 € gerundet. Titel: das Doppelte. */
export function mindestEuro(cells: Cell[], runde: number): number {
  const sums = cells.filter((c) => c.offer.runde === runde && c.complete && c.sumNet).map((c) => c.sumNet!);
  return sums.length ? Math.max(250, Math.round((median(sums) * 0.005) / 50) * 50) : 250;
}

/** Alle bepreisten Positionen eines Angebots mit Vergleich, nach Auswirkung (|delta|) absteigend.
 *  Vergleichspreis ist der Median der übrigen Bieter (robust gegen einzelne Ausreißer); nur ohne übrige Bieter der LV-Schätzpreis.
 *  Liegt der Bieter beim LV-Schätzpreis, die übrigen aber nicht, ist die Position nicht auffällig; liegt er bei den übrigen und nur
 *  der Schätzpreis weicht ab, wird sie als „schaetz“ markiert. ohne = Angebote, die nicht als Vergleich dienen (Ausschluss empfohlen). */
export function positionsVergleich(s: State, los: Los, cells: Cell[], c: Cell, minEuro: number, ohne: string[] = []): AufklPos[] {
  if (!c.complete) return [];
  const peers = vergleichsAngebote(cells, c, ohne);
  const th = s.project.abweichung / 100;
  const weicht = (ep: number, r: number | null) => r != null && r > 0 && Math.abs(ep / r - 1) > th;
  const out: AufklPos[] = [];
  for (const p of losPositions(s, los)) {
    if (p.bedarf) continue;
    const ep = c.offer.prices[zkey(p.oz)]?.ep;
    if (ep == null) continue;
    const menge = p.menge ?? 0;
    const pe = peers.map((x) => x.offer.prices[zkey(p.oz)]?.ep).filter((v): v is number => v != null);
    const peer = pe.length ? median(pe) : null;
    const sch = s.schaetz?.[zkey(p.oz)] ?? null;
    const schaetz = sch != null && sch > 0 ? sch : null;
    const ref = peer != null && peer > 0 ? peer : schaetz;
    const refQuelle = ref == null ? null : ref === peer ? 'bieter' : 'schaetz';
    const delta = ref == null ? 0 : round2(menge * (ep - ref));
    let status: AufklStatus = 'ok';
    if (weicht(ep, ref)) {
      // Bieter liegt bei unserem Schätzpreis, nur die übrigen weichen ab → kein Anlass zur Rückfrage bei diesem Bieter
      const beiSchaetz = refQuelle === 'bieter' && schaetz != null && !weicht(ep, schaetz);
      if (!beiSchaetz) status = Math.abs(delta) >= minEuro ? 'auffaellig' : 'gering';
    } else if (refQuelle === 'bieter' && weicht(ep, schaetz) && Math.abs(menge * (ep - schaetz!)) >= minEuro) status = 'schaetz';
    out.push({ oz: p.oz, kurz: p.kurz, menge, einheit: p.einheit, ep, gp: round2(menge * ep), peer, schaetz, ref, refQuelle, pct: ref ? (ep / ref - 1) * 100 : null, delta, status });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
