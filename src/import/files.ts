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

function firstDoc(files: RawFile[], phase: number, DP?: typeof DOMParser): { doc: GaebDoc; name: string } | null {
  const re = new RegExp(`\\.[dpx]${phase}$`, 'i');
  for (const f of files.filter((x) => re.test(x.path)).sort(byRank)) {
    try { return { doc: parseGaeb(base(f.path), f.data, DP), name: base(f.path) }; } catch { /* nächste */ }
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
}

/** Eigenes LV (Phase 81/82/83) unter den Dateien finden. */
export function findLvFiles(files: RawFile[], DP?: typeof DOMParser): LvFiles {
  const d81 = firstDoc(files, 81, DP), d82 = firstDoc(files, 82, DP), d83 = firstDoc(files, 83, DP);
  const soll = d83 ?? d81 ?? d82;
  const s82 = d82 && d82.doc.positions.some((p) => p.ep != null) ? d82 : null;
  return { soll: soll?.doc ?? null, sollName: soll?.name ?? '', schaetz: s82?.doc ?? null, schaetzName: s82?.name ?? '' };
}

export const isLvFile = (path: string) => LV_FILE.test(path);
export const isBidFile = (path: string) => /\.[dpx]84$/i.test(path);

export interface BidGroup { root: string; files: RawFile[] }

export function groupBids(files: RawFile[]): BidGroup[] {
  const bid = files.filter((f) => /\.[dpx]84$/i.test(f.path));
  const dirs = [...new Set(bid.map((f) => dir(f.path)))].sort((a, b) => a.length - b.length);
  // verschachtelte Verzeichnisse zusammenführen (kürzester Pfad gewinnt)
  const roots = dirs.filter((d, i) => !dirs.slice(0, i).some((r) => r && d.startsWith(r + '/')));
  return roots.map((root) => ({
    root,
    files: files.filter((f) => (root ? f.path.startsWith(root + '/') : true) && !LV_FILE.test(f.path)),
  }));
}
