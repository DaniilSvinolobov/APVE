/** GAEB-Parser: GAEB 90 (D8x), GAEB 2000 (P8x) und GAEB DA XML (X8x). */

export interface GaebPos {
  oz: string; // Punkt-getrennt, z. B. "01.13.03"
  kurz: string;
  lang: string;
  menge: number | null;
  einheit: string;
  bedarf: boolean;
  ep: number | null;
  gp: number | null;
  bieterText?: string; // Textergänzung des Bieters
}

export interface GaebDoc {
  format: 'D' | 'P' | 'X';
  phase: number; // 83, 84, ...
  projekt: string;
  bezeichnung: string;
  auftraggeber: string;
  bieter: string;
  datum: string; // ISO oder ''
  titles: Record<string, string>; // OZ-Prefix -> Titeltext
  positions: GaebPos[];
  totals: Record<string, number>; // Summe laut Datei je OZ-Prefix
  total: { net: number | null; gross: number | null };
}

const empty = (format: GaebDoc['format'], phase: number): GaebDoc => ({
  format, phase, projekt: '', bezeichnung: '', auftraggeber: '', bieter: '', datum: '',
  titles: {}, positions: [], totals: {}, total: { net: null, gross: null },
});

export const chunkOz = (raw: string) => (/^\d+$/.test(raw) ? raw.match(/.{1,2}/g)!.join('.') : raw);
export const ozKey = (oz: string) => oz.replace(/\./g, '');

