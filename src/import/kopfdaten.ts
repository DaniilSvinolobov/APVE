import type { GaebDoc } from '../gaeb/gaeb';
import type { Project } from '../domain/types';

/**
 * Eckdaten der Vergabe für Schritt 1 („Vergabe“), gelesen aus dem eigenen LV: aus dem Kopf der GAEB-Datei
 * (GAEB DA XML: Vergabenummer, Eröffnung, Zuschlagsfrist, Ausführung) und aus dem Text – Deckblatt des LV-PDF
 * bzw. Vorbemerkungen („Vergabenummer: …“, „Bindefrist: …“, „Planverfasser: …“).
 * Vorbelegt werden nur leere Felder; Eingaben von Hand bleiben.
 */
export interface Kopf {
  titel?: string;
  nummer?: string;
  auftraggeber?: string;
  vergabestelle?: string;
  ersteller?: string;
  verfahren?: string;
  eroeffnung?: string; // „JJJJ-MM-TTTHH:MM“
  zuschlagsfrist?: string; // ISO-Datum
  beginn?: string; // Freitext, z. B. „ab 24.08.2026“
  ende?: string; // Freitext
  kostenDatum?: string; // ISO-Datum
  mwst?: number;
}

type TextFeld = 'titel' | 'nummer' | 'auftraggeber' | 'vergabestelle' | 'ersteller' | 'eroeffnung' | 'zuschlagsfrist' | 'beginn' | 'ende' | 'kostenDatum';

const FELDNAME: Record<TextFeld | 'verfahren' | 'mwst', string> = {
  titel: 'Maßnahme', nummer: 'Vergabenummer', auftraggeber: 'Auftraggeber', vergabestelle: 'Vergabestelle', ersteller: 'Verfasser',
  verfahren: 'Vergabeverfahren', eroeffnung: 'Eröffnungstermin', zuschlagsfrist: 'Zuschlagsfrist', beginn: 'Ausführungsbeginn',
  ende: 'Vollendung', kostenDatum: 'Datum des Kostenvoranschlags', mwst: 'MwSt.-Satz',
};

const DATUM = String.raw`(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})`;
const isoAus = (t: string, m = t.match(new RegExp(DATUM))) => {
  if (!m) return '';
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  const iso = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? '' : iso;
};
const deDatum = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso);

/** Beschriftungen mit Doppelpunkt; der Wert steht dahinter oder in der nächsten Zeile. */
const LABELS: [Exclude<TextFeld, 'eroeffnung' | 'zuschlagsfrist' | 'kostenDatum'>, RegExp][] = [
  ['nummer', /\b(?:Vergabe-?\s?(?:nummer|nr\.?)|Verfahrens-?\s?(?:nummer|nr\.?)|Ausschreibungs-?\s?(?:nummer|nr\.?)|Vergabe-?Kennung)\s*:/i],
  ['vergabestelle', /\b(?:Vergabestelle|Ausschreibende Stelle)\s*:/i],
  ['auftraggeber', /\b(?:Auftraggeber(?:in)?|Bauherr(?:in|schaft)?)\s*:/i],
  ['ersteller', /\b(?:Planverfasser(?:in)?|Entwurfsverfasser(?:in)?|LV-?\s?Verfasser|Aufgestellt(?:\s+(?:durch|von))?|Objektplan(?:ung|er)|Planungsbüro)\s*:/i],
  ['titel', /(?:^|\s)(?:Bauvorhaben|Baumaßnahme|Maßnahme|Projekt(?:bezeichnung)?|Vorhaben|BV)\s*:/i],
  ['beginn', /\b(?:Ausführungsbeginn|Beginn der (?:Ausführung|Arbeiten|Bauarbeiten|Leistung)|Baubeginn)\s*:/i],
  ['ende', /\b(?:Fertigstellung(?:stermin)?|Vollendung(?: der (?:Ausführung|Arbeiten|Leistung))?|Ausführungsende|Bauende)\s*:/i],
];
const ALLE_LABELS = new RegExp(LABELS.map(([, r]) => r.source.replace(/^\(\?:\^\|\\s\)/, '\\b')).join('|') + String.raw`|\b(?:Datum|Stand|Telefon|Tel\.|E-Mail|Fax|Seite)\s*:`, 'i');

