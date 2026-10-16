import JSZip from 'jszip';
import { isGaeb, parseGaeb, ozKey, type GaebDoc } from './gaeb';
import type { Los, Offer, State } from './types';
import { uid, round2 } from './fmt';
import { losPositions } from './calc';

export interface RawFile { path: string; data: Uint8Array }

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;
const base = (p: string) => p.split('/').pop() ?? p;
const dir = (p: string) => p.split('/').slice(0, -1).join('/');

export async function expandZips(files: RawFile[], depth = 0): Promise<RawFile[]> {
  const out: RawFile[] = [];
  for (const f of files) {
    if (JUNK.test(f.path)) continue;
    if (/\.zip$/i.test(f.path) && depth < 3) {
      try {
        const z = await JSZip.loadAsync(f.data);
        const entries = Object.values(z.files).filter((e) => !e.dir);
        const inner: RawFile[] = [];
        for (const e of entries) inner.push({ path: e.name, data: await e.async('uint8array') });
        const roots = new Set(inner.map((i) => i.path.split('/')[0]));
        const prefix = dir(f.path);
        const zipName = base(f.path).replace(/\.zip$/i, '');
        const single = roots.size === 1 && inner.every((i) => i.path.includes('/'));
        const mapped = inner.map((i) => ({ path: [prefix, single ? '' : zipName, i.path].filter(Boolean).join('/'), data: i.data }));
        out.push(...(await expandZips(mapped, depth + 1)));
        continue;
      } catch { /* kein gültiges Zip – als Datei behalten */ }
    }
    out.push(f);
  }
  return out;
}

const hash = (b: Uint8Array) => {
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

const rank = (name: string) => (/\.x/i.test(name) ? 0 : /\.p/i.test(name) ? 1 : 2);

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

export const cleanFirma = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  const i = t.lastIndexOf(',');
  if (i > 0 && !/GmbH|KG|AG|e\.K\.|UG|OHG|GbR/i.test(t.slice(i + 1)) && t.slice(i + 1).trim().length <= 24 && /GmbH|KG|AG|e\.K\.|UG|OHG|GbR|&/.test(t.slice(0, i))) return t.slice(0, i).trim();
  return t;
};

const decodeText = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);

export interface DocFile { name: string; path: string; data: Uint8Array; mime: string }
export interface ParsedBid { offer: Offer; doc: GaebDoc; sig: boolean; docs: DocFile[] }

/** Originaldateien der Angebote (nur im Arbeitsspeicher, für die KI-Dokumentprüfung). */
export const docStore = new Map<string, DocFile[]>();

export function analyzeGroup(g: BidGroup, nextNr: number, DP?: typeof DOMParser): ParsedBid | null {
  const bidFiles = g.files.filter((f) => /\.[dpx]84$/i.test(f.path));
  const warnungen: string[] = [];
  // Duplikate erkennen
  const byHash = new Map<string, RawFile[]>();
  for (const f of bidFiles) byHash.set(hash(f.data), [...(byHash.get(hash(f.data)) ?? []), f]);
  const distinct = [...byHash.values()].map((arr) => arr.sort((a, b) => rank(a.path) - rank(b.path))[0]);
  distinct.sort((a, b) => (/nachverh/i.test(base(b.path)) ? 1 : 0) - (/nachverh/i.test(base(a.path)) ? 1 : 0) || rank(a.path) - rank(b.path));
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

  const dateien = g.files
    .filter((f) => !/\.[dpx]84$/i.test(f.path) && !/signaturbeleg|\.offerinfo/i.test(base(f.path)))
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
    .map((f) => ({ name: base(f.path), path: f.path.slice(g.root.length ? g.root.length + 1 : 0), data: f.data, mime: /\.pdf$/i.test(f.path) ? 'application/pdf' : /\.png$/i.test(f.path) ? 'image/png' : 'image/jpeg' }));
  return { offer, doc, sig: sigFound, docs };
}

/** Lose aus den obersten Titeln des LV ableiten. */
export function losFromTitles(titles: Record<string, string>): Los[] {
  return Object.entries(titles)
    .filter(([k]) => !k.includes('.'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([oz, t]) => {
      const m = t.match(/^\s*(LOS\s*\d+)\s*[-–:]?\s*(.*)$/i);
      return { id: uid(), oz, nr: m ? m[1].replace(/\s+/, '').toUpperCase() : `LOS ${oz}`, name: titleCase(m ? m[2] || t : t), kosten: null, imVermerk: true, imBudget: true };
    });
}

const titleCase = (s: string) => {
  const t = s.trim();
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\bUnd\b/g, 'und');
};

export function applyLv(d: State, doc: GaebDoc) {
  const old = new Map(d.lv.map((p) => [p.oz, p]));
  d.lv = doc.positions
    .filter((p) => p.menge != null || p.kurz)
    .map((p) => ({ oz: p.oz, kurz: p.kurz, menge: old.get(p.oz)?.menge ?? p.menge, mengeOrig: p.menge, einheit: p.einheit, bedarf: p.bedarf }));
  d.titles = doc.titles;
  const lose = losFromTitles(doc.titles);
  for (const l of lose) {
    const ex = d.lose.find((x) => x.oz === l.oz);
    if (ex) { ex.name = ex.name || l.name; }
    else d.lose.push(l);
  }
  d.lose = d.lose.filter((l) => d.lv.some((p) => p.oz.startsWith(l.oz + '.')) || !lose.length);
  if (!d.project.titel && doc.bezeichnung) d.project.titel = doc.bezeichnung;
  if (!d.project.auftraggeber && doc.auftraggeber) d.project.auftraggeber = doc.auftraggeber;
}

