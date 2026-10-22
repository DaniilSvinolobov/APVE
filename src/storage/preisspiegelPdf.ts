/**
 * Preisspiegel als PDF (A4 quer), vollständig im Browser erzeugt (pdf-lib, Schrift Inter wie in der Oberfläche).
 * Aufbau nach dem üblichen Preisspiegel: Deckblatt, je Position EP / GP / Abweichung, Titelsummen, Gesamtsummen.
 * Farben und Markierungen entsprechen der Bildschirmansicht (günstigster EP grün, höchster EP violett kursiv, Ausreißer orange).
 */
import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit'; // WOFF statt WOFF2: fontkit kann WOFF2 nicht als Teilmenge einbetten
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import type { Los, LvPos, State } from '../domain/types';
import { computeLos, losPositions, lvFremd, schaetzSumme, titelKey, zkey, zusatzWert, type Cell } from '../domain/calc';
import { fmtDate, fmtDateTime, fmtEur, fmtNum, fmtPct, round2 } from '../domain/fmt';

export type Basis = 'min' | 'schaetz' | 'beide';
type BK = 'min' | 'sch';
type RK = 'avg' | 'min' | 'sch';

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
/** Farben aus styles.css */
const C = {
  ink: hex('#18202f'), muted: hex('#667085'), faint: hex('#98a2b3'), line: hex('#e4e8f0'), line2: hex('#eef1f6'),
  brand: hex('#2f5bea'), brandL: hex('#eaf0ff'), head: hex('#f8f9fc'), ref: hex('#f9fafc'), titel: hex('#f6f8fc'),
  okL: hex('#e3f6ee'), ok: hex('#067a53'), okB: hex('#9ad9bf'), high: hex('#7c3aed'), highL: hex('#f3edff'), highB: hex('#c4b5fd'),
  warn: hex('#b76e00'), amber: hex('#f59e0b'), warnL: hex('#fff3dc'), blue: hex('#3b82f6'), neu: hex('#f8f5ff'), neuK: hex('#f1ebff'), neuT: hex('#6d28d9'),
  bedarf: hex('#f6f7fb'), white: rgb(1, 1, 1), bad: hex('#d92d20'),
};

const PW = 841.89, PH = 595.28, M = 30;
const TOP = PH - 34, BOTTOM = 40;

interface Fonts { r: PDFFont; m: PDFFont; s: PDFFont; b: PDFFont }

const clean = (t: string) => (t ?? '').replace(/\s+/g, ' ').trim();

function fit(t: string, f: PDFFont, size: number, w: number) {
  t = clean(t);
  if (f.widthOfTextAtSize(t, size) <= w) return t;
  while (t.length > 1 && f.widthOfTextAtSize(t + '…', size) > w) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function wrap(t: string, f: PDFFont, size: number, w: number, max = 99): string[] {
  const words = clean(t).split(' ').filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const wd of words) {
    const nx = cur ? cur + ' ' + wd : wd;
    if (f.widthOfTextAtSize(nx, size) <= w || !cur) cur = nx;
    else { out.push(cur); cur = wd; }
  }
  if (cur) out.push(cur);
  if (out.length > max) { const rest = out.slice(max - 1).join(' '); out.length = max - 1; out.push(fit(rest, f, size, w)); }
  return out.map((l) => fit(l, f, size, w));
}

interface TOpt { f?: PDFFont; size?: number; color?: RGB; align?: 'l' | 'r' | 'c'; w?: number; italic?: boolean }

