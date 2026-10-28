import { parseGaeb, ozKey, type GaebDoc } from '../gaeb/gaeb';
import type { Offer } from '../domain/types';
import { uid } from '../domain/fmt';
import { base, type RawFile } from './zip';
import { hash, kategorie, rank, type BidGroup } from './files';
import type { DocFile } from './docStore';

export const cleanFirma = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  const i = t.lastIndexOf(',');
  if (i > 0 && !/GmbH|KG|AG|e\.K\.|UG|OHG|GbR/i.test(t.slice(i + 1)) && t.slice(i + 1).trim().length <= 24 && /GmbH|KG|AG|e\.K\.|UG|OHG|GbR|&/.test(t.slice(0, i))) return t.slice(0, i).trim();
  return t;
};

const decodeText = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

const is84 = (path: string) => /\.[dpx]84$/i.test(path);
/** Angebotsnummer im Ordnernamen: „Angebot 4“, „Angebot4_…“, „Angebotsdokumente_4_…“ */
const ANGEBOT_NR = /angebot(?:e|s[a-zäöü]*)?[\s_-]*(\d+)/i;

/** Bezeichnung einer nachgereichten Unterlage aus dem Dateinamen (ohne Endung und angehängten Firmennamen). */
export const nachName = (name: string) => base(name).replace(/\.[a-z0-9]+$/i, '').replace(/\s*-\s*[^-]+$/, '');

/** Firmenort für die Entfernung zur Baustelle: Angabe mit Postleitzahl bevorzugen (Signaturbeleg, sonst Anschrift in der GAEB-Datei). */
const firmenOrt = (sigOrt: string, sigPlz: string, gaebOrt?: string) => {
  const sig = sigOrt && sigPlz && !/\d{5}/.test(sigOrt) ? `${sigPlz} ${sigOrt}` : sigOrt;
  if (/\d{5}/.test(sig) || !gaebOrt) return sig;
  return /\d{5}/.test(gaebOrt) || !sig ? gaebOrt : sig;
};

export interface ParsedBid { offer: Offer; doc: GaebDoc; sig: boolean; docs: DocFile[] }

/**
 * `pre`: Preise stammen nicht aus einer GAEB-Datei, sondern aus dem LV-PDF (Dokument bereits aufgebaut);
 * `art: 'keine'` = Ordner ohne lesbare Preise – das Angebot wird trotzdem angelegt, damit es nicht verloren geht.
 */
