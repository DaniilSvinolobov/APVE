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

export interface ParsedBid { offer: Offer; doc: GaebDoc; sig: boolean; docs: DocFile[] }

export function analyzeGroup(g: BidGroup, nextNr: number, DP?: typeof DOMParser): ParsedBid | null {
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
  let doc: GaebDoc | null = null;
  let used: RawFile | null = null;
  const formats = new Set(distinct.map((f) => f.path.slice(-3).toLowerCase()));
  for (const f of distinct) {
    try { doc = parseGaeb(base(f.path), f.data, DP); used = f; break; } catch (e) { warnungen.push(`„${base(f.path)}“ konnte nicht gelesen werden.`); }
  }
  if (!doc || !used) return null;
  if (!is84(used.path)) warnungen.push(`Preise aus „${base(used.path)}“ gelesen (Endung ${used.path.slice(-3).toUpperCase()} statt x84): Die Datei enthält Bieterpreise und wurde deshalb als Angebot erkannt.`);
  if (distinct.length > 1 && formats.size === 1) warnungen.push(`Mehrere unterschiedliche Preisdateien gefunden – verwendet: „${base(used.path)}“.`);

  const sig = g.files.find((f) => /signaturbeleg/i.test(base(f.path)));
  const st = sig ? decodeText(sig.data) : '';
  const grab = (re: RegExp) => st.match(re)?.[1]?.trim() ?? '';
  const folder = g.root.split('/').find((p) => /angebot\s*\d+/i.test(p)) ?? g.root.split('/').pop() ?? '';
  const nr = Number(folder.match(/angebot\s*(\d+)/i)?.[1]) || nextNr;
  const LEGAL = /GmbH|KG|\bAG\b|e\.K\.|\bUG\b|OHG|GbR|mbH/;
  const cands = [cleanFirma(doc.bieter), grab(/Firmenname:\s*(.+)/)].filter(Boolean);
  const firma = cands.find((c) => LEGAL.test(c)) || cands[0] || folder.replace(/^Angebot\s*\d+[_\s-]*/i, '').replace(/_/g, '/');
  const datumRaw = grab(/Angebotsdatum:\s*(\d{2}\.\d{2}\.\d{4})/);
  const datum = datumRaw ? datumRaw.split('.').reverse().join('-') : doc.datum;

  const isBidPath = new Set(g.bids.map((f) => f.path));
  const dateien = g.files
    .filter((f) => !isBidPath.has(f.path) && !/signaturbeleg|\.offerinfo/i.test(base(f.path)))
    .filter((f, i, arr) => arr.findIndex((x) => base(x.path) === base(f.path) && x.data.length === f.data.length) === i)
    .map((f) => ({ name: base(f.path), kat: kategorie(f.path) }));
  const nachforderung = g.files
    .filter((f) => /nachforderung/i.test(f.path) && !/\.zip$/i.test(f.path))
    .map((f) => base(f.path).replace(/\.[a-z0-9]+$/i, '').replace(/\s*-\s*[^-]+$/, ''));
  const has = (k: string) => dateien.some((d) => d.kat === k);
  const sigFound = has('Signatur') || !!sig;
  const sigNr = grab(/Vergabenummer:\s*(.+)/);
  void sigNr;

  const prices: Offer['prices'] = {};
  for (const p of doc.positions) prices[ozKey(p.oz)] = { ep: p.ep, gp: p.gp };
  const offer: Offer = {
    id: uid(), nr, firma, ort: grab(/Firmenort:\s*(.+)/), runde: g.files.some((f) => /nachverh/i.test(f.path)) ? 2 : 1,
    datum, lose: [], nachlass: null, nachlassLose: [], skonto: null, prices, summen: {}, pruef: {},
    textErg: doc.positions.filter((p) => p.bieterText).map((p) => ({ oz: p.oz, text: p.bieterText! })),
    nachforderung, dateien, warnungen, quelle: base(used.path),
  };
  const docs: DocFile[] = g.files
    .filter((f) => /\.(pdf|png|jpe?g)$/i.test(f.path) && f.data.length <= 9_000_000)
    .filter((f) => !/(^|\/)(Angebot\d+_L|.*\bLV\b.*)\.pdf$/i.test(f.path) && !/leistungsverzeichnis/i.test(f.path))
    .filter((f, i, arr) => arr.findIndex((x) => x.data.length === f.data.length && base(x.path) === base(f.path)) === i)
    .map((f) => ({ name: base(f.path), path: f.path.slice(g.root.length ? g.root.length + 1 : 0), data: f.data, kat: kategorie(f.path), mime: /\.pdf$/i.test(f.path) ? 'application/pdf' : /\.png$/i.test(f.path) ? 'image/png' : 'image/jpeg' }));
  return { offer, doc, sig: sigFound, docs };
}