export async function downloadPreisspiegelPdf(s: State, los: Los, rd: number, basis: Basis) {
  const bytes = await preisspiegelPdf(s, los, rd, basis);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Preisspiegel_${los.nr}_Runde${rd}.pdf`.replace(/[\\/:*?"<>|]+/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function preisspiegelPdf(s: State, los: Los, rd: number, basis: Basis): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const load = async (u: string) => doc.embedFont(await (await fetch(u)).arrayBuffer(), { subset: true });
  const [r, m, sb, b] = await Promise.all([inter400, inter500, inter600, inter700].map(load));
  const F: Fonts = { r, m, s: sb, b };
  const p = s.project;
  doc.setTitle(`Preisspiegel ${los.nr} ${los.name}`.trim());
  doc.setAuthor(p.ersteller || p.vergabestelle || '');
  doc.setSubject(p.titel || '');
  doc.setCreator('Angebotsauswertung – Preisspiegel & Vergabeempfehlung');

  /* ---------- Daten (wie StepPreisspiegel) ---------- */
  const cells = computeLos(s, los).filter((c) => c.offer.runde === rd);
  const pos = losPositions(s, los);
  const hasLv = pos.length > 0;
  const th = p.abweichung / 100;
  const mw = 1 + p.mwst / 100;
  const hasSch = Object.keys(s.schaetz ?? {}).length > 0;
  const bases: BK[] = (basis === 'beide' ? ['min', 'sch'] as BK[] : basis === 'schaetz' ? ['sch'] as BK[] : ['min'] as BK[]).filter((k) => k === 'min' || hasSch);
  const valid = cells.filter((c) => c.complete && !c.excluded);
  const groups = new Map<string, LvPos[]>();
  for (const x of pos) { const k = titelKey(x.oz); groups.set(k, [...(groups.get(k) ?? []), x]); }

  const epOf = (c: Cell, oz: string) => c.offer.prices[zkey(oz)]?.ep ?? null;
  const avgOf = (v: number[]) => (v.length ? round2(v.reduce((a, x) => a + x, 0) / v.length) : null);
  const minOf = (v: number[]) => (v.length ? Math.min(...v) : null);
  const gpOf = (x: LvPos, ep: number | null) => (ep == null ? null : round2((x.menge ?? 0) * ep));
  const pct = (v: number | null, ref: number | null) => (v == null || ref == null || ref <= 0 || v <= 0 ? null : (v / ref - 1) * 100);
  const peerStats = (oz: string) => {
    const v = valid.map((c) => epOf(c, oz)).filter((x): x is number => x != null && x > 0);
    return { low: v.length > 1 ? Math.min(...v) : null, high: v.length > 1 ? Math.max(...v) : null };
  };
  const isOut = (c: Cell, oz: string) => {
    const me = epOf(c, oz);
    const others = cells.filter((x) => x !== c && x.complete && !x.excluded).map((x) => epOf(x, oz)).filter((x): x is number => x != null && x > 0);
    if (me == null || me <= 0 || others.length < 2) return false;
    return Math.abs(me / (others.reduce((a, x) => a + x, 0) / others.length) - 1) > th;
  };
  const refEp = (oz: string) => {
    const v = valid.map((c) => epOf(c, oz)).filter((x): x is number => x != null && x > 0);
    return { avg: avgOf(v), min: minOf(v), sch: s.schaetz?.[zkey(oz)] ?? null } as Record<RK, number | null>;
  };
  const titelSum = (c: Cell, ps: LvPos[]) => round2(ps.filter((x) => !x.bedarf).reduce((a, x) => a + (x.menge ?? 0) * (epOf(c, x.oz) ?? 0), 0));
  const refTot = (k: RK, f: (c: Cell) => number | null): number | null => {
    if (k === 'sch') return schaetzSumme(s, los);
    const v = valid.map(f).filter((x): x is number => x != null && x > 0);
    return k === 'avg' ? avgOf(v) : minOf(v);
  };
  const totNet = { min: refTot('min', (c) => c.net), sch: refTot('sch', (c) => c.net) };
  const nlBetrag = (c: Cell) => (c.sumNet != null && c.net != null ? round2(c.sumNet - c.net) : null);
  const skontoOf = (c: Cell) => (c.offer.skonto && c.gross != null ? round2((c.gross * c.offer.skonto) / 100) : null);
  const hasSkonto = cells.some((c) => c.offer.skonto);
  /** Abweichungen als Textzeilen (eine je gewählter Basis; bei beiden mit Kürzel G/LV) */
  const pctLines = (v: number | null, to: Partial<Record<BK, number | null>>, skip?: RK) =>
    bases.filter((k) => k !== skip).map((k) => [k, pct(v, to[k] ?? null)] as const)
      .filter((x): x is readonly [BK, number] => x[1] != null && Math.abs(x[1]) >= 0.05)
      .map(([k, d]) => (bases.length > 1 ? (k === 'min' ? 'G ' : 'LV ') : '') + fmtPct(d));

  /* Zusätzliche Positionen (nicht im LV), gleiche Texte verschiedener Bieter in einer Zeile */
  const normTxt = (t: string) => t.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
  const zRows = new Map<string, { oz: string; kurz: string; einheit: string; menge: number | null; per: Map<string, Cell['zusatz'][number]> }>();
  for (const c of cells) for (const z of c.zusatz) {
    const k = z.kurz && normTxt(z.kurz) ? `${normTxt(z.kurz)}|${z.einheit}` : `${c.offer.id}|${z.oz}`;
    const row = zRows.get(k) ?? { oz: z.oz, kurz: z.kurz, einheit: z.einheit, menge: z.menge, per: new Map() };
    row.per.set(c.offer.id, z);
    zRows.set(k, row);
  }
  const zList = [...zRows.values()];
  const zSum = (c: Cell) => round2(c.zusatz.filter((z) => !z.bedarf).reduce((a, z) => a + zusatzWert(z), 0));

  const refs: { k: RK; l: string; sub: string }[] = hasLv
    ? [{ k: 'avg', l: 'Ø Bieter', sub: 'gewertete Bieter' }, { k: 'min', l: 'Günstigst', sub: 'gewertete Bieter' }, ...(hasSch ? [{ k: 'sch' as RK, l: 'LV-Schätzpreis', sub: 'eigenes LV' }] : [])]
    : [];
  const rundeTxt = rd === 1 ? 'Hauptangebote' : `Nachverhandlung${rd > 2 ? ' ' + (rd - 1) : ''}`;
  const heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const projTxt = [p.nummer, p.titel].filter(Boolean).join(' · ') || 'Preisspiegel';
  const losTxt = `${los.nr}${los.name ? ' – ' + los.name : ''}`;

  /* ---------- Zeichenhilfen ---------- */
  const T = (pg: PDFPage, t: string, x: number, y: number, o: TOpt = {}) => {
    const f = o.f ?? F.r, size = o.size ?? 7.5;
    let txt = clean(t);
    if (!txt) return;
    if (o.w) txt = fit(txt, f, size, o.w);
    const w = f.widthOfTextAtSize(txt, size);
    const xx = o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x;
    pg.drawText(txt, { x: xx, y, size, font: f, color: o.color ?? C.ink });
  };
  const box = (pg: PDFPage, x: number, y: number, w: number, h: number, fill?: RGB, border?: RGB, bw = 0.5) =>
    pg.drawRectangle({ x, y, width: w, height: h, ...(fill ? { color: fill } : {}), ...(border ? { borderColor: border, borderWidth: bw } : {}) });
  const rbox = (pg: PDFPage, x: number, y: number, w: number, h: number, rad: number, fill?: RGB, border?: RGB, bw = 0.6) => {
    const r0 = Math.min(rad, h / 2, w / 2);
    const d = `M ${r0} 0 H ${w - r0} Q ${w} 0 ${w} ${r0} V ${h - r0} Q ${w} ${h} ${w - r0} ${h} H ${r0} Q 0 ${h} 0 ${h - r0} V ${r0} Q 0 0 ${r0} 0 Z`;
    pg.drawSvgPath(d, { x, y: y + h, ...(fill ? { color: fill } : {}), ...(border ? { borderColor: border, borderWidth: bw } : {}) });
  };
  const hline = (pg: PDFPage, x1: number, x2: number, y: number, c = C.line, t = 0.5) => pg.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: t, color: c });
  const vline = (pg: PDFPage, x: number, y1: number, y2: number, c = C.line, t = 0.5) => pg.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: t, color: c });
  /** Zahl rechtsbündig, notfalls kleiner gesetzt, damit sie in die Spalte passt */
  const num = (pg: PDFPage, t: string, xr: number, y: number, w: number, o: TOpt = {}) => {
    const f = o.f ?? F.r;
    let size = o.size ?? 7.5;
    while (size > 5.5 && f.widthOfTextAtSize(t, size) > w) size -= 0.25;
    if (o.italic) skew(pg, t, xr - f.widthOfTextAtSize(t, size), y, f, size, o.color ?? C.ink);
    else T(pg, t, xr, y, { ...o, size, align: 'r' });
  };
  /** Inter liegt nur aufrecht vor – „kursiv“ (höchster EP) über Schrägstellung */
  const skew = (pg: PDFPage, t: string, x: number, y: number, f: PDFFont, size: number, color: RGB) =>
    pg.drawText(t, { x: x - 0.8, y, size, font: f, color, xSkew: degrees(0), ySkew: degrees(12) });
  const chip = (pg: PDFPage, t: string, x: number, y: number, kind: 'ok' | 'info' | 'warn' | 'bad', align: 'l' | 'r' = 'l') => {
    const size = 6.5, w = F.s.widthOfTextAtSize(t, size) + 8;
    const bg = kind === 'ok' ? C.okL : kind === 'warn' ? C.warnL : kind === 'bad' ? hex('#fde8e6') : C.line2;
    const fg = kind === 'ok' ? C.ok : kind === 'warn' ? C.warn : kind === 'bad' ? C.bad : hex('#475467');
    const xx = align === 'r' ? x - w : x;
    rbox(pg, xx, y - 2.5, w, 10, 5, bg);
    T(pg, t, xx + 4, y, { f: F.s, size, color: fg });
    return w;
  };

  /* ---------- Deckblatt ---------- */
  const pages: PDFPage[] = [];
  const cover = doc.addPage([PW, PH]);
  pages.push(cover);
  {
    const pg = cover;
    const lx = M + 6, rx = 430, rw = PW - M - rx;
    T(pg, projTxt, lx, TOP, { f: F.s, size: 9, color: C.muted, w: 380 });
    T(pg, 'Preisspiegel', lx, PH - 120, { f: F.b, size: 34, color: C.ink });
    T(pg, `Angebotsprüfung · ${rundeTxt}`, lx, PH - 140, { f: F.m, size: 11, color: C.muted });
    rbox(pg, lx, PH - 156, 34, 4, 2, C.brand);
    let ly = PH - 190;
    for (const l of wrap(p.titel || 'Ohne Projektbezeichnung', F.s, 14, 360, 3)) { T(pg, l, lx, ly, { f: F.s, size: 14 }); ly -= 18; }
    for (const l of wrap(losTxt, F.r, 11, 360, 2)) { T(pg, l, lx, ly - 2, { size: 11, color: C.muted }); ly -= 15; }
    ly -= 14;
    if (s.logo && /^data:image\/(png|jpe?g);base64,/.test(s.logo)) {
      try {
        const img = /png/.test(s.logo.slice(0, 20)) ? await doc.embedPng(s.logo) : await doc.embedJpg(s.logo);
        const sc = Math.min(200 / img.width, 70 / img.height, 1);
        pg.drawImage(img, { x: lx, y: ly - img.height * sc, width: img.width * sc, height: img.height * sc });
        ly -= img.height * sc + 14;
      } catch { /* Logo nicht einbettbar – ohne Logo weiter */ }
    }
    const adr = [p.ersteller, p.vergabestelle && p.vergabestelle !== p.ersteller ? p.vergabestelle : '', p.ort].filter(Boolean);
    if (adr.length) {
      T(pg, 'AUFGESTELLT VON', lx, ly, { f: F.s, size: 6.5, color: C.faint });
      ly -= 13;
      for (const a of adr) for (const l of wrap(a, F.r, 9.5, 340, 3)) { T(pg, l, lx, ly, { size: 9.5 }); ly -= 13; }
    }

    /* Ergebnis-Kurzfassung */
    const best = cells.find((c) => c.rank === 1);
    const ey = BOTTOM + 40;
    if (best) {
      rbox(pg, lx, ey, 360, 56, 8, C.okL, C.okB);
      T(pg, 'GÜNSTIGSTES WERTBARES ANGEBOT', lx + 12, ey + 40, { f: F.b, size: 6.5, color: C.ok });
      T(pg, `Nr. ${best.offer.nr} · ${best.offer.firma}`, lx + 12, ey + 24, { f: F.s, size: 11, w: 240 });
      T(pg, fmtEur(best.net), lx + 348, ey + 24, { f: F.b, size: 12, align: 'r' });
      T(pg, `netto inkl. Nachlass · ${valid.length} von ${cells.length} Angebot(en) gewertet`, lx + 12, ey + 10, { size: 7.5, color: C.muted, w: 330 });
    }

    /* Felder rechts */
    const field = (label: string, lines: string[], x: number, y: number, w: number, h: number) => {
      rbox(pg, x, y - h, w, h, 6, C.white, C.line, 0.8);
      T(pg, label.toUpperCase(), x + 9, y - 12, { f: F.s, size: 6.2, color: C.faint, w: w - 18 });
      let yy = y - 26;
      lines.forEach((l, i) => { T(pg, l || 'k. A.', x + 9, yy, { f: i === 0 ? F.s : F.r, size: 9.5, color: l ? C.ink : C.faint, w: w - 18 }); yy -= 12.5; });
    };
    const half = (rw - 8) / 2;
    let y = TOP + 6;
    const projLines = [p.nummer, ...wrap(p.titel, F.r, 9.5, rw - 18, 2)].filter(Boolean);
    field('Projekt', projLines.length ? projLines : [''], rx, y, rw, 20 + Math.max(1, projLines.length) * 12.5 + 4); y -= 20 + Math.max(1, projLines.length) * 12.5 + 4 + 8;
    if (p.auftraggeber) { field('Auftraggeber', [p.auftraggeber], rx, y, rw, 36); y -= 44; }
    field('Leistung (Los)', [los.nr, ...wrap(los.name, F.r, 9.5, rw - 18, 2)], rx, y, rw, 50); y -= 58;
    field('Ausführungsbeginn', [clean(p.beginn)], rx, y, half, 36);
    field('Ausführungsende', [clean(p.ende)], rx + half + 8, y, half, 36); y -= 44;
    field('Eröffnung', [p.eroeffnung ? fmtDateTime(p.eroeffnung) : ''], rx, y, half, 36);
    field('Zuschlagsfrist', [p.zuschlagsfrist ? fmtDate(p.zuschlagsfrist) : ''], rx + half + 8, y, half, 36); y -= 44;
    field('MwSt.', [`${fmtNum(p.mwst)} %`], rx, y, half, 36);
    field('Währung', ['EUR'], rx + half + 8, y, half, 36); y -= 44;
    /* Prüfvermerk mit Unterschriftszeile */
    const sh = Math.max(70, y - (BOTTOM + 40));
    rbox(pg, rx, y - sh, rw, sh, 6, C.white, C.line, 0.8);
    T(pg, 'ANGEBOTSPRÜFUNG', rx + 9, y - 12, { f: F.s, size: 6.2, color: C.faint });
    T(pg, 'Alle Angebote wurden erfasst, rechnerisch geprüft und ausgewertet.', rx + 9, y - 26, { size: 8.5, w: rw - 18 });
    hline(pg, rx + 9, rx + rw - 9, y - sh + 22, C.muted, 0.6);
    T(pg, `Ort, Datum, Unterschrift${p.unterzeichner ? ' – ' + p.unterzeichner : ''}`, rx + 9, y - sh + 11, { size: 7, color: C.muted, w: rw - 18 });
  }

  /* ---------- Tabellenseiten ---------- */
  const avail = PW - 2 * M;
  const WM = hasLv ? 48 : 0;
  const MINC = 62, MAXC = 104;
  const maxBid = Math.max(1, Math.floor((avail - (hasLv ? 200 : 240) - WM) / MINC) - refs.length);
  const chunks: Cell[][] = [];
  for (let i = 0; i < cells.length; i += maxBid) chunks.push(cells.slice(i, i + maxBid));
  if (!chunks.length) chunks.push([]);

  const LH = 9; // Zeilenhöhe innerhalb einer Positionszeile
  const npct = bases.length;

  let lastY = 0;
  chunks.forEach((cs, ci) => {
    const ncol = refs.length + cs.length;
    const cw = ncol ? Math.min(MAXC, (avail - (hasLv ? 200 : 240) - WM) / ncol) : 0;
    const WD = avail - WM - ncol * cw;
    const x0 = M, xm = M + WD, xd = xm + WM;
    const colX = (i: number) => xd + i * cw;
    const cols: ({ ref: RK; l: string; sub: string } | { cell: Cell })[] = [...refs.map((x) => ({ ref: x.k, l: x.l, sub: x.sub })), ...cs.map((c) => ({ cell: c }))];
    let pg!: PDFPage;
    let y = 0;
    const header = () => {
      pg = doc.addPage([PW, PH]);
      pages.push(pg);
      T(pg, projTxt, M, TOP, { f: F.s, size: 9, color: C.muted, w: 420 });
      /* Legende oben rechts */
      const leg: [string, 'low' | 'high' | 'out' | 'mabw' | 'neu'][] = [['günstigster EP', 'low'], ['höchster EP', 'high'], [`Ausreißer > ${fmtNum(p.abweichung, 0)} %`, 'out']];
      if (cs.some((c) => c.mengeAbw.length)) leg.push(['Menge weicht ab', 'mabw']);
      if (zList.length) leg.push(['neu (nicht im LV)', 'neu']);
      let lx = PW - M;
      for (const [t, k] of [...leg].reverse()) {
        const w = F.r.widthOfTextAtSize(t, 7);
        lx -= w;
        T(pg, t, lx, TOP, { size: 7, color: C.muted });
        lx -= 13;
        if (k === 'low') rbox(pg, lx, TOP - 1.5, 9, 9, 2, C.okL, C.okB);
        else if (k === 'high') rbox(pg, lx, TOP - 1.5, 9, 9, 2, C.highL, C.highB);
        else if (k === 'out') pg.drawCircle({ x: lx + 5, y: TOP + 3, size: 2.6, color: C.amber });
        else if (k === 'mabw') box(pg, lx + 4, TOP - 1.5, 2, 9, C.blue);
        else rbox(pg, lx, TOP - 1.5, 9, 9, 2, hex('#ede5ff'), C.highB);
        lx -= 12;
      }
      T(pg, 'Preisspiegel', M, TOP - 26, { f: F.b, size: 17 });
      const sx = M + F.b.widthOfTextAtSize('Preisspiegel', 17) + 12;
      T(pg, losTxt, sx, TOP - 18, { f: F.s, size: 9, w: PW - M - sx });
      T(pg, `${rundeTxt}${chunks.length > 1 ? ` · Bieter ${ci * maxBid + 1}–${ci * maxBid + cs.length} von ${cells.length}` : ''}${bases.length ? ` · Abweichung in % ${bases.map((k) => (k === 'min' ? 'zum Günstigsten' : 'zum LV-Schätzpreis')).join(' und ')}` : ''}`, sx, TOP - 29, { size: 7.5, color: C.muted, w: PW - M - sx });
      /* Tabellenkopf */
      const hy = TOP - 42, hh = 36;
      rbox(pg, x0, hy - hh, avail, hh, 5, C.head, C.line, 0.6);
      cols.forEach((c, i) => {
        const x = colX(i);
        if ('ref' in c) box(pg, x, hy - hh + 0.3, cw, hh - 0.6, C.ref);
        vline(pg, x, hy - hh, hy);
      });
      if (hasLv) vline(pg, xm, hy - hh, hy);
      T(pg, hasLv ? 'Pos. / Leistung' : 'Position', x0 + 7, hy - 12, { f: F.s, size: 7.5, color: C.muted });
      if (hasLv) { T(pg, 'Menge', xm + WM / 2, hy - 12, { f: F.s, size: 7, color: C.muted, align: 'c' }); T(pg, 'Einheit', xm + WM / 2, hy - 22, { size: 6.5, color: C.faint, align: 'c' }); }
      if (hasLv) T(pg, `je Position: EP · GP${npct ? ' · Abweichung' : ''} (€ netto)`, x0 + 7, hy - 22, { size: 6.5, color: C.faint, w: WD - 14 });
      cols.forEach((c, i) => {
        const x = colX(i) + 5, w = cw - 10;
        if ('ref' in c) {
          T(pg, c.sub, x, hy - 11, { size: 6.2, color: C.faint, w });
          T(pg, c.l, x, hy - 21, { f: F.s, size: 7.5, color: C.muted, w });
        } else {
          const o = c.cell.offer, dim = c.cell.excluded;
          T(pg, `Nr. ${o.nr}${dim ? ' · ausgeschl.' : ''}`, x, hy - 11, { size: 6.2, color: dim ? C.bad : C.faint, w });
          wrap(o.firma || '–', F.s, 7.5, w, 2).forEach((l, j) => T(pg, l, x, hy - 21 - j * 9, { f: F.s, size: 7.5, color: dim ? C.faint : C.ink }));
        }
      });
      y = hy - hh;
    };
    const need = (h: number) => { if (y - h < BOTTOM + 6) header(); };
    /** Spaltenraster einer Zeile zeichnen */
    const grid = (top: number, h: number, fill?: RGB, refFill = true) => {
      if (fill) box(pg, x0, top - h, avail, h, fill);
      cols.forEach((c, i) => { if ('ref' in c && refFill && !fill) box(pg, colX(i), top - h, cw, h, C.ref); vline(pg, colX(i), top - h, top); });
      if (hasLv) vline(pg, xm, top - h, top);
      vline(pg, x0, top - h, top); vline(pg, x0 + avail, top - h, top);
      hline(pg, x0, x0 + avail, top - h, C.line2);
    };
    const colTxt = (c: Cell, dim: RGB) => (c.excluded ? C.faint : dim);

    header();

    /* Titel und Positionen */
    if (hasLv) {
      for (const [k, ps] of groups) {
        const allSums = cells.map((c) => titelSum(c, ps));
        const min = Math.min(...allSums.filter((x) => x > 0));
        const vs = allSums.filter((x, i) => x > 0 && valid.includes(cells[i]));
        const max = vs.length > 1 ? Math.max(...vs) : null;
        const tr = { avg: avgOf(vs), min: minOf(vs), sch: schaetzSumme(s, los, k) } as Record<RK, number | null>;
        const th0 = 12 + Math.max(1, npct) * LH;
        const firstH = ps[0] ? posH(ps[0]) : 0;
        need(th0 + firstH);
        const top = y;
        grid(top, th0, C.titel);
        hline(pg, x0, x0 + avail, top, C.line, 0.7);
        const tname = s.titles[k] || `Titel ${k}`;
        T(pg, k, x0 + 7, top - 11, { f: F.s, size: 8, color: C.muted });
        T(pg, tname, x0 + 7 + Math.max(26, F.s.widthOfTextAtSize(k, 8) + 8), top - 11, { f: F.s, size: 8, w: WD + WM - 50 });
        T(pg, `${ps.length} Pos.`, x0 + 7 + Math.max(26, F.s.widthOfTextAtSize(k, 8) + 8), top - 11 - LH, { size: 6.5, color: C.muted });
        cols.forEach((c, i) => {
          const xr = colX(i) + cw - 5;
          if ('ref' in c) {
            const v = tr[c.ref];
            if (v != null) num(pg, fmtNum(v), xr, top - 11, cw - 10, { f: F.s, size: 7.5, color: C.muted });
            pctLines(v, tr, c.ref).forEach((t, j) => T(pg, t, xr, top - 11 - (j + 1) * LH + 1, { size: 6.3, color: C.muted, align: 'r' }));
          } else {
            const cc = c.cell, v = titelSum(cc, ps);
            const low = v > 0 && v === min, high = !low && v === max && !cc.excluded;
            if (low) box(pg, colX(i) + 0.4, top - th0 + 0.4, cw - 0.8, th0 - 0.8, C.okL);
            num(pg, fmtNum(v), xr, top - 11, cw - 10, { f: F.s, size: 7.5, color: colTxt(cc, low ? C.ok : high ? C.high : C.ink), italic: high });
            pctLines(v, tr).forEach((t, j) => T(pg, t, xr, top - 11 - (j + 1) * LH + 1, { size: 6.3, color: low ? C.ok : C.muted, align: 'r' }));
          }
        });
        y -= th0;
        for (const x of ps) drawPos(x);
      }
      /* Zusätzliche Positionen */
      if (zList.length) {
        need(14 + LH + 2 * LH + 6);
        const top = y, h = 14 + LH;
        grid(top, h, C.neuK);
        hline(pg, x0, x0 + avail, top, C.line, 0.7);
        T(pg, 'neu', x0 + 7, top - 11, { f: F.s, size: 8, color: C.neuT });
        T(pg, 'Zusätzliche Positionen (nicht im LV)', x0 + 33, top - 11, { f: F.s, size: 8, w: WD + WM - 40 });
        T(pg, `${zList.length} Pos., in den Summen enthalten`, x0 + 33, top - 11 - LH, { size: 6.5, color: C.muted });
        cols.forEach((c, i) => { if ('cell' in c && c.cell.zusatz.length) num(pg, fmtNum(zSum(c.cell)), colX(i) + cw - 5, top - 11, cw - 10, { f: F.s, color: colTxt(c.cell, C.ink) }); });
        y -= h;
        for (const zr of zList) {
          const dl = wrap(zr.kurz || '(ohne Text in der Bieterdatei)', F.r, 7.5, WD - 40, 3);
          const h2 = 6 + Math.max(2, 1 + dl.length) * LH;
          need(h2);
          const t2 = y;
          grid(t2, h2, C.neu);
          T(pg, zr.oz, x0 + 7, t2 - 10, { size: 7, color: C.muted });
          rbox(pg, x0 + WD - 26, t2 - 12, 20, 9, 2.5, hex('#ede5ff'));
          T(pg, 'NEU', x0 + WD - 16, t2 - 9.5, { f: F.b, size: 5.5, color: C.neuT, align: 'c' });
          dl.forEach((l, j) => T(pg, l, x0 + 7, t2 - 10 - (j + 1) * LH, { size: 7.5 }));
          T(pg, zr.menge != null ? fmtNum(zr.menge, Number.isInteger(zr.menge) ? 0 : 3) : '', xm + WM / 2, t2 - 10, { f: F.s, size: 7.5, align: 'c' });
          T(pg, zr.einheit, xm + WM / 2, t2 - 10 - LH, { size: 7, color: C.muted, align: 'c' });
          cols.forEach((c, i) => {
            if (!('cell' in c)) return;
            const z = zr.per.get(c.cell.offer.id), xr = colX(i) + cw - 5;
            if (!z) { T(pg, '–', xr, t2 - 10, { color: C.faint, align: 'r' }); return; }
            if (z.ep != null) num(pg, fmtNum(z.ep), xr, t2 - 10, cw - 10, { color: colTxt(c.cell, C.ink) });
            num(pg, fmtNum(zusatzWert(z)), xr, t2 - 10 - LH, cw - 10, { color: colTxt(c.cell, C.muted) });
          });
          y -= h2;
        }
      }
    }

    /* Summen */
    const sumRows: { label: string; h?: number; fill?: RGB; bold?: boolean; ref?: (k: RK) => string; cell: (c: Cell, x: number, top: number, xr: number) => void }[] = [];
    const plain = (f: (c: Cell) => string, o: TOpt = {}) => (c: Cell, _x: number, top: number, xr: number) => num(pg, f(c), xr, top - 11, cw - 10, { ...o, color: colTxt(c, o.color ?? C.ink) });
    if (!hasLv) sumRows.push({ label: 'Angebotssumme (netto, vor Nachlass)', cell: plain((c) => (c.offer.summen[los.id] == null ? '–' : fmtNum(c.offer.summen[los.id]!))) });
    sumRows.push({ label: 'Summe netto (ohne Bedarfspositionen)', bold: true, ref: (k) => { const n = refTot(k, (c) => c.sumNet); return n == null ? '' : fmtNum(n); }, cell: plain((c) => fmtNum(c.sumNet ?? 0), { f: F.s }) });
    sumRows.push({ label: 'Nachlass ohne Bedingung', cell: (c, _x, top, xr) => {
      if (!c.nachlass) { T(pg, '–', xr, top - 11, { color: C.faint, align: 'r' }); return; }
      num(pg, `${fmtNum(c.nachlass)} % · −${fmtNum(nlBetrag(c) ?? 0)}`, xr, top - 11, cw - 10, { color: colTxt(c, C.ink) });
    } });
    sumRows.push({ label: 'Gesamt netto', h: 34, fill: C.brandL, bold: true, ref: (k) => fmtEur(refTot(k, (c) => c.net)), cell: (c, _x, top, xr) => {
      num(pg, fmtEur(c.net), xr, top - 13, cw - 10, { f: F.b, size: 9, color: colTxt(c, C.ink) });
      let cx = xr;
      if (c.dKosten != null) cx -= chip(pg, `KV ${fmtPct(c.dKosten)}`, cx, top - 27, 'info', 'r') + 3;
      if (c.rank) chip(pg, `Rang ${c.rank}`, cx, top - 27, c.rank === 1 ? 'ok' : 'info', 'r');
    } });
    sumRows.push({ label: `zzgl. MwSt. (${fmtNum(p.mwst, 1)} %)`, ref: (k) => { const n = refTot(k, (c) => c.net); return n == null ? '' : fmtNum(round2(n * (mw - 1))); }, cell: plain((c) => (c.net == null ? '' : fmtNum(round2(c.net * (mw - 1)))), { color: C.muted }) });
    sumRows.push({ label: 'Gesamt brutto', bold: true, ref: (k) => { const n = refTot(k, (c) => c.net); return n == null ? '' : fmtNum(round2(n * mw)); }, cell: plain((c) => (c.gross == null ? '' : fmtNum(c.gross)), { f: F.s }) });
    for (const k of (['min', 'sch'] as BK[]).filter((x) => x === 'min' || hasSch)) {
      sumRows.push({ label: `Abweichung ${k === 'min' ? 'zum Günstigsten' : 'zum LV-Schätzpreis'}`, ref: (rk) => { if (rk === k) return 'Basis'; const d = pct(refTot(rk, (c) => c.net), totNet[k]); return d == null ? '' : fmtPct(d); },
        cell: plain((c) => { const d = pct(c.net, totNet[k]); return d == null ? '–' : Math.abs(d) < 0.05 ? '±0,0 %' : fmtPct(d); }, { f: F.s }) });
    }
    if (hasSkonto) {
      sumRows.push({ label: 'Skonto (informativ, nicht gewertet)', cell: plain((c) => (c.offer.skonto ? `${fmtNum(c.offer.skonto)} % · (${fmtNum(skontoOf(c) ?? 0)})` : '–'), { color: C.muted }) });
      sumRows.push({ label: 'Gesamt brutto abzgl. Skonto (informativ)', cell: plain((c) => (c.gross == null ? '' : `(${fmtNum(round2(c.gross - (skontoOf(c) ?? 0)))})`), { color: C.muted }) });
    }
    const sumH = sumRows.reduce((a, x) => a + (x.h ?? 16), 0) + 8;
    need(Math.min(sumH, TOP - 80 - BOTTOM));
    y -= 6;
    hline(pg, x0, x0 + avail, y, C.ink, 0.8);
    for (const row of sumRows) {
      const h = row.h ?? 16;
      need(h);
      const top = y;
      grid(top, h, row.fill, !row.fill);
      T(pg, row.label, (hasLv ? xm : x0 + WD) - 7, top - (h > 20 ? 13 : 11), { f: row.bold ? F.s : F.r, size: row.h ? 9 : 7.5, color: row.bold ? C.ink : C.muted, align: 'r', w: WD - 14 });
      cols.forEach((c, i) => {
        const xr = colX(i) + cw - 5;
        if ('ref' in c) { const t = row.ref?.(c.ref) ?? ''; if (t) num(pg, t, xr, top - (h > 20 ? 13 : 11), cw - 10, { f: row.h ? F.s : F.r, size: row.h ? 8 : 7.5, color: C.muted }); }
        else row.cell(c.cell, colX(i), top, xr);
      });
      y -= h;
    }
    lastY = y;

    /** Höhe einer Positionszeile */
    function posH(x: LvPos) {
      const dl = wrap(x.kurz + (x.bedarf ? ' (Bedarf)' : ''), F.r, 7.5, WD - 14, 3);
      return 6 + Math.max(2 + npct, 1 + dl.length) * LH;
    }
    function drawPos(x: LvPos) {
      const dl = wrap(x.kurz + (x.bedarf ? ' (Bedarf)' : ''), F.r, 7.5, WD - 14, 3);
      const h = posH(x);
      need(h);
      const top = y;
      grid(top, h, x.bedarf ? C.bedarf : undefined);
      T(pg, x.oz, x0 + 7, top - 10, { size: 7, color: C.muted });
      dl.forEach((l, j) => T(pg, l, x0 + 7, top - 10 - (j + 1) * LH, { size: 7.5, color: x.bedarf ? C.muted : C.ink }));
      const chg = x.menge !== x.mengeOrig;
      T(pg, x.menge == null ? '–' : fmtNum(x.menge, Number.isInteger(x.menge) ? 0 : 3), xm + WM / 2, top - 10, { f: F.s, size: 7.5, align: 'c', color: chg ? hex('#1d4ed8') : C.ink });
      T(pg, x.einheit, xm + WM / 2, top - 10 - LH, { size: 7, color: C.muted, align: 'c', w: WM - 6 });
      if (chg) T(pg, `LV: ${x.mengeOrig ?? '–'}`, xm + WM / 2, top - 10 - 2 * LH, { size: 5.8, color: C.faint, align: 'c', w: WM - 4 });
      const st = peerStats(x.oz);
      const rp = refEp(x.oz);
      const base = { min: gpOf(x, rp.min), sch: gpOf(x, rp.sch) };
      cols.forEach((c, i) => {
        const xr = colX(i) + cw - 5, w = cw - 10;
        if ('ref' in c) {
          const v = rp[c.ref];
          if (v == null) return;
          num(pg, fmtNum(v), xr, top - 10, w, { color: C.muted });
          num(pg, fmtNum(gpOf(x, v)!), xr, top - 10 - LH, w, { color: C.muted });
          pctLines(gpOf(x, v), base, c.ref).forEach((t, j) => T(pg, t, xr, top - 10 - (j + 2) * LH, { size: 6.3, color: C.faint, align: 'r' }));
          return;
        }
        const cc = c.cell, ep = epOf(cc, x.oz), gp = ep == null ? null : round2((x.menge ?? 0) * ep);
        const low = ep != null && st.low != null && ep === st.low && ep > 0 && !cc.excluded;
        const high = !low && ep != null && st.high != null && ep === st.high && !cc.excluded;
        const out = isOut(cc, x.oz);
        if (low) box(pg, colX(i) + 0.4, top - h + 0.4, cw - 0.8, h - 0.8, C.okL);
        if (cc.mengeAbw.some((a) => a.oz === x.oz)) box(pg, colX(i) + 0.4, top - h + 0.4, 2, h - 0.8, C.blue);
        if (ep == null) { T(pg, '–', xr, top - 10, { color: C.faint, align: 'r' }); return; }
        const col = colTxt(cc, low ? C.ok : high ? C.high : C.ink);
        num(pg, fmtNum(ep), xr, top - 10, w, { f: F.m, color: col, italic: high });
        num(pg, gp == null ? '' : fmtNum(gp), xr, top - 10 - LH, w, { color: colTxt(cc, low ? C.ok : high ? C.high : C.muted), italic: high });
        if (cc.excluded) return;
        const pl = pctLines(gp, base);
        pl.forEach((t, j) => {
          const yy = top - 10 - (j + 2) * LH;
          T(pg, t, xr, yy, { f: out ? F.b : F.r, size: 6.3, color: out ? C.warn : low ? C.ok : C.faint, align: 'r' });
          if (out && j === 0) pg.drawCircle({ x: xr - F.b.widthOfTextAtSize(t, 6.3) - 4.5, y: yy + 2.2, size: 2, color: C.amber });
        });
        if (out && !pl.length) pg.drawCircle({ x: xr - 2, y: top - 10 - 2 * LH + 2.2, size: 2, color: C.amber });
      });
      y -= h;
    }
  });

  /* ---------- Hinweise ---------- */
  const notes: string[] = [];
  const lf = lvFremd(s, cells);
  if (lf) notes.push(lf);
  if (hasLv && hasSch) { const n = pos.filter((x) => !x.bedarf && s.schaetz?.[zkey(x.oz)] == null).length; if (n) notes.push(`${n} Position(en) ohne LV-Schätzpreis – Summe und Abweichung zum LV nur bedingt aussagekräftig.`); }
  const flagged = cells.filter((c) => c.flags.length);
  {
    let pg = pages[pages.length - 1];
    let y = lastY - 24;
    const lines: { t: string; f: PDFFont; c: RGB; ind: number; gap?: number }[] = [];
    const W = avail - 20;
    for (const n of notes) for (const [j, l] of wrap(n, F.r, 8, W - 12).entries()) lines.push({ t: l, f: F.r, c: C.ink, ind: 12, gap: j === 0 ? 4 : 0 });
    for (const c of flagged) {
      lines.push({ t: `Nr. ${c.offer.nr} · ${c.offer.firma}`, f: F.s, c: C.ink, ind: 0, gap: 6 });
      for (const fl of c.flags) for (const l of wrap(fl.text, F.r, 8, W - 12)) lines.push({ t: l, f: F.r, c: fl.kind === 'bad' ? C.bad : fl.kind === 'warn' ? C.warn : fl.kind === 'ok' ? C.ok : C.muted, ind: 12 });
    }
    if (!notes.length && !flagged.length) lines.push({ t: 'Keine Auffälligkeiten erkannt.', f: F.r, c: C.ink, ind: 0, gap: 4 });
    lines.push({ t: 'Gewertet wird nach VOB/A: Nachlass ohne Bedingung ist eingerechnet, Skonto nicht. Hinweise auf auffallend niedrige Preise ersetzen keine Aufklärung und keine Rechtsprüfung.', f: F.r, c: C.muted, ind: 0, gap: 8 });
    const startNew = () => {
      pg = doc.addPage([PW, PH]); pages.push(pg);
      T(pg, projTxt, M, TOP, { f: F.s, size: 9, color: C.muted, w: 420 });
      T(pg, 'Preisspiegel', M, TOP - 26, { f: F.b, size: 17 });
      T(pg, losTxt, M + F.b.widthOfTextAtSize('Preisspiegel', 17) + 12, TOP - 18, { f: F.s, size: 9 });
      y = TOP - 54;
    };
    if (y - 60 < BOTTOM) startNew();
    T(pg, 'Hinweise und Prüfergebnisse', M, y, { f: F.s, size: 11 }); y -= 8;
    for (const l of lines) {
      y -= 11 + (l.gap ?? 0);
      if (y < BOTTOM + 10) { startNew(); y -= 11; }
      if (l.ind && l.c !== C.muted && l.f === F.r) pg.drawCircle({ x: M + l.ind - 6, y: y + 2.6, size: 1.3, color: l.c });
      T(pg, l.t, M + l.ind, y, { f: l.f, size: 8, color: l.c, w: W });
    }
  }

  /* ---------- Fußzeilen ---------- */
  const n = pages.length;
  pages.forEach((pg, i) => {
    hline(pg, M, PW - M, BOTTOM - 10, C.line, 0.6);
    T(pg, i === 0 ? `${projTxt} · ${losTxt}` : 'Alle Einzelbeträge netto in EUR · Nachlass ohne Bedingung eingerechnet, Skonto informativ', M, BOTTOM - 21, { size: 7, color: C.muted, w: PW - 2 * M - 160 });
    T(pg, `Stand ${heute} · Seite ${i + 1} von ${n}`, PW - M, BOTTOM - 21, { size: 7, color: C.muted, align: 'r' });
  });

  return doc.save();
}
