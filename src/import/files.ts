import { parseGaeb, type GaebDoc } from '../gaeb/gaeb';
import { base, dir, type RawFile } from './zip';

export const hash = (b: Uint8Array) => {
  let h = 2166136261;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 16777619); }
  return `${b.length}:${h >>> 0}`;
};

export function kategorie(path: string): string {
  const n = base(path).toLowerCase();
  if (/nachforderung/i.test(path)) return 'Nachforderung';
  if (/\.p7m$|signatur/.test(n)) return 'Signatur';
  if (/fragebogen|eignung/.test(n)) return 'Eignungsfragebogen';
  if (/referenz/.test(n)) return 'Referenzen';
  if (/versicherung/.test(n)) return 'Versicherung';
  if (/nachunternehmer/.test(n)) return 'Nachunternehmer';
  if (/meister/.test(n)) return 'Meisterbrief';
  if (/qualifikation|\bpq\b/.test(n)) return 'Präqualifikation';
  if (/angebotsschreiben/.test(n)) return 'Angebotsschreiben';
  if (/^lv\b|leistungsverzeichnis/.test(n)) return 'LV (PDF)';
  if (/\.(aidf|lv|xml)$/.test(n)) return 'Plattformdatei';
  return 'Sonstiges';
}

export const rank = (name: string) => (/\.x/i.test(name) ? 0 : /\.p/i.test(name) ? 1 : 2);

const LV_FILE = /\.[dpx]8[123]$/i;
const byRank = (a: RawFile, b: RawFile) => rank(a.path) - rank(b.path) || b.data.length - a.data.length;

/** Enthält die Datei Bieterpreise? (Mehrheit der Positionen mit Einheitspreis) – dann ist sie ein Angebot, kein LV. */
export function isPriced(doc: GaebDoc): boolean {
  const pos = doc.positions.filter((p) => !p.bedarf);
  return pos.length > 0 && pos.filter((p) => p.ep != null).length * 2 >= pos.length;
}

/** Bietet ein Bieter sein Angebot als x81/x83 (statt x84) ab, steckt es im selben Format wie das LV – erkennbar an den Preisen. */
const MAYBE_BID = /\.[dpx]8[13]$/i;

function firstDoc(files: RawFile[], phase: number, DP: typeof DOMParser | undefined, pricedSkipped: string[]): { doc: GaebDoc; name: string } | null {
  const re = new RegExp(`\\.[dpx]${phase}$`, 'i');
  for (const f of files.filter((x) => re.test(x.path)).sort(byRank)) {
    try {
      const doc = parseGaeb(base(f.path), f.data, DP);
      if (MAYBE_BID.test(f.path) && isPriced(doc)) { pricedSkipped.push(base(f.path)); continue; }
      return { doc, name: base(f.path) };
    } catch { /* nächste */ }
  }
  return null;
}

export interface LvFiles {
  /** Positionen und Mengen: bevorzugt Phase 83, sonst 81, sonst 82 */
  soll: GaebDoc | null;
  sollName: string;
  /** Kostenanschlag (Phase 82) mit Einheitspreisen = LV-Schätzpreis */
  schaetz: GaebDoc | null;
  schaetzName: string;
  /** x81/x83 mit Bieterpreisen: wurden übersprungen, gehören in „Angebote der Bieter“ */
  pricedSkipped: string[];
}

/** Eigenes LV (Phase 81/82/83) unter den Dateien finden. */
export function findLvFiles(files: RawFile[], DP?: typeof DOMParser): LvFiles {
  const pricedSkipped: string[] = [];
  const d81 = firstDoc(files, 81, DP, pricedSkipped), d82 = firstDoc(files, 82, DP, pricedSkipped), d83 = firstDoc(files, 83, DP, pricedSkipped);
  const soll = d83 ?? d81 ?? d82;
  const s82 = d82 && d82.doc.positions.some((p) => p.ep != null) ? d82 : null;
  return { soll: soll?.doc ?? null, sollName: soll?.name ?? '', schaetz: s82?.doc ?? null, schaetzName: s82?.name ?? '', pricedSkipped };
}

export const isLvFile = (path: string) => LV_FILE.test(path);
export const isBidFile = (path: string) => /\.[dpx]84$/i.test(path);

export interface BidGroup { root: string; files: RawFile[]; /** die Preisdateien des Bieters (x84, ersatzweise x81/x83 mit Preisen) */ bids: RawFile[] }

/** Preisdateien unter den Dateien: x84 immer, x81/x83 nur wenn sie Bieterpreise enthalten. */
function bidFilesOf(files: RawFile[], DP?: typeof DOMParser): RawFile[] {
  return files.filter((f) => {
    if (isBidFile(f.path)) return true;
    if (!MAYBE_BID.test(f.path)) return false;
    try { return isPriced(parseGaeb(base(f.path), f.data, DP)); } catch { return false; }
  });
}

export function groupBids(files: RawFile[], DP?: typeof DOMParser): BidGroup[] {
  const bid = bidFilesOf(files, DP);
  const isBid = new Set(bid);
  const dirs = [...new Set(bid.map((f) => dir(f.path)))].sort((a, b) => a.length - b.length);
  // verschachtelte Verzeichnisse zusammenführen (kürzester Pfad gewinnt)
  const roots = dirs.filter((d, i) => !dirs.slice(0, i).some((r) => r && d.startsWith(r + '/')));
  return roots.map((root) => {
    const inRoot = files.filter((f) => (root ? f.path.startsWith(root + '/') : true));
    // beigelegte Kopien des Ausschreibungs-LV (x81/x82/x83 ohne Preise) sind keine Bieterunterlagen
    return { root, files: inRoot.filter((f) => !LV_FILE.test(f.path) || isBid.has(f)), bids: inRoot.filter((f) => isBid.has(f)) };
  });
}
