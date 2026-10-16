import type { GaebDoc } from '../gaeb/gaeb';
import { parseLvPdf, pruefeLvDatei, vergleicheLv, vergleichePdf, type Befund, type RefPos } from '../gaeb/lvCheck';
import { base, type RawFile } from './zip';
import { pdfLines } from './pdf';
import { findLvFiles, type LvFiles, type PdfGroup } from './files';
import { analyzeGroup, type ParsedBid } from './analyze';
import { ozNorm } from '../gaeb/lvCheck';

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
  const name = base(f.path);
  try {
    const lines = await pdfLines(f.data);
    if (lines.join('').length < 40) return [{ kind: 'warn', quelle: 'pdf', text: `${name}: Das PDF enthält keinen lesbaren Text (Scan?) – bitte manuell mit der GAEB-Datei vergleichen.` }];
    return vergleichePdf(name, parseLvPdf(lines, ref), ref, mitPreisen);
  } catch (e) {
    return [{ kind: 'warn', quelle: 'pdf', text: `${name}: PDF konnte nicht gelesen werden (${(e as Error).message}).` }];
  }
}

export const refFromDoc = (doc: GaebDoc): RefPos[] => doc.positions.map((p) => ({ oz: p.oz, menge: p.menge, einheit: p.einheit, ep: p.ep, gp: p.gp, kurz: p.kurz, bedarf: p.bedarf }));

const r2 = (n: number) => Math.round(n * 100) / 100;

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
  let best: { f: RawFile; pdf: ReturnType<typeof parseLvPdf>; n: number } | null = null;
  for (const f of g.pdfs) {
    try {
      const pdf = parseLvPdf(await pdfLines(f.data), positions);
      const n = pdf.filter((p) => p.ep != null).length;
      if (!best || n > best.n) best = { f, pdf, n };
    } catch { /* nächstes PDF */ }
  }
  const real = positions.filter((p) => !p.bedarf).length;
  if (!best || best.n * 2 < real) return { parsed: null, hinweis: '' };
  const by = new Map(best.pdf.map((p) => [ozNorm(p.oz), p]));
  const doc: GaebDoc = {
    format: 'X', phase: 84, projekt: '', bezeichnung: '', auftraggeber: '', bieter: '', datum: '', titles: folderLv.soll?.titles ?? {}, totals: {}, total: { net: null, gross: null },
    positions: positions.map((r) => {
      const q = by.get(ozNorm(r.oz));
      const menge = q?.menge ?? r.menge;
      const ep = q?.ep ?? null;
      return { oz: r.oz, kurz: r.kurz ?? '', lang: '', menge, einheit: r.einheit, bedarf: !!r.bedarf, ep, gp: q?.gp ?? (ep != null && menge != null ? r2(menge * ep) : null) };
    }),
  };
  const gaeb = g.files.filter((f) => /\.[dpx]8[123]$/i.test(f.path)).map((f) => base(f.path));
  const hinweis = `Preise aus dem PDF „${base(best.f.path)}“ gelesen (${best.n} von ${real} Positionen). ${gaeb.length ? `Die beigefügte GAEB-Datei (${[...new Set(gaeb)].join(', ')}) enthält keine Preise.` : 'Es liegt keine bepreiste GAEB-Datei vor.'} Die Zahlen stammen aus der Texterkennung des PDF – bitte stichprobenartig mit dem PDF vergleichen.`;
  const bg = { root: g.root, files: g.files.filter((f) => !/\.[dpx]8[123]$/i.test(f.path)), bids: [] };
  return { parsed: analyzeGroup(bg, nextNr, undefined, { doc, quelle: base(best.f.path), hinweis }), hinweis };
}