/** Wert hinter einer Beschriftung: bis zur nächsten Beschriftung derselben Zeile, sonst die Folgezeile. */
function wertNach(lines: string[], i: number, ab: number): string {
  const rest = lines[i].slice(ab);
  const cut = rest.search(ALLE_LABELS);
  let v = (cut >= 0 ? rest.slice(0, cut) : rest).trim();
  if (!v && i + 1 < lines.length && !ALLE_LABELS.test(lines[i + 1])) v = lines[i + 1].trim();
  return v.replace(/^[-–:\s]+|[\s,;.]+$/g, '').replace(/\s{2,}/g, ' ').slice(0, 160);
}

/** „Stadt Bedburg, Am Rathaus 1, 50181 Bedburg“ → „Stadt Bedburg“ (Anschrift gehört nicht in den Kopf des Vermerks). */
const ohneAnschrift = (v: string) => {
  const i = v.indexOf(',');
  return i > 0 && /\b\d{5}\b|str(?:\.|aße)|platz|weg\b|allee|postfach/i.test(v.slice(i)) ? v.slice(0, i).trim() : v;
};

const VERFAHREN_TEXT: [RegExp, string][] = [
  [/VOB\/?A[- ]?EU|EU-weit|europaweit|Offenes Verfahren|Nichtoffenes Verfahren|Verhandlungsverfahren/i, 'VOB/A-EU'],
  [/Freihändig/i, 'Freihändige Vergabe'],
  [/UVgO/i, 'UVgO'],
  [/\bVgV\b/i, 'VgV'],
  [/VOB\/?A|Öffentliche Ausschreibung|Beschränkte Ausschreibung/i, 'VOB/A (national)'],
];

/** Eckdaten aus Textzeilen (Deckblatt des LV-PDF, Vorbemerkungen). Die Beschriftungen werden am Anfang gesucht, die MwSt. im ganzen Text. */
export function kopfAusText(lines: string[]): Kopf {
  const k: Kopf = {};
  const vorn = lines.slice(0, 400);
  vorn.forEach((l, i) => {
    for (const [feld, re] of LABELS) {
      if (k[feld]) continue;
      const m = re.exec(l);
      if (!m) continue;
      const v = wertNach(vorn, i, m.index + m[0].length);
      // Werte ohne Buchstaben/Ziffern oder offensichtliche Fließtexte verwerfen
      if (!/[\p{L}\d]/u.test(v) || v.split(' ').length > 18) continue;
      if (feld === 'nummer' && !/\d/.test(v)) continue;
      k[feld] = feld === 'nummer' ? v.split(' ')[0] : ohneAnschrift(v);
    }
    if (!k.eroeffnung) {
      const m = l.match(new RegExp(String.raw`(?:Eröffnungs-?\s?termin|Submission(?:stermin)?|Angebotseröffnung|(?:Ablauf der |Ende der )?Angebotsfrist|Einreichungsfrist)\b[^\d]{0,40}${DATUM}(?:[^\d]{0,20}?(\d{1,2})[:.](\d{2})(?!\d))?`, 'i'));
      if (m) { const iso = isoAus(m[0]); if (iso) k.eroeffnung = iso + (m[4] ? `T${m[4].padStart(2, '0')}:${m[5]}` : ''); }
    }
    if (!k.zuschlagsfrist) {
      const m = l.match(new RegExp(String.raw`(?:Zuschlags-?\s?(?:und\s+)?Bindefrist|Zuschlagsfrist|Bindefrist)\b[^\d]{0,40}${DATUM}`, 'i'));
      if (m) k.zuschlagsfrist = isoAus(m[0]) || undefined;
    }
    if (!k.beginn || !k.ende) {
      const m = l.match(new RegExp(String.raw`(?:Ausführungsfrist|Ausführungszeit(?:raum)?|Bauzeit(?:raum)?|Leistungszeitraum)\b[^\d]{0,30}(${DATUM.replace(/\((?!\?)/g, '(?:')})\s*(?:bis|-|–)\s*(${DATUM.replace(/\((?!\?)/g, '(?:')})`, 'i'));
      if (m) { k.beginn ??= `ab ${deDatum(isoAus(m[1]))}`; k.ende ??= deDatum(isoAus(m[2])); }
    }
    if (!k.verfahren) {
      const m = l.match(/\b(?:Vergabeart|Vergabeverfahren|Verfahrensart|Art der Vergabe)\s*:\s*(.*)$/i);
      const v = m && (m[1].trim() || vorn[i + 1] || '');
      const hit = v && VERFAHREN_TEXT.find(([re]) => re.test(v));
      if (hit) k.verfahren = hit[1];
    }
    if (!k.kostenDatum) {
      const m = l.match(new RegExp(String.raw`\b(?:Stand|Datum|aufgestellt am)\s*:?\s*${DATUM}`, 'i'));
      if (m) k.kostenDatum = isoAus(m[0]) || undefined;
    }
  });
  for (const l of lines) {
    const m = l.match(/(\d{1,2})(?:,0+)?\s*%\s*(?:MwSt|Mehrwertsteuer|Umsatzsteuer|USt)|(?:MwSt|Mehrwertsteuer|Umsatzsteuer|USt)\.?\s*(\d{1,2})(?:,0+)?\s*%/i);
    const n = m ? Number(m[1] ?? m[2]) : 0;
    if (n > 0 && n <= 25) { k.mwst = n; break; }
  }
  return k;
}

