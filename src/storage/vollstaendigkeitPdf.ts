/**
 * Prüfung auf Vollständigkeit der Angebotsunterlagen als eigene PDF-Anlage (A4 quer), im Browser erzeugt.
 * Dient auch der Abstimmung mit dem Auftraggeber: Tabelle Unterlagen × Angebote und je Angebot die nachzufordernden Unterlagen.
 */
import type { PDFPage, RGB, PDFFont } from 'pdf-lib';
import type { Offer, PStatus, State } from '../domain/types';
import { PSTATUS } from '../domain/types';
import { fmtDate } from '../domain/fmt';
import { BOTTOM, C, M, PH, PW, TOP, clean, downloadPdf, fit, hex, neuesPdf, wrap } from './pdfBasis';

const TITEL = 'Prüfung auf Vollständigkeit der Angebotsunterlagen';
const badL = hex('#fde8e6');

/** Zelltext und Farben je Status */
const zelle = (st: PStatus | undefined, d: string): { t: string; bg: RGB; fg: RGB } => {
  switch (st) {
    case 'ok': return { t: 'vorhanden', bg: C.okL, fg: C.ok };
    case 'nach': return { t: `Nachgereicht${d ? ' ' + fmtDate(d) : ''}`, bg: C.brandL, fg: C.brand };
    case 'fehlt': case 'leer': return { t: PSTATUS.find((x) => x.v === st)!.cell, bg: badL, fg: C.bad };
    case 'teil': case 'unsign': case 'pdf': return { t: PSTATUS.find((x) => x.v === st)!.cell, bg: C.warnL, fg: C.warn };
    case 'entf': return { t: 'entfällt', bg: C.line2, fg: C.muted };
    default: return { t: 'offen', bg: C.white, fg: C.faint };
  }
};

/** Nachzufordernde Unterlagen eines Angebots, gruppiert nach Befund. */
export function nachforderung(s: State, o: Offer): { titel: string; items: string[] }[] {
  const rows = s.unterlagen.filter((u) => u.label.trim());
  const by = (st: PStatus) => rows.filter((u) => o.pruef?.[u.id]?.s === st).map((u) => clean(u.label));
  return ([
    ['Nicht beigefügt', by('fehlt')],
    ['Nicht ausgefüllt', by('leer')],
    ['Nur teilweise ausgefüllt', by('teil')],
    ['Nicht unterschrieben', by('unsign')],
  ] as const).filter(([, items]) => items.length).map(([titel, items]) => ({ titel, items: [...items] }));
}

export async function downloadVollstaendigkeitPdf(s: State) {
  downloadPdf(await vollstaendigkeitPdf(s), `Vollstaendigkeitspruefung_${s.project.nummer || 'Angebote'}.pdf`);
}

