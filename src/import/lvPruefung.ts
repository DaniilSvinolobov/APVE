import type { GaebDoc } from '../gaeb/gaeb';
import { parseLvPdf, pdfLvSumme, pruefeLvDatei, vergleicheLv, vergleichePdf, type Befund, type PdfPos, type RefPos } from '../gaeb/lvCheck';
import { base, type RawFile } from './zip';
import { pdfLines } from './pdf';
import { findLvFiles, type LvFiles, type PdfGroup } from './files';
import { analyzeGroup, type ParsedBid } from './analyze';
import { ozNorm, pdfNettoSumme } from '../gaeb/lvCheck';

const order = { bad: 0, warn: 1, info: 2 } as const;
export const sortBefunde = (b: Befund[]) => [...b].sort((x, y) => order[x.kind] - order[y.kind]);

/** Das eigene LV: jede Datei für sich und alle Dateien gegen die führende Datei (83 > 81 > 82). */
export function pruefeEigenesLv(lv: LvFiles): Befund[] {
  const out: Befund[] = [];
  for (const d of lv.docs) out.push(...pruefeLvDatei(d.name, d.doc));
  const lead = lv.docs.find((d) => d.name === lv.sollName);
  if (lead) for (const d of lv.docs) if (d !== lead) out.push(...vergleicheLv(lead, d));
  if (lv.docs.length > 1 && !out.some((b) => b.kind === 'bad' && b.text.includes('↔'))) out.push({ kind: 'info', quelle: 'gaeb', text: `${lv.docs.map((d) => d.name).join(' ↔ ')}: Positionen, Mengen und Einheiten stimmen überein.` });
  return out;
}

/** Ein LV-PDF lesen und mit den Referenzpositionen vergleichen; meldet auch, wenn kein Text lesbar ist. */
export async function pruefePdf(f: RawFile, ref: RefPos[], mitPreisen: boolean): Promise<Befund[]> {
  return (await lesePdf(f, ref, mitPreisen)).befunde;
}

/** Wie `pruefePdf`, liefert zusätzlich die gelesenen Positionen und die Nettosumme des PDF. */
export async function lesePdf(f: RawFile, ref: RefPos[], mitPreisen: boolean): Promise<{ befunde: Befund[]; pdf: PdfPos[]; summe: number | null }> {
  const name = base(f.path);
  try {
    const lines = await pdfLines(f.data);
    if (lines.join('').length < 40) return { befunde: [{ kind: 'warn', quelle: 'pdf', text: `${name}: Das PDF enthält keinen lesbaren Text (Scan?) – bitte manuell mit der GAEB-Datei vergleichen.` }], pdf: [], summe: null };
    const pdf = parseLvPdf(lines, ref);
    return { befunde: vergleichePdf(name, pdf, ref, mitPreisen), pdf, summe: pdfLvSumme(lines) };
  } catch (e) {
    return { befunde: [{ kind: 'warn', quelle: 'pdf', text: `${name}: PDF konnte nicht gelesen werden (${(e as Error).message}).` }], pdf: [], summe: null };
  }
}

/**
 * Eigenes LV als bepreistes PDF: Einheitspreise als LV-Schätzpreise nutzen, wenn mindestens die Hälfte der
 * Positionen einen lesbaren EP hat (sonst ist es ein unbepreistes LV). Liefert null, wenn das PDF keine Preise trägt.
 */
export function schaetzAusPdf(name: string, pdf: PdfPos[], ref: RefPos[], summe: number | null): { doc: GaebDoc; befund: Befund } | null {
  const by = new Map(pdf.filter((p) => p.ep != null).map((p) => [ozNorm(p.oz), p]));
  const real = ref.filter((p) => !p.bedarf);
  const n = real.filter((p) => by.has(ozNorm(p.oz))).length;
  if (!n || n * 2 < real.length) return null;
  const doc: GaebDoc = {
    format: 'X', phase: 82, projekt: '', bezeichnung: '', auftraggeber: '', bieter: '', datum: '', titles: {}, totals: {}, total: { net: null, gross: null },
    positions: ref.map((r) => {
      const q = by.get(ozNorm(r.oz));
      return { oz: r.oz, kurz: r.kurz ?? '', lang: '', menge: r.menge, einheit: r.einheit, bedarf: !!r.bedarf, ep: q?.ep ?? null, gp: q?.gp ?? null };
    }),
  };
  const gelesen = r2(real.reduce((a, p) => a + (by.get(ozNorm(p.oz))?.gp ?? 0), 0));
  const eur = (v: number) => `${v.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`;
  const passt = summe == null || Math.abs(gelesen - summe) <= 0.05;
  const text = `${name}: LV-Schätzpreise aus dem PDF gelesen (${n} von ${real.length} Positionen, ${eur(gelesen)} netto). ${summe == null ? 'Keine Nettosumme im PDF gefunden – bitte stichprobenartig mit dem PDF vergleichen.' : passt ? `Die Summe stimmt mit der Summe im PDF (${eur(summe)}) überein.` : `ACHTUNG: Die Summe weicht von der Summe im PDF (${eur(summe)}) ab – bitte prüfen.`}`;
  return { doc, befund: { kind: passt ? 'info' : 'bad', quelle: 'pdf', text } };
}