export function analyzeGroup(g: BidGroup, nextNr: number, DP?: typeof DOMParser, pre?: { doc: GaebDoc; quelle: string; hinweis: string; art?: 'pdf' | 'keine' }): ParsedBid | null {
  const bidFiles = g.bids;
  const warnungen: string[] = [];
  // Duplikate erkennen
  const byHash = new Map<string, RawFile[]>();
  for (const f of bidFiles) byHash.set(hash(f.data), [...(byHash.get(hash(f.data)) ?? []), f]);
  const distinct = [...byHash.values()].map((arr) => arr.sort((a, b) => rank(a.path) - rank(b.path))[0]);
  distinct.sort((a, b) => (/nachverh/i.test(base(b.path)) ? 1 : 0) - (/nachverh/i.test(base(a.path)) ? 1 : 0) || (is84(b.path) ? 1 : 0) - (is84(a.path) ? 1 : 0) || rank(a.path) - rank(b.path));
  // gleiche Inhalte in verschiedenen Formaten (x84/d84) sind kein Warnsignal; gleiche Dateien mit "Nachverhandlung" im Namen schon
  for (const arr of byHash.values()) {
    const nv = arr.find((f) => /nachverh/i.test(base(f.path)));
    const other = arr.find((f) => f !== nv);
    if (nv && other) warnungen.push(`„${base(nv.path)}“ ist identisch mit „${base(other.path)}“ – die Nachverhandlungsdatei enthält keine geänderten Preise.`);
  }
  let doc: GaebDoc | null = pre?.doc ?? null;
  let used: { path: string } | null = pre ? { path: pre.quelle } : null;
  if (pre) warnungen.push(pre.hinweis);
  const formats = new Set(distinct.map((f) => f.path.slice(-3).toLowerCase()));
  if (!pre) for (const f of distinct) {
    try { doc = parseGaeb(base(f.path), f.data, DP); used = f; break; } catch (e) { warnungen.push(`„${base(f.path)}“ konnte nicht gelesen werden.`); }
  }
  if (!doc || !used) return null;
  if (!pre && !is84(used.path)) warnungen.push(`Preise aus „${base(used.path)}“ gelesen (Endung ${used.path.slice(-3).toUpperCase()} statt x84): Die Datei enthält Bieterpreise und wurde deshalb als Angebot erkannt.`);
  if (distinct.length > 1 && formats.size === 1) warnungen.push(`Mehrere unterschiedliche Preisdateien gefunden – verwendet: „${base(used.path)}“.`);

  const sig = g.files.find((f) => /signaturbeleg/i.test(base(f.path)));
  const st = sig ? decodeText(sig.data) : '';
  const grab = (re: RegExp) => st.match(re)?.[1]?.trim() ?? '';
  const folder = g.root.split('/').find((p) => ANGEBOT_NR.test(p)) ?? g.root.split('/').pop() ?? '';
  const nr = Number(folder.match(ANGEBOT_NR)?.[1]) || nextNr;
  const LEGAL = /GmbH|KG|\bAG\b|e\.K\.|\bUG\b|OHG|GbR|mbH/;
  const cands = [cleanFirma(doc.bieter), grab(/Firmenname:\s*(.+)/)].filter(Boolean);
  const firma = cands.find((c) => LEGAL.test(c)) || cands[0] || folder.replace(/^Angebot(?:e|s[a-zäöü]*)?[_\s-]*\d*[_\s-]*/i, '').replace(/_/g, '/');
  const datumRaw = grab(/Angebotsdatum:\s*(\d{2}\.\d{2}\.\d{4})/);
  const datum = datumRaw ? datumRaw.split('.').reverse().join('-') : doc.datum;

  const isBidPath = new Set(g.bids.map((f) => f.path));
  const dateien = g.files
    .filter((f) => !isBidPath.has(f.path) && !/signaturbeleg|\.offerinfo/i.test(base(f.path)))
    .filter((f, i, arr) => arr.findIndex((x) => base(x.path) === base(f.path) && x.data.length === f.data.length) === i)
    .map((f) => ({ name: base(f.path), kat: kategorie(f.path) }));
  const nachforderung = g.files
    .filter((f) => /nachforderung/i.test(f.path) && !/\.zip$/i.test(f.path))
    .map((f) => nachName(f.path));
  const has = (k: string) => dateien.some((d) => d.kat === k);
  const sigFound = has('Signatur') || !!sig;
  const sigNr = grab(/Vergabenummer:\s*(.+)/);
  void sigNr;

  const prices: Offer['prices'] = {};
  for (const p of doc.positions) prices[ozKey(p.oz)] = { ep: p.ep, gp: p.gp };
  const offer: Offer = {
    id: uid(), nr, firma, ort: firmenOrt(grab(/Firmenort:\s*(.+)/), grab(/(?:Firmen-?)?PLZ:\s*(\d{5})\b/), doc.bieterOrt), runde: g.files.some((f) => /nachverh/i.test(f.path)) ? 2 : 1,
    datum, preisQuelle: pre ? pre.art ?? 'pdf' : undefined, lose: [], nachlass: null, nachlassLose: [], skonto: null, prices, summen: {}, pruef: {},
    textErg: doc.positions.filter((p) => p.bieterText).map((p) => ({ oz: p.oz, text: p.bieterText! })),
    nachforderung, dateien, warnungen, quelle: base(used.path),
  };
  const docs = docFiles(g.files, g.root);
  return { offer, doc, sig: sigFound, docs };
}

const mimeVon = (p: string) => (/\.pdf$/i.test(p) ? 'application/pdf' : /\.png$/i.test(p) ? 'image/png' : /\.jpe?g$/i.test(p) ? 'image/jpeg'
  : /\.docx$/i.test(p) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream');

/**
 * Dokumente für die (optionale) KI-Prüfung, ohne Duplikate: alle Unterlagen (PDF, Bilder, Word …). Was die Prüfung nicht
 * lesen kann, wird dort als „nicht geprüft“ gemeldet statt stillschweigend übergangen.
 */
export function docFiles(files: RawFile[], root: string): DocFile[] {
  return files
    .filter((f) => f.data.length <= 80_000_000 && !/\.zip$/i.test(f.path))
    .filter((f, i, arr) => arr.findIndex((x) => x.data.length === f.data.length && base(x.path) === base(f.path)) === i)
    .map((f) => ({ name: base(f.path), path: f.path.slice(root.length ? root.length + 1 : 0), data: f.data, kat: kategorie(f.path), mime: mimeVon(f.path) }));
}