const CP850_HI =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0';
function decodeDos(b: Uint8Array): string {
  // GAEB 90 ist meist CP850, manchmal ANSI (CP1252) – anhand typischer Umlaut-Bytes erkennen
  let dos = 0, ansi = 0;
  for (const x of b) {
    if ([0x81, 0x84, 0x94, 0x9a, 0x8e, 0x99, 0xe1].includes(x)) dos++;
    else if ([0xe4, 0xf6, 0xfc, 0xdf, 0xc4, 0xd6, 0xdc].includes(x)) ansi++;
  }
  if (ansi > dos) return new TextDecoder('windows-1252').decode(b);
  let s = '';
  for (const x of b) s += x < 128 ? String.fromCharCode(x) : CP850_HI[x - 128];
  return s;
}
const decode = (b: Uint8Array, enc: string) => new TextDecoder(enc).decode(b);
const num = (s: string | null | undefined) => {
  if (s == null || s.trim() === '') return null;
  const n = Number(s.trim());
  return Number.isFinite(n) ? n : null;
};
const isoDate = (d: string) => {
  const m = d.match(/(\d{2})\.(\d{2})\.(\d{2,4})/);
  if (!m) return '';
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2]}-${m[1]}`;
};

/* ---------- GAEB 90 ---------- */
/**
 * OZ aus dem 9-stelligen Feld. Enthält es Leerzeichen („00     1“), wird es anhand der OZ-Maske aus
 * Satzart 00 (z. B. „1122PPPPI“: Ebene 1 = 2, Ebene 2 = 2, Position = 4, Index = 1 Stelle) zerlegt –
 * so entsteht dieselbe OZ wie in der X-Datei („00.1“). Ohne Leerzeichen bleibt es bei der Zweiergruppierung.
 */
export function dOz(field: string, mask: string): string {
  const f = field.replace(/\s+$/, '');
  if (!/\s/.test(f.trim()) || !mask) return chunkOz(f.trim());
  const parts: string[] = [];
  let pos = 0;
  for (const run of mask.replace(/I+$/, '').match(/(.)\1*/g) ?? []) {
    const part = f.slice(pos, pos + run.length).trim();
    pos += run.length;
    if (part) parts.push(part);
  }
  return parts.join('.');
}

function parseD(buf: Uint8Array): GaebDoc {
  const lines = decodeDos(buf).replace(/\r\n?/g, '\n').split('\n');
  const doc = empty('D', 83);
  let mask = '';
  let cur: GaebPos | null = null;
  let title: string | null = null;
  let titleLines: string[] = [];
  const flushTitle = () => {
    if (title != null) doc.titles[title] = titleLines.join(' ').replace(/\s+/g, ' ').trim();
    title = null;
  };
  for (const l of lines) {
    const t = l.slice(0, 2);
    const body = l.slice(2, 72);
    switch (t) {
      case '00': doc.phase = Number(l.slice(10, 12)) || doc.phase; mask = l.match(/\s([1-9]*P+I?)(?=\d{2}\s)/)?.[1] ?? ''; break;
      case '01': doc.projekt = body.slice(0, 40).trim(); doc.datum = isoDate(l.slice(42, 52)); break;
      case '02': doc.bezeichnung = body.trim(); break;
      case '03': doc.auftraggeber = body.trim(); break;
      case '04': doc.bieter = body.trim(); break;
      case '11': flushTitle(); title = dOz(l.slice(2, 11), mask); titleLines = []; break;
      case '12': if (title != null) titleLines.push(body.trim()); break;
      case '21': {
        flushTitle();
        cur = {
          oz: dOz(l.slice(2, 11), mask), kurz: '', lang: '', menge: null, einheit: l.slice(34, 38).trim(),
          bedarf: /[BE]/.test(l.slice(11, 14).replace(/N/g, '')) , ep: null, gp: null,
        };
        const q = l.slice(23, 34).trim();
        if (/^\d+$/.test(q)) cur.menge = Number(q) / 1000;
        doc.positions.push(cur);
        break;
      }
      case '23': {
        const m = l.match(/^23([\d ]{1,9}?)\s+([-+]?\d{10})\s+([-+]?\d{12})/);
        if (m) doc.positions.push({ oz: dOz(m[1], mask), kurz: '', lang: '', menge: null, einheit: '', bedarf: false, ep: Number(m[2]) / 100, gp: Number(m[3]) / 100 });
        break;
      }
      case '25': if (cur) { cur.kurz = (cur.kurz + ' ' + l.slice(2, 72).trim()).trim(); } break;
      case '26': if (cur) { cur.lang += (cur.lang ? '\n' : '') + l.slice(2, 72).replace(/\s+$/, '').replace(/^ {3}/, ''); } break;
      case '32': {
        const m = l.match(/^32([\d ]{0,9}?)\s+([-+]?\d{12})/);
        if (m) doc.totals[dOz(m[1], mask)] = Number(m[2]) / 100;
        break;
      }
      case '99': {
        const net = l.slice(2, 14).trim();
        const gross = l.slice(25, 37).trim();
        if (/^\d{12}$/.test(net)) doc.total.net = Number(net) / 100;
        if (/^\d{12}$/.test(gross)) doc.total.gross = Number(gross) / 100;
        break;
      }
    }
  }
  flushTitle();
  for (const p of doc.positions) { p.lang = p.lang.replace(/\n{3,}/g, '\n\n').trim(); if (p.lang.startsWith(p.kurz)) p.lang = p.lang.slice(p.kurz.length).trim(); }
  return doc;
}

/* ---------- RTF (GAEB 2000) ---------- */
export function rtfToText(rtf: string): string {
  let out = '';
  let depth = 0;
  const skipAt: number[] = [];
  const skipDest = /^\\(fonttbl|colortbl|stylesheet|info|\*)/;
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === '{') {
      depth++;
      if (skipDest.test(rtf.slice(i + 1, i + 14)) && !skipAt.length) skipAt.push(depth);
    } else if (c === '}') {
      if (skipAt.length && skipAt[skipAt.length - 1] === depth) skipAt.pop();
      depth--;
    } else if (c === '\\') {
      const m = rtf.slice(i + 1).match(/^(?:'([0-9a-fA-F]{2})|u(-?\d+)\??|([a-zA-Z]+)-?\d* ?|(.))/);
      if (!m) continue;
      i += m[0].length;
      if (skipAt.length) continue;
      if (m[1]) out += decode(Uint8Array.of(parseInt(m[1], 16)), 'windows-1252');
      else if (m[2]) out += String.fromCharCode(Number(m[2]) < 0 ? Number(m[2]) + 65536 : Number(m[2]));
      else if (m[3] === 'par' || m[3] === 'line' || m[3] === 'row') out += '\n';
      else if (m[3] === 'tab' || m[3] === 'cell') out += ' ';
      else if (m[4] && '\\{}'.includes(m[4])) out += m[4];
    } else if (!skipAt.length && c !== '\r' && c !== '\n') out += c;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- GAEB 2000 ---------- */
function parseP(buf: Uint8Array, phaseHint: number): GaebDoc {
  const t = decode(buf, 'windows-1252').replace(/\r\n?/g, '\n');
  const doc = empty('P', phaseHint);
  const tag = (s: string, k: string) => {
    const m = s.match(new RegExp(`\\[${k}\\]([\\s\\S]*?)\\[end\\]`));
    return m ? m[1].trim() : '';
  };
  doc.phase = Number(tag(t, 'DP')) || phaseHint;
  doc.bezeichnung = tag(t.slice(0, 4000), 'BEZ');
  doc.datum = isoDate(tag(t.slice(0, 2000), 'DATUM'));
  const re = /#begin\[(LVBEREICH|POSITION)\]\n([\s\S]*?)(?=#begin\[(?:LVBEREICH|POSITION)\]|#end\[LV\]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const body = m[2];
    const oz = chunkOz(tag(body, 'OZ'));
    if (m[1] === 'LVBEREICH') { doc.titles[oz] = tag(body, 'BEZTX').replace(/\s+/g, ' '); continue; }
    doc.positions.push({
      oz,
      kurz: rtfToText(tag(body, 'KURZTEXT')).replace(/\s+/g, ' '),
      lang: rtfToText(tag(body, 'LANGTEXT')),
      menge: num(tag(body, 'MENGE')),
      einheit: tag(body, 'ME'),
      bedarf: /^[BE]/i.test(tag(body, 'BEDARF')) || tag(body, 'POSART') === 'B',
      ep: num(tag(body, 'EP')),
      gp: num(tag(body, 'GB') || tag(body, 'GP')),
    });
  }
  for (const p of doc.positions) if (p.lang.startsWith(p.kurz)) p.lang = p.lang.slice(p.kurz.length).trim();
  return doc;
}

/* ---------- GAEB DA XML ---------- */
type El = Element;
const kids = (e: El, name: string) => Array.from(e.children).filter((c) => c.localName === name);
const kid = (e: El, name: string) => kids(e, name)[0];
const txt = (e: El | undefined) => (e?.textContent ?? '').trim();

function xmlText(e: El | undefined): string {
  if (!e) return '';
  const parts: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) parts.push(n.nodeValue ?? '');
    else if (n.nodeType === 1) {
      const el = n as El;
      for (const c of Array.from(el.childNodes)) walk(c);
      if (['p', 'br'].includes(el.localName)) parts.push('\n');
    }
  };
  walk(e);
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

function parseX(buf: Uint8Array, DOMParserCtor: typeof DOMParser): GaebDoc {
  const xml = new DOMParserCtor().parseFromString(decode(buf, 'utf-8'), 'text/xml');
  const root = xml.documentElement;
  const ns = root.namespaceURI ?? '';
  const phase = Number(ns.match(/DA(\d\d)/)?.[1] ?? 83);
  const doc = empty('X', phase);
  const prj = kid(root, 'PrjInfo');
  // wie bei GAEB 90: bezeichnung = Titel der Maßnahme, projekt = Bezeichnung des LV (NamePrj ist nur die Projektnummer)
  const boqInfo = kid(kid(kid(root, 'Award') ?? root, 'BoQ') ?? root, 'BoQInfo');
  doc.bezeichnung = txt(prj && kid(prj, 'LblPrj')) || txt(prj && kid(prj, 'NamePrj'));
  doc.projekt = txt(boqInfo && kid(boqInfo, 'LblBoQ'));
  doc.datum = txt(kid(kid(root, 'GAEBInfo') ?? root, 'Date'));
  const award = kid(root, 'Award');
  const adr = (parent: El | undefined) => { const c = parent && kid(parent, 'Address'); return c ? [txt(kid(c, 'Name1')), txt(kid(c, 'Name2'))].filter(Boolean).join(' ') : ''; };
  doc.bieter = adr(award && kid(award, 'CTR'));
  doc.auftraggeber = adr(award && kid(award, 'OWN'));
  const boq = award && kid(award, 'BoQ');
  const totals = boq && kid(kid(boq, 'BoQInfo') ?? boq, 'Totals');
  if (totals) { doc.total.net = num(txt(kid(totals, 'TotalNet'))); doc.total.gross = num(txt(kid(totals, 'TotalGross'))); }

  const walk = (body: El | undefined, path: string[]) => {
    if (!body) return;
    for (const c of Array.from(body.children)) {
      if (c.localName === 'BoQCtgy') {
        const p = [...path, c.getAttribute('RNoPart') ?? ''];
        const lbl = kid(c, 'LblTx');
        if (lbl) doc.titles[p.join('.')] = xmlText(lbl).replace(/\s+/g, ' ');
        walk(kid(c, 'BoQBody'), p);
      } else if (c.localName === 'Itemlist') {
        for (const it of kids(c, 'Item')) {
          const oz = [...path, it.getAttribute('RNoPart') ?? ''].join('.');
          const d = kid(it, 'Description');
          const ct = d && kid(d, 'CompleteText');
          const outl = ct && kid(ct, 'OutlineText');
          const detail = ct && kid(ct, 'DetailTxt');
          const kurz = xmlText(outl && (kid(outl, 'OutlTxt') ?? outl)).replace(/\s+/g, ' ');
          const compl = detail && Array.from(detail.getElementsByTagName('*')).filter((e) => e.localName === 'TextComplement');
          const bt = compl && compl.filter((e) => e.getAttribute('Kind') === 'Bidder').map((e) => xmlText(e)).join(' ').replace(/[.\s]{4,}/g, ' ').trim();
          const lang = detail ? xmlText(detail) : '';
          const provis = txt(kid(it, 'Provis'));
          doc.positions.push({
            oz, kurz, lang, menge: num(txt(kid(it, 'Qty'))), einheit: txt(kid(it, 'QU')),
            bedarf: !!provis, ep: num(txt(kid(it, 'UP'))), gp: num(txt(kid(it, 'IT'))),
            bieterText: bt || undefined,
          });
        }
      } else if (c.localName === 'BoQBody') walk(c, path);
    }
  };
  walk(boq && kid(boq, 'BoQBody'), []);
  return doc;
}

export const GAEB_EXT = /\.([dpx])(8\d|9\d)$/i;

export function isGaeb(name: string) { return GAEB_EXT.test(name); }

export function parseGaeb(name: string, data: Uint8Array, DOMParserCtor?: typeof DOMParser): GaebDoc {
  const m = name.match(GAEB_EXT);
  if (!m) throw new Error('Keine GAEB-Datei');
  const f = m[1].toUpperCase();
  const phase = Number(m[2]);
  let doc: GaebDoc;
  if (f === 'D') doc = parseD(data);
  else if (f === 'P') doc = parseP(data, phase);
  else doc = parseX(data, DOMParserCtor ?? DOMParser);
  doc.phase = doc.phase || phase;
  // Summen je Los/Titel, falls nicht in der Datei vorhanden
  if (!Object.keys(doc.totals).length && doc.positions.some((p) => p.gp != null)) {
    for (const p of doc.positions) {
      const parts = p.oz.split('.');
      for (let i = 1; i <= parts.length - 1; i++) {
        const k = parts.slice(0, i).join('.');
        doc.totals[k] = Math.round(((doc.totals[k] ?? 0) + (p.gp ?? 0)) * 100) / 100;
      }
    }
  }
  return doc;
}