/** Eckdaten aus einer GAEB-Datei: Kopf der Datei vor den Vorbemerkungen. `datum` als Datum des Kostenvoranschlags nur bei Phase 82. */
export function kopfAusDoc(doc: GaebDoc): Kopf {
  const t = doc.kopf?.text ? kopfAusText(doc.kopf.text.split('\n').map((l) => l.trim()).filter(Boolean)) : {};
  const g = doc.kopf;
  const k: Kopf = {
    ...t,
    titel: doc.bezeichnung || t.titel,
    auftraggeber: doc.auftraggeber || t.auftraggeber,
    nummer: g?.vergabenummer || t.nummer,
    eroeffnung: g?.eroeffnung || t.eroeffnung,
    zuschlagsfrist: g?.zuschlagsfrist || t.zuschlagsfrist,
    beginn: g?.beginn ? `ab ${deDatum(g.beginn)}` : t.beginn,
    ende: g?.ende ? deDatum(g.ende) : t.ende,
    mwst: g?.mwst ?? t.mwst,
    kostenDatum: doc.phase === 82 && /^\d{4}-\d{2}-\d{2}/.test(doc.datum) ? doc.datum.slice(0, 10) : undefined,
  };
  return k;
}

const DEFAULT_VERFAHREN = 'Nichtförmliches Verfahren';
const DEFAULT_MWST = 19;

/** Welche Felder würde `applyKopf` vorbelegen? (für die Meldung) */
export function kopfLuecken(p: Project, k: Kopf): string[] {
  const out: string[] = [];
  for (const f of Object.keys(FELDNAME) as (keyof typeof FELDNAME)[]) {
    const v = k[f];
    if (v == null || v === '') continue;
    if (f === 'verfahren') { if (p.verfahren === DEFAULT_VERFAHREN && v !== p.verfahren) out.push(FELDNAME[f]); }
    else if (f === 'mwst') { if (p.mwst === DEFAULT_MWST && v !== p.mwst) out.push(FELDNAME[f]); }
    else if (!String(p[f] ?? '').trim()) out.push(FELDNAME[f]);
  }
  return out;
}

/** Leere Felder des Vorhabens mit den Eckdaten belegen; Vergabeverfahren und MwSt. nur, solange sie auf dem Standardwert stehen. */
export function applyKopf(p: Project, k: Kopf) {
  for (const f of Object.keys(FELDNAME) as (keyof typeof FELDNAME)[]) {
    const v = k[f];
    if (v == null || v === '') continue;
    if (f === 'verfahren') { if (p.verfahren === DEFAULT_VERFAHREN) p.verfahren = v as string; }
    else if (f === 'mwst') { if (p.mwst === DEFAULT_MWST) p.mwst = v as number; }
    else if (!String(p[f] ?? '').trim()) p[f] = v as string;
  }
}

/** Zwei Quellen zusammenführen; die erste hat Vorrang. */
export const kopfMerge = (a: Kopf, b: Kopf): Kopf => {
  const out: Kopf = { ...b };
  for (const [key, v] of Object.entries(a) as [keyof Kopf, Kopf[keyof Kopf]][]) if (v != null && v !== '') (out as Record<string, unknown>)[key] = v;
  return out;
};