/** Fügt ein analysiertes Angebot in den State ein. */
export function applyOffer(d: State, parsed: ParsedBid, sigFound = parsed.sig) {
  const { offer, doc } = parsed;
  if (!d.lv.length) {
    // Fallback: LV aus Bieterdatei ableiten (ohne Texte/Mengen aus der Ausschreibung)
    const pos = doc.positions.map((p) => ({
      oz: p.oz, kurz: p.kurz || '', menge: p.ep ? Math.round(((p.gp ?? 0) / p.ep) * 1000) / 1000 : (p.menge ?? null), mengeOrig: null as number | null, einheit: p.einheit, bedarf: false,
    }));
    d.lv = pos.map((p) => ({ ...p, mengeOrig: p.menge }));
    const titles: Record<string, string> = {};
    for (const p of doc.positions) { const s = p.oz.split('.'); for (let i = 1; i < s.length; i++) { const k = s.slice(0, i).join('.'); titles[k] = doc.titles[k] ?? ''; } }
    d.titles = { ...titles, ...doc.titles };
    for (const l of losFromTitles(Object.fromEntries(Object.entries(d.titles).filter(([k]) => !k.includes('.'))))) if (!d.lose.some((x) => x.oz === l.oz)) d.lose.push({ ...l, name: l.name || `Los ${l.oz}` });
    offer.warnungen.push('Kein Soll-LV geladen – Positionen und Mengen aus der Bieterdatei abgeleitet. Bitte Ausschreibungs-LV (GAEB X83/P83/D83) laden.');
  }
  const known = new Set(d.lv.map((p) => ozKey(p.oz)));
  const extra = Object.keys(offer.prices).filter((k) => !known.has(k));
  if (extra.length) offer.warnungen.push(`${extra.length} Position(en) der Bieterdatei kommen im Soll-LV nicht vor (z. B. ${extra.slice(0, 3).join(', ')}).`);
  const miss = d.lv.filter((p) => !p.bedarf && offer.prices[ozKey(p.oz)]?.ep == null);
  if (miss.length) offer.warnungen.push(`${miss.length} Position(en) des Soll-LV sind in der Bieterdatei nicht bepreist.`);
  offer.lose = d.lose.filter((l) => losPositions(d, l).some((p) => (offer.prices[ozKey(p.oz)]?.ep ?? 0) !== 0)).map((l) => l.id);
  const preise = d.lv.every((p) => p.bedarf || (offer.prices[ozKey(p.oz)]?.ep ?? 0) !== 0 || !offer.lose.some((id) => d.lose.find((l) => l.id === id)?.oz === p.oz.split('.')[0]));
  autoPruef(d, offer, sigFound, preise);
  const eroeff = d.project.eroeffnung.slice(0, 10);
  if (eroeff && offer.datum && offer.datum > eroeff && offer.runde === 1) offer.runde = 2;
  const dup = d.offers.filter((o) => o.firma.toLowerCase().replace(/\W/g, '') === offer.firma.toLowerCase().replace(/\W/g, ''));
  if (dup.length && offer.runde === 1) offer.runde = (Math.min(3, Math.max(...dup.map((o) => o.runde)) + 1)) as 2 | 3;
  if (d.offers.some((o) => o.nr === offer.nr)) offer.nr = Math.max(0, ...d.offers.map((o) => o.nr)) + 1;
  if (offer.nr === 0) offer.nr = 1;
  d.offers.push(offer);
  d.offers.sort((a, b) => a.nr - b.nr);
  void round2;
}

export function ozFirst(oz: string) { return oz.split('.')[0]; }


const SYN: Record<string, RegExp> = {
  '124': /eigenerkl|eignung/, '213': /angebotsschreiben/, '221': /zuschlagskalk/, '222': /endsumme/, '223': /aufgliederung/,
  '233': /nachunternehmer/, '234': /arbeitsgemeinschaft|bietergemeinschaft/, '235': /kapazit/, '248': /holzprodukt/,
};

/** Vollständigkeitsprüfung aus vorhandenen Dateien vorbelegen. */
function autoPruef(d: State, offer: Offer, sigFound: boolean, preise: boolean) {
  const names = offer.dateien.filter((x) => x.kat !== 'Nachforderung').map((x) => x.name.toLowerCase());
  const nach = offer.nachforderung.map((n) => n.toLowerCase());
  const matches = (label: string, list: string[]) => {
    const num = label.match(/\b(\d{3})\b/)?.[1];
    if (num) return list.some((n) => new RegExp(`(^|\\D)${num}(\\D|$)`).test(n) || (SYN[num]?.test(n) ?? false));
    const words = label.toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length >= 9);
    return words.length > 0 && list.some((n) => words.some((w) => n.includes(w)));
  };
  const set = (id: string, s: 'ok' | 'nach', date = '') => { offer.pruef[id] = { s, d: date, k: 'auto' }; };
  for (const u of d.unterlagen) {
    const l = u.label.toLowerCase();
    if (/unterschrieben|signiert/.test(l)) { if (sigFound) set(u.id, 'ok'); }
    else if (/preise vollständig|gaeb/.test(l)) { if (preise) set(u.id, 'ok'); }
    else if (/fristgerecht/.test(l)) { /* nur manuell */ }
    else if (matches(u.label, nach)) set(u.id, 'nach');
    else if (matches(u.label, names)) set(u.id, 'ok');
  }
  // nachgereichte Unterlagen ohne passende Zeile → neue Prüfzeile
  for (const n of offer.nachforderung) {
    if (d.unterlagen.some((u) => matches(u.label, [n.toLowerCase()]))) continue;
    const label = n.replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const row = d.unterlagen.find((u) => u.label === label) ?? { id: uid(), label };
    if (!d.unterlagen.includes(row)) d.unterlagen.push(row);
    set(row.id, 'nach');
  }
}
