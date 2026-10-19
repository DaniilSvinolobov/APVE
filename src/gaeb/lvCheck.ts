/** Plausibilitätsprüfung eines LV: innerhalb einer GAEB-Datei, zwischen mehreren Dateien (X/P/D, 81/82/83) und gegen das PDF. */
import type { GaebDoc, GaebPos } from './gaeb';

export interface Befund { kind: 'bad' | 'warn' | 'info'; text: string; quelle: 'gaeb' | 'pdf' }

const r2 = (n: number) => Math.round(n * 100) / 100;
const de = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
/** Text vergleichbar machen: Leerraum (auch geschützt), Anführungszeichen und Groß-/Kleinschreibung ignorieren. */
export const normText = (t: string) => t.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[‘’´`'"“”„]/g, '').trim();
/** OZ vergleichbar machen: führende Nullen je Ebene ignorieren („00.0001“ = „00.1“). */
export const ozNorm = (oz: string) => oz.split(/[.\s]+/).filter(Boolean).map((p) => (/^\d+$/.test(p) ? String(Number(p)) : p)).join('.');

const sample = (items: string[], n = 4) => `${items.slice(0, n).join(', ')}${items.length > n ? ` … (+${items.length - n})` : ''}`;
const nPos = (n: number) => `${n} Position${n === 1 ? '' : 'en'}`;

/** Prüfungen innerhalb einer Datei. */
export function pruefeLvDatei(name: string, doc: GaebDoc): Befund[] {
  const out: Befund[] = [];
  const add = (kind: Befund['kind'], text: string) => out.push({ kind, text: `${name}: ${text}`, quelle: 'gaeb' });
  const pos = doc.positions;
  const seen = new Set<string>(), dup = new Set<string>();
  for (const p of pos) { const k = ozNorm(p.oz); if (seen.has(k)) dup.add(p.oz); seen.add(k); }
  if (dup.size) add('bad', `Ordnungszahl mehrfach vergeben: ${sample([...dup])}`);

  const real = pos.filter((p) => !p.bedarf);
  const noQty = real.filter((p) => !p.menge);
  if (noQty.length) add('warn', `${nPos(noQty.length)} ohne Menge (oder Menge 0): ${sample(noQty.map((p) => p.oz))}`);
  const noUnit = pos.filter((p) => !p.einheit);
  if (noUnit.length) add('warn', `${nPos(noUnit.length)} ohne Einheit: ${sample(noUnit.map((p) => p.oz))}`);
  const noText = pos.filter((p) => !p.kurz.trim());
  if (noText.length) add('warn', `${nPos(noText.length)} ohne Kurztext: ${sample(noText.map((p) => p.oz))}`);
  const neg = pos.filter((p) => (p.menge ?? 0) < 0);
  if (neg.length) add('warn', `${nPos(neg.length)} mit negativer Menge: ${sample(neg.map((p) => p.oz))}`);

  const leer = Object.keys(doc.titles).filter((k) => !pos.some((p) => p.oz.startsWith(k + '.')));
  if (leer.length) add('info', `Titel ohne Positionen: ${sample(leer.map((k) => `${k} ${doc.titles[k]}`.trim()))}`);

  // Rechenprüfung, sofern die Datei Preise enthält (z. B. X82)
  const priced = pos.filter((p) => p.ep != null && p.gp != null && p.menge != null);
  const calcOff = priced.filter((p) => Math.abs(r2(p.menge! * p.ep!) - p.gp!) > 0.01);
  if (calcOff.length) add('bad', `Menge × Einheitspreis ≠ Gesamtbetrag bei ${nPos(calcOff.length)}: ${sample(calcOff.map((p) => p.oz))}`);
  const withGp = pos.filter((p) => p.gp != null && !p.bedarf);
  if (doc.total.net != null && withGp.length) {
    const sum = r2(withGp.reduce((a, p) => a + p.gp!, 0));
    if (Math.abs(sum - doc.total.net) > 0.05) add('bad', `Summe der Positionen (${de(sum)} €) weicht von der Endsumme der Datei (${de(doc.total.net)} €) ab`);
  }
  return out;
}

const einheitNorm = (e: string) => e.toLowerCase().replace(/\s+/g, '').replace('qm', 'm²').replace('cbm', 'm³');

/** Zwei GAEB-Dateien desselben LV gegeneinander prüfen (Positionen, Mengen, Einheiten, Texte). */
export function vergleicheLv(a: { name: string; doc: GaebDoc }, b: { name: string; doc: GaebDoc }): Befund[] {
  const out: Befund[] = [];
  const head = `${a.name} ↔ ${b.name}`;
  const add = (kind: Befund['kind'], text: string) => out.push({ kind, text: `${head}: ${text}`, quelle: 'gaeb' });
  const mb = new Map(b.doc.positions.map((p) => [ozNorm(p.oz), p]));
  const ma = new Map(a.doc.positions.map((p) => [ozNorm(p.oz), p]));
  const nurA = a.doc.positions.filter((p) => !mb.has(ozNorm(p.oz)));
  const nurB = b.doc.positions.filter((p) => !ma.has(ozNorm(p.oz)));
  if (nurA.length) add('bad', `${nPos(nurA.length)} nur in ${a.name}: ${sample(nurA.map((p) => p.oz))}`);
  if (nurB.length) add('bad', `${nPos(nurB.length)} nur in ${b.name}: ${sample(nurB.map((p) => p.oz))}`);
  const both: [GaebPos, GaebPos][] = a.doc.positions.filter((p) => mb.has(ozNorm(p.oz))).map((p) => [p, mb.get(ozNorm(p.oz))!]);
  const qty = both.filter(([p, q]) => (p.menge ?? 0) !== (q.menge ?? 0));
  if (qty.length) add('bad', `Menge unterschiedlich bei ${nPos(qty.length)}: ${sample(qty.map(([p, q]) => `${p.oz} (${p.menge ?? '–'} ↔ ${q.menge ?? '–'})`))}`);
  const me = both.filter(([p, q]) => einheitNorm(p.einheit) !== einheitNorm(q.einheit));
  if (me.length) add('bad', `Einheit unterschiedlich bei ${nPos(me.length)}: ${sample(me.map(([p, q]) => `${p.oz} (${p.einheit || '–'} ↔ ${q.einheit || '–'})`))}`);
  const bd = both.filter(([p, q]) => p.bedarf !== q.bedarf);
  if (bd.length) add('warn', `Bedarfs-/Eventualposition unterschiedlich bei ${nPos(bd.length)}: ${sample(bd.map(([p]) => p.oz))}`);
  const tx = both.filter(([p, q]) => normText(p.kurz) !== normText(q.kurz));
  if (tx.length) add('warn', `Kurztext unterschiedlich bei ${nPos(tx.length)}: ${sample(tx.map(([p]) => p.oz))}`);
  return out;
}

/* ---------- PDF ---------- */

export interface PdfPos { oz: string; menge: number | null; einheit: string; ep: number | null; gp: number | null }
export interface RefPos { oz: string; menge: number | null; einheit: string; ep?: number | null; gp?: number | null; kurz?: string; bedarf?: boolean }

const NUM = String.raw`\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?`;
/** Preis mit Vorzeichen (Gutschriften, z. B. Schrotterlös). */
const SNUM = String.raw`-?(?:${NUM})`;
const deNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OZ_START = /^(\d{1,2}(?:\.\d{1,4}){1,4})(?=\s|$)/;

/**
 * Positionen aus den Textzeilen eines LV-PDF lesen. Die Positionen des Vergleichs (`ref`) geben vor, welche
 * Ordnungszahlen gesucht werden und welche Einheit hinter der Menge steht – das macht das Lesen unabhängig vom
 * Layout der Ausgabe (Spalten, Seitenumbrüche, Texte über mehrere Zeilen).
 */
export function parseLvPdf(lines: string[], ref: RefPos[]): PdfPos[] {
  const refBy = new Map(ref.map((p) => [ozNorm(p.oz), p]));
  const tops = new Set(ref.map((p) => ozNorm(p.oz).split('.')[0]));
  // Titel (Lose, Abschnitte): jede Vorstufe einer Positions-OZ – deren Überschriften und Titelsummen sind keine Positionen
  const titel = new Set(ref.flatMap((p) => ozNorm(p.oz).split('.').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('.'))));
  const blocks: { oz: string; text: string; known: boolean; titel?: boolean }[] = [];
  for (const line of lines) {
    const m = line.trim().match(OZ_START);
    const isDate = !!m && /^\d{1,2}\.\d{1,2}\.(19|20)?\d{2}$/.test(m[1]);
    if (m && refBy.has(ozNorm(m[1]))) blocks.push({ oz: m[1], text: line.trim().slice(m[1].length), known: true });
    else if (m && !isDate && titel.has(ozNorm(m[1]))) blocks.push({ oz: m[1], text: '', known: false, titel: true });
    // OZ-artige Zeile, die das GAEB nicht kennt (aber in einem bekannten Titel liegt) – nur melden, nicht auswerten
    else if (m && !isDate && /^\d{2}\./.test(m[1]) && tops.has(ozNorm(m[1]).split('.')[0]) && /\s\S/.test(line.trim().slice(m[1].length))) blocks.push({ oz: m[1], text: '', known: false });
    else if (blocks.length && !/^(Übertrag|Summe|Seite)\b/i.test(line.trim())) blocks[blocks.length - 1].text += ' ' + line.trim();
  }
  const out: PdfPos[] = [];
  for (const b of blocks) {
    if (b.titel) continue;
    if (!b.known) { out.push({ oz: b.oz, menge: null, einheit: '', ep: null, gp: null }); continue; }
    const r = refBy.get(ozNorm(b.oz))!;
    const unit = r.einheit ? esc(r.einheit) : '[^\\s\\d]{1,6}';
    // Punktlinien („EP........ 50,00“) und Seitenüberträge entfernen
    const text = b.text.replace(/ /g, ' ').replace(/\.{3,}/g, ' ').replace(new RegExp(String.raw`Übertrag:?\s*(${SNUM})`, 'gi'), ' ');
    // Layout „EP 50,00 GP 300,00 6 St“ (Preise vor der Menge, Pauschalen nur mit GP): beschriftete Werte haben Vorrang
    const lab = [...text.matchAll(new RegExp(String.raw`(?:\bEP:?\s*(${SNUM})\s+)?\bGP:?\s*(${SNUM})\s+(${NUM})\s*${unit}(?=\s|$)`, 'gi'))].pop();
    if (lab) {
      const menge = deNum(lab[3]), gp = deNum(lab[2]);
      const ep = lab[1] != null ? deNum(lab[1]) : menge ? Math.round((gp / menge) * 1000) / 1000 : null;
      out.push({ oz: b.oz, menge, einheit: r.einheit, ep, gp });
      continue;
    }
    // Menge Einheit [EP GP] – das letzte Vorkommen im Block gilt (Texte nennen oft Maße wie „3 cm“)
    const priced = [...text.matchAll(new RegExp(String.raw`(${NUM})\s*${unit}(?=\s)\s+(${SNUM})\s+(${SNUM})`, 'gi'))].pop();
    const plain = [...text.matchAll(new RegExp(String.raw`(${NUM})\s*${unit}(?=\s|$)`, 'gi'))].pop();
    // Fallback ohne passende Einheit im Text: letztes Zahlentripel Menge · EP · GP, das rechnerisch aufgeht
    const nums = [...text.matchAll(new RegExp(String.raw`(?<![\d.,-])(${SNUM})(?![\d.,])`, 'g'))].map((m) => deNum(m[1]));
    let tri: [number, number, number] | null = null;
    for (let i = nums.length - 3; i >= 0 && !tri; i--) if (Math.abs(r2(nums[i] * nums[i + 1]) - nums[i + 2]) <= 0.01 && nums[i + 1] !== 0) tri = [nums[i], nums[i + 1], nums[i + 2]];
    if (!priced && tri) { out.push({ oz: b.oz, menge: tri[0], einheit: r.einheit, ep: tri[1], gp: tri[2] }); continue; }
    if (priced) out.push({ oz: b.oz, menge: deNum(priced[1]), einheit: r.einheit, ep: deNum(priced[2]), gp: deNum(priced[3]) });
    else if (plain) out.push({ oz: b.oz, menge: deNum(plain[1]), einheit: r.einheit, ep: null, gp: null });
    else out.push({ oz: b.oz, menge: null, einheit: '', ep: null, gp: null });
  }
  // Dieselbe OZ mehrfach (z. B. in Vorbemerkungen aufgezählt): den Eintrag mit den meisten Angaben behalten
  const score = (p: PdfPos) => (p.ep != null ? 2 : 0) + (p.menge != null ? 1 : 0);
  const best = new Map<string, PdfPos>();
  for (const p of out) { const k = ozNorm(p.oz), alt = best.get(k); if (!alt || score(p) >= score(alt)) best.set(k, p); }
  return out.filter((p) => best.get(ozNorm(p.oz)) === p);
}

/** Nettosumme eines LV-PDF: „Summe“ bzw. „Summe netto“ (vor der MwSt.), sonst „Gesamtsumme (netto)“. */
export function pdfLvSumme(lines: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].replace(/\.{3,}/g, ' ').trim().match(/^(?:Summe(?:[\s,]*\(?\s*netto\s*\)?)?|Gesamtsumme[\s,]*\(?\s*netto\s*\)?)\s*:?\s*(?:EUR|€)?\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:EUR|€)?$/i);
    if (m) return deNum(m[1]);
  }
  return pdfNettoSumme(lines);
}

/** „Gesamtsumme (netto)“ eines Angebots-PDF, sofern vorhanden. */
export function pdfNettoSumme(lines: string[]): number | null {
  for (const l of lines) { const m = l.match(/Gesamtsumme\s*\(\s*netto\s*\)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i); if (m) return deNum(m[1]); }
  return null;
}

/** PDF-Positionen gegen die GAEB-Positionen halten. `mitPreisen`: Bieter-PDF (EP/GP prüfen) statt Ausschreibungs-LV. */
export function vergleichePdf(name: string, pdf: PdfPos[], ref: RefPos[], mitPreisen: boolean): Befund[] {
  const out: Befund[] = [];
  const add = (kind: Befund['kind'], text: string) => out.push({ kind, text: `${name}: ${text}`, quelle: 'pdf' });
  const mp = new Map(pdf.map((p) => [ozNorm(p.oz), p]));
  if (!pdf.length) { add('warn', 'Keine Positionen im PDF gefunden (Scan ohne Text oder abweichendes Layout) – bitte manuell mit der GAEB-Datei vergleichen.'); return out; }
  const fehlt = ref.filter((p) => !mp.has(ozNorm(p.oz)));
  if (fehlt.length) add('bad', `${fehlt.length === 1 ? '1 Position der GAEB-Datei fehlt' : `${fehlt.length} Positionen der GAEB-Datei fehlen`} im PDF: ${sample(fehlt.map((p) => p.oz))}`);
  const both = ref.filter((p) => mp.has(ozNorm(p.oz))).map((p) => [p, mp.get(ozNorm(p.oz))!] as const);
  const unlesbar = both.filter(([, q]) => q.menge == null);
  if (unlesbar.length) add('info', `Menge im PDF nicht lesbar bei ${nPos(unlesbar.length)}: ${sample(unlesbar.map(([p]) => p.oz))}`);
  const qty = both.filter(([p, q]) => q.menge != null && Math.abs((p.menge ?? 0) - q.menge) > 0.0005);
  if (qty.length) add('bad', `Menge im PDF weicht von der GAEB-Datei ab bei ${nPos(qty.length)}: ${sample(qty.map(([p, q]) => `${p.oz} (PDF ${q.menge} ↔ GAEB ${p.menge ?? '–'})`))}`);
  if (mitPreisen) {
    const ep = both.filter(([p, q]) => q.ep != null && p.ep != null && Math.abs(p.ep - q.ep) > 0.005);
    if (ep.length) add('bad', `Einheitspreis im PDF weicht von der GAEB-Datei ab bei ${nPos(ep.length)}: ${sample(ep.map(([p, q]) => `${p.oz} (PDF ${de(q.ep!)} ↔ GAEB ${de(p.ep!)})`))}`);
    const gp = both.filter(([p, q]) => q.gp != null && p.gp != null && Math.abs(p.gp - q.gp) > 0.01);
    if (gp.length) add('bad', `Gesamtbetrag im PDF weicht von der GAEB-Datei ab bei ${nPos(gp.length)}: ${sample(gp.map(([p, q]) => `${p.oz} (PDF ${de(q.gp!)} ↔ GAEB ${de(p.gp!)})`))}`);
    const rechen = pdf.filter((q) => q.menge != null && q.ep != null && q.gp != null && Math.abs(r2(q.menge * q.ep) - q.gp) > 0.01);
    if (rechen.length) add('bad', `Im PDF ist Menge × Einheitspreis ≠ Gesamtbetrag bei ${nPos(rechen.length)}: ${sample(rechen.map((q) => q.oz))}`);
    const ohnePreis = both.filter(([p, q]) => p.ep != null && q.ep == null && q.menge != null);
    if (ohnePreis.length) add('info', `Preis im PDF nicht lesbar bei ${nPos(ohnePreis.length)}: ${sample(ohnePreis.map(([p]) => p.oz))}`);
  }
  const refKeys = new Set(ref.map((p) => ozNorm(p.oz)));
  const extra = pdf.filter((q) => !refKeys.has(ozNorm(q.oz)));
  if (extra.length) add('bad', `${nPos(extra.length)} im PDF, aber nicht in der GAEB-Datei: ${sample(extra.map((q) => q.oz))}`);
  if (!out.length) add('info', `PDF stimmt mit der GAEB-Datei überein (${pdf.length} Positionen geprüft).`);
  return out;
}
