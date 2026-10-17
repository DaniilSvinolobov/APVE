import type { SummenCheck } from '../domain/types';
import { base, type RawFile } from './zip';
import { kategorie } from './files';
import { pdfLines } from './pdf';

const BETRAG = /(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}/g;
const zahl = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));
const ENDSUMME = /gesamt\s*(?:summe)?\s*\(?\s*netto|netto\s*-?\s*summe|angebotssumme\s*\(?\s*netto|summe\s*\(?\s*netto|endsumme\s*\(?\s*netto/i;

/** Endsumme aus den Textzeilen eines PDF: als „netto“ benannt und/oder die GAEB-Summe kommt im Text vor. Ohne Textebene (Scan) nicht lesbar. */
export function summeAusZeilen(lines: string[], soll: number | null): { lesbar: boolean; gefunden: boolean; betrag: number | null } {
  if (lines.join('').replace(/\s/g, '').length < 40) return { lesbar: false, gefunden: false, betrag: null };
  const gefunden = soll != null && lines.some((l) => [...l.matchAll(BETRAG)].some((m) => Math.abs(zahl(m[0]) - soll) <= 0.005));
  let betrag: number | null = null;
  for (const l of lines) if (ENDSUMME.test(l)) { const m = [...l.matchAll(BETRAG)]; if (m.length) betrag = zahl(m[m.length - 1][0]); }
  return { lesbar: true, gefunden, betrag };
}

/** Kommt als bepreistes Angebot in Frage (Nachweise, Erklärungen und Formulare nicht). */
const KANDIDAT = /angebot|preis|kostenanforder|\blv\b|leistungsverzeichnis/i;
const NICHT = /bietererkl|eigenerkl|nebenangebot|angebotsschreiben|fragebogen|freistellung|bescheinigung/i;

/** Endsumme im PDF des Bieters gegen die GAEB-Summe halten – nur lesen, nichts übertragen (alles im Browser). */
export async function pdfSummenCheck(files: RawFile[], soll: number | null): Promise<SummenCheck['pdf']> {
  const kand = files.filter((f) => /\.pdf$/i.test(f.path) && f.data.length <= 9_000_000 && ['Sonstiges', 'LV (PDF)'].includes(kategorie(f.path)) && KANDIDAT.test(base(f.path)) && !NICHT.test(base(f.path)));
  let erstes: SummenCheck['pdf'];
  for (const f of kand) {
    try {
      const r = summeAusZeilen(await pdfLines(f.data), soll);
      const ergebnis = { datei: base(f.path), ...r };
      if (r.lesbar && (r.betrag != null || r.gefunden)) return ergebnis;
      erstes ??= ergebnis;
    } catch { /* nicht lesbar – nächste Datei */ }
  }
  return erstes;
}
