import type { GaebDoc } from '../gaeb/gaeb';
import { parseLvPdf, pruefeLvDatei, vergleicheLv, vergleichePdf, type Befund, type RefPos } from '../gaeb/lvCheck';
import { base, type RawFile } from './zip';
import { pdfLines } from './pdf';
import type { LvFiles } from './files';

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

export const refFromDoc = (doc: GaebDoc): RefPos[] => doc.positions.map((p) => ({ oz: p.oz, menge: p.menge, einheit: p.einheit, ep: p.ep, gp: p.gp }));
