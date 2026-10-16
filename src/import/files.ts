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

/** Bestes Soll-LV (Phase 83) unter den Dateien. */
export function findLv(files: RawFile[], DP?: typeof DOMParser): GaebDoc | null {
  const c = files.filter((f) => /\.[dpx]83$/i.test(f.path)).sort((a, b) => rank(a.path) - rank(b.path) || b.data.length - a.data.length);
  for (const f of c) {
    try { return parseGaeb(base(f.path), f.data, DP); } catch { /* nächste */ }
  }
  return null;
}

export interface BidGroup { root: string; files: RawFile[] }

export function groupBids(files: RawFile[]): BidGroup[] {
  const bid = files.filter((f) => /\.[dpx]84$/i.test(f.path));
  const dirs = [...new Set(bid.map((f) => dir(f.path)))].sort((a, b) => a.length - b.length);
  // verschachtelte Verzeichnisse zusammenführen (kürzester Pfad gewinnt)
  const roots = dirs.filter((d, i) => !dirs.slice(0, i).some((r) => r && d.startsWith(r + '/')));
  return roots.map((root) => ({
    root,
    files: files.filter((f) => (root ? f.path.startsWith(root + '/') : true) && !/\.[dpx]83$/i.test(f.path)),
  }));
}