export async function vollstaendigkeitPdf(s: State): Promise<Uint8Array> {
  const { doc, F } = await neuesPdf();
  const p = s.project;
  doc.setTitle(TITEL);
  doc.setAuthor(p.ersteller || p.vergabestelle || '');
  doc.setSubject(p.titel || '');

  const offers = s.offers;
  const rows = s.unterlagen.filter((u) => u.label.trim());
  const heute = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const projTxt = [p.nummer, p.titel].filter(Boolean).join(' · ') || 'Vergabe';
  const avail = PW - 2 * M;

  const T = (pg: PDFPage, t: string, x: number, y: number, o: { f?: PDFFont; size?: number; color?: RGB; align?: 'l' | 'r' | 'c'; w?: number } = {}) => {
    const f = o.f ?? F.r, size = o.size ?? 8;
    let txt = clean(t);
    if (!txt) return;
    if (o.w) txt = fit(txt, f, size, o.w);
    const w = f.widthOfTextAtSize(txt, size);
    pg.drawText(txt, { x: o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x, y, size, font: f, color: o.color ?? C.ink });
  };
  const box = (pg: PDFPage, x: number, y: number, w: number, h: number, fill?: RGB, border?: RGB) =>
    pg.drawRectangle({ x, y, width: w, height: h, ...(fill ? { color: fill } : {}), ...(border ? { borderColor: border, borderWidth: 0.5 } : {}) });

  const pages: PDFPage[] = [];
  let pg!: PDFPage;
  let y = 0;
  const neueSeite = (zusatz = '') => {
    pg = doc.addPage([PW, PH]);
    pages.push(pg);
    T(pg, projTxt, M, TOP, { f: F.s, size: 9, color: C.muted, w: avail });
    T(pg, TITEL, M, TOP - 26, { f: F.b, size: 15 });
    const sub = [p.auftraggeber ? `Auftraggeber: ${p.auftraggeber}` : '', `${offers.length} Angebot(e)`, zusatz].filter(Boolean).join(' · ');
    T(pg, sub, M, TOP - 40, { size: 8, color: C.muted, w: avail });
    y = TOP - 54;
  };

  /* ---------- Tabelle Unterlagen × Angebote (bei vielen Bietern in Blöcken) ---------- */
  const LW = 240, MINC = 84;
  const maxBid = Math.max(1, Math.floor((avail - LW) / MINC));
  const chunks: Offer[][] = [];
  for (let i = 0; i < offers.length; i += maxBid) chunks.push(offers.slice(i, i + maxBid));
  chunks.forEach((os, ci) => {
    const cw = Math.min(130, (avail - LW) / os.length);
    const tw = LW + cw * os.length;
    const colX = (i: number) => M + LW + i * cw;
    const kopf = () => {
      neueSeite(chunks.length > 1 ? `Angebote ${ci * maxBid + 1}–${ci * maxBid + os.length} von ${offers.length}` : '');
      const hh = 34;
      box(pg, M, y - hh, tw, hh, C.head, C.line);
      T(pg, 'Unterlage / Prüfpunkt', M + 6, y - 14, { f: F.s, size: 7.5, color: C.muted });
      os.forEach((o, i) => {
        const x = colX(i);
        pg.drawLine({ start: { x, y }, end: { x, y: y - hh }, thickness: 0.5, color: C.line });
        T(pg, `Nr. ${o.nr}`, x + 5, y - 11, { size: 6.5, color: C.faint, w: cw - 10 });
        wrap(o.firma || '–', F.s, 7.5, cw - 10, 2).forEach((l, j) => T(pg, l, x + 5, y - 21 - j * 9, { f: F.s, size: 7.5 }));
      });
      y -= hh;
    };
    kopf();
    for (const u of rows) {
      const lines = wrap(u.label, F.r, 7.5, LW - 12, 3);
      const cellLines = os.map((o) => { const x = o.pruef?.[u.id]; return wrap(zelle(x?.s, x?.d ?? '').t, F.s, 7, cw - 10, 2); });
      const h = 8 + 9 * Math.max(lines.length, ...cellLines.map((l) => l.length));
      if (y - h < BOTTOM + 6) kopf();
      box(pg, M, y - h, LW, h, undefined, C.line);
      lines.forEach((l, j) => T(pg, l, M + 6, y - 11 - j * 9, { size: 7.5 }));
      os.forEach((o, i) => {
        const x = o.pruef?.[u.id];
        const z = zelle(x?.s, x?.d ?? '');
        box(pg, colX(i), y - h, cw, h, z.bg, C.line);
        cellLines[i].forEach((l, j) => T(pg, l, colX(i) + cw / 2, y - 11 - j * 9, { f: F.s, size: 7, color: z.fg, align: 'c' }));
      });
      y -= h;
    }
  });

  if (!chunks.length) neueSeite();

  /* ---------- Nachzufordernde Unterlagen je Angebot ---------- */
  const W = avail;
  const zeilen: { t: string; f: PDFFont; c: RGB; ind: number; gap: number }[] = [];
  for (const o of offers) {
    const nf = nachforderung(s, o);
    const offen = rows.filter((u) => !o.pruef?.[u.id]).length;
    if (!nf.length && !offen) continue;
    zeilen.push({ t: `Nr. ${o.nr} · ${o.firma}`, f: F.s, c: C.ink, ind: 0, gap: 8 });
    for (const g of nf) {
      zeilen.push({ t: `${g.titel}:`, f: F.m, c: g.titel.startsWith('Nicht b') || g.titel.startsWith('Nicht a') ? C.bad : C.warn, ind: 12, gap: 2 });
      for (const it of g.items) for (const [j, l] of wrap(it, F.r, 8, W - 36).entries()) zeilen.push({ t: (j ? '' : '– ') + l, f: F.r, c: C.ink, ind: j ? 30 : 24, gap: 0 });
    }
    if (offen) zeilen.push({ t: `${offen} Prüfpunkt(e) noch nicht geprüft`, f: F.r, c: C.muted, ind: 12, gap: 2 });
  }
  if (!zeilen.length) zeilen.push({ t: 'Keine Unterlagen nachzufordern – alle geprüften Angebote sind vollständig.', f: F.r, c: C.ink, ind: 0, gap: 4 });
  zeilen.push({ t: 'Fehlende Erklärungen und Nachweise können nach § 16a VOB/A nachgefordert werden, bevor ein Angebot ausgeschlossen wird. Die Aufstellung ersetzt keine Rechtsprüfung.', f: F.r, c: C.muted, ind: 0, gap: 12 });
  y -= 26;
  if (y - 60 < BOTTOM) neueSeite();
  T(pg, 'Nachzufordernde Unterlagen', M, y, { f: F.s, size: 11 });
  y -= 6;
  for (const z of zeilen) {
    for (const [j, l] of (z.ind ? [z.t] : wrap(z.t, z.f, 8, W)).entries()) {
      y -= 11 + (j ? 0 : z.gap);
      if (y < BOTTOM + 10) { neueSeite(); y -= 11; }
      T(pg, l, M + z.ind, y, { f: z.f, size: 8, color: z.c, w: W - z.ind });
    }
  }

  /* ---------- Fußzeilen ---------- */
  const n = pages.length;
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: BOTTOM - 10 }, end: { x: PW - M, y: BOTTOM - 10 }, thickness: 0.6, color: C.line });
    T(pg, [p.datum ? fmtDate(p.datum) : '', p.ersteller].filter(Boolean).join(' · ') || projTxt, M, BOTTOM - 21, { size: 7, color: C.muted, w: PW - 2 * M - 160 });
    T(pg, `Stand ${heute} · Seite ${i + 1} von ${n}`, PW - M, BOTTOM - 21, { size: 7, color: C.muted, align: 'r' });
  });

  return doc.save();
}
