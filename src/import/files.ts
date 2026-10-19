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
  /** nur ein Kostenanschlag (82) dabei, kein 81/83 – ergänzt bei geladenem LV nur die Schätzpreise */
  nur82: boolean;
  /** alle lesbaren LV-Dateien (81/82/83, alle Formate) – für den Abgleich untereinander */
  docs: { name: string; doc: GaebDoc }[];
}

/** Eigenes LV (Phase 81/82/83) unter den Dateien finden. */
export function findLvFiles(files: RawFile[], DP?: typeof DOMParser): LvFiles {
  const pricedSkipped: string[] = [];
  const d81 = firstDoc(files, 81, DP, pricedSkipped), d82 = firstDoc(files, 82, DP, pricedSkipped), d83 = firstDoc(files, 83, DP, pricedSkipped);
  const soll = d83 ?? d81 ?? d82;
  const docs: LvFiles['docs'] = [];
  for (const f of files.filter((x) => LV_FILE.test(x.path)).sort(byRank)) {
    try { const doc = parseGaeb(base(f.path), f.data, DP); if (!(MAYBE_BID.test(f.path) && isPriced(doc))) docs.push({ name: base(f.path), doc }); } catch { /* nicht lesbar */ }
  }
  const s82 = d82 && d82.doc.positions.some((p) => p.ep != null) ? d82 : null;
  return { soll: soll?.doc ?? null, sollName: soll?.name ?? '', schaetz: s82?.doc ?? null, schaetzName: s82?.name ?? '', nur82: !d81 && !d83 && !!d82, pricedSkipped, docs };
}

/** PDF des LV (Ausdruck der Positionen) – gehört nicht zu den Nachweisen, sondern wird gegen die GAEB-Datei geprüft. */
export const isLvPdf = (path: string) => /\.pdf$/i.test(path) && (/(^|\/)Angebot\d+_L\.pdf$/i.test(path) || /(^|[^a-z0-9])LV($|[^a-z0-9])/i.test(base(path)) || /leistungsverzeichnis/i.test(path));

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

export interface PdfGroup { root: string; files: RawFile[]; pdfs: RawFile[] }

/**
 * Bieterordner, aus denen kein Angebot gelesen werden konnte (keine Preisdatei, Preise im PDF nicht lesbar).
 * `covered` = Ordner, die bereits ein Angebot ergeben haben. Dateien in deren übergeordneten Ordnern gehören
 * keinem Bieter; Kopien des Ausschreibungs-LV (x81/x82/x83) allein ergeben kein Angebot.
 */
export function groupRest(files: RawFile[], covered: string[]): { root: string; files: RawFile[] }[] {
  const inCovered = (p: string) => covered.some((r) => !r || p.startsWith(r + '/'));
  const ancestor = (d: string) => covered.some((r) => (d ? r.startsWith(d + '/') : r !== ''));
  const rest = files.filter((f) => !LV_FILE.test(f.path) && !inCovered(f.path) && !ancestor(dir(f.path)));
  const dirs = [...new Set(rest.map((f) => dir(f.path)))].sort((a, b) => a.length - b.length);
  const roots = dirs.filter((d, i) => !dirs.slice(0, i).some((r) => r && d.startsWith(r + '/')));
  // lose Dateien (ohne Ordner) bilden ein eigenes Angebot, Unterordner gehören ihrem eigenen Ordner
  const owner = (p: string) => roots.find((r) => r && p.startsWith(r + '/')) ?? '';
  return roots.map((root) => ({ root, files: rest.filter((f) => owner(f.path) === root) }));
}

/** Ordner mit einem LV-PDF, aber ohne Preisdatei (x84 bzw. bepreistes x83): Kandidaten für „Preise nur im PDF“. */
export function groupPdfBids(files: RawFile[], covered: BidGroup[]): PdfGroup[] {
  // Nachweise (Meisterbrief, Referenzen …) scheiden aus; jedes andere PDF kann das bepreiste LV enthalten (Dateiname beliebig)
  const NACHWEIS = new Set(['Signatur', 'Eignungsfragebogen', 'Referenzen', 'Versicherung', 'Nachunternehmer', 'Meisterbrief', 'Präqualifikation', 'Nachforderung']);
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.path) && f.data.length <= 9_000_000 && (isLvPdf(f.path) || !NACHWEIS.has(kategorie(f.path))) && !covered.some((g) => !g.root || f.path.startsWith(g.root + '/')));
  const dirs = [...new Set(pdfs.map((f) => dir(f.path)))].sort((a, b) => a.length - b.length);
  const roots = dirs.filter((d, i) => !dirs.slice(0, i).some((r) => r && d.startsWith(r + '/')));
  return roots.map((root) => {
    const inRoot = files.filter((f) => (root ? f.path.startsWith(root + '/') : true));
    return { root, files: inRoot, pdfs: pdfs.filter((f) => inRoot.includes(f)) };
  });
}