export const refFromDoc = (doc: GaebDoc): RefPos[] => doc.positions.map((p) => ({ oz: p.oz, menge: p.menge, einheit: p.einheit, ep: p.ep, gp: p.gp, kurz: p.kurz, bedarf: p.bedarf }));

const r2 = (n: number) => Math.round(n * 100) / 100;

const RECHTSFORM = /GmbH|\bKG\b|\bAG\b|e\.K\.|\bUG\b|OHG|GbR|mbH/;

/** Bieter und Angebotsdatum aus dem Briefkopf eines Angebots-PDF („Outdoor Design GmbH / Straße / Ort“, „Ort, 19.05.2026“). */
export function kopfAusPdf(lines: string[]): { bieter: string; datum: string } {
  const kopf = lines.slice(0, 30);
  const bieter = kopf.flatMap((l) => l.split(/\s+[/|·]\s+/)).map((t) => t.trim()).find((t) => RECHTSFORM.test(t) && t.length <= 60 && !/^(an|z\.\s*hd)\b/i.test(t)) ?? '';
  const d = kopf.map((l) => l.match(/,\s*(?:den\s+)?(\d{2})\.(\d{2})\.(\d{4})\s*$/)).find(Boolean);
  return { bieter, datum: d ? `${d[3]}-${d[2]}-${d[1]}` : '' };
}

/**
 * Bieterordner ohne bepreiste GAEB-Datei, aber mit bepreistem LV als PDF (z. B. nur unbepreistes X83 + PDF):
 * Preise aus dem PDF lesen. `ref` = Positionen des eigenen LV; fehlt es, dient ein unbepreistes LV aus dem Ordner.
 * Liefert null, wenn kein PDF mehrheitlich Preise enthält (dann ist es z. B. nur das Ausschreibungs-LV).
 */
export async function bieterAusPdf(g: PdfGroup, ref: RefPos[] | null, nextNr: number): Promise<{ parsed: ParsedBid | null; hinweis: string }> {
  const folderLv = findLvFiles(g.files);
  const positions = ref ?? (folderLv.soll ? refFromDoc(folderLv.soll) : null);
  const name = g.root.split('/').pop() || 'Ordner';
  if (!positions) return { parsed: null, hinweis: `„${name}“: LV-PDF gefunden, aber kein LV als Referenz – bitte zuerst das eigene LV laden.` };
  let best: { f: RawFile; pdf: ReturnType<typeof parseLvPdf>; n: number; summe: number | null; lines: string[] } | null = null;
  for (const f of g.pdfs) {
    try {
      const lines = await pdfLines(f.data);
      const pdf = parseLvPdf(lines, positions);
      const n = pdf.filter((p) => p.ep != null).length;
      if (!best || n > best.n) best = { f, pdf, n, summe: pdfNettoSumme(lines), lines };
    } catch { /* nächstes PDF */ }
  }
  const real = positions.filter((p) => !p.bedarf).length;
  if (!best || best.n * 2 < real) return { parsed: null, hinweis: '' };
  const by = new Map(best.pdf.map((p) => [ozNorm(p.oz), p]));
  const doc: GaebDoc = {
    format: 'X', phase: 84, projekt: '', bezeichnung: '', auftraggeber: '', ...kopfAusPdf(best.lines), titles: folderLv.soll?.titles ?? {}, totals: {}, total: { net: null, gross: null },
    positions: positions.map((r) => {
      const q = by.get(ozNorm(r.oz));
      const menge = q?.menge ?? r.menge;
      const ep = q?.ep ?? null;
      return { oz: r.oz, kurz: r.kurz ?? '', lang: '', menge, einheit: r.einheit, bedarf: !!r.bedarf, ep, gp: q?.gp ?? (ep != null && menge != null ? r2(menge * ep) : null) };
    }),
  };
  const gaeb = g.files.filter((f) => /\.[dpx]8[123]$/i.test(f.path)).map((f) => base(f.path));
  const gelesen = r2(doc.positions.filter((p) => !p.bedarf).reduce((a, p) => a + (p.gp ?? 0), 0));
  const summenHinweis = best.summe == null ? '' : Math.abs(gelesen - best.summe) <= 0.05 ? ` Die Summe der gelesenen Positionen (${gelesen.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €) stimmt mit der Gesamtsumme netto im PDF überein.` : ` ACHTUNG: Die Summe der gelesenen Positionen (${gelesen.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €) weicht von der Gesamtsumme netto im PDF (${best.summe.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €) ab.`;
  const hinweis = `Preise aus dem PDF „${base(best.f.path)}“ gelesen (${best.n} von ${real} Positionen). ${gaeb.length ? `Die beigefügte GAEB-Datei (${[...new Set(gaeb)].join(', ')}) enthält keine Preise.` : 'Es liegt keine bepreiste GAEB-Datei vor.'} Die Zahlen stammen aus der Texterkennung des PDF – bitte stichprobenartig mit dem PDF vergleichen.${summenHinweis}`;
  const bg = { root: g.root, files: g.files.filter((f) => !/\.[dpx]8[123]$/i.test(f.path)), bids: [] };
  return { parsed: analyzeGroup(bg, nextNr, undefined, { doc, quelle: base(best.f.path), hinweis }), hinweis };
}
