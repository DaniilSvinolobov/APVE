import type { GaebDoc } from '../gaeb/gaeb';
import { verfahrenName, type Project } from '../domain/types';

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
  baustelle?: string; // „Baustelle: …“, „Ausführungsort: …“
  agOrt?: string; // „PLZ Ort“ aus der Anschrift des Auftraggebers – Ersatz für die Baustelle, wenn diese nicht genannt ist
}

type TextFeld = 'titel' | 'nummer' | 'auftraggeber' | 'vergabestelle' | 'ersteller' | 'eroeffnung' | 'zuschlagsfrist' | 'beginn' | 'ende' | 'kostenDatum' | 'baustelle';

const FELDNAME: Record<TextFeld | 'verfahren' | 'mwst', string> = {
  titel: 'Maßnahme', nummer: 'Vergabenummer', auftraggeber: 'Auftraggeber', vergabestelle: 'Vergabestelle', ersteller: 'Verfasser',
  verfahren: 'Vergabeverfahren', eroeffnung: 'Eröffnungstermin', zuschlagsfrist: 'Zuschlagsfrist', beginn: 'Ausführungsbeginn',
  ende: 'Vollendung', kostenDatum: 'Datum des Kostenvoranschlags', mwst: 'MwSt.-Satz', baustelle: 'Baustelle',
};

const DATUM = String.raw`(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})`;
const isoAus = (t: string, m = t.match(new RegExp(DATUM))) => {
  if (!m) return '';
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  const iso = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? '' : iso;
};
const deDatum = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso);

/** Beschriftungen je Feld. Gefunden mit Doppelpunkt irgendwo in der Zeile oder ohne Doppelpunkt am Zeilenanfang („Auftraggeber  Stadt Bedburg“). */
const LABEL_KERNE: [Exclude<TextFeld, 'eroeffnung' | 'zuschlagsfrist' | 'kostenDatum'>, string][] = [
  ['nummer', String.raw`Vergabe-?\s?(?:nummer|nr\.?)|Verfahrens-?\s?(?:nummer|nr\.?)|Ausschreibungs-?\s?(?:nummer|nr\.?)|Vergabe-?Kennung|Maßnahmen-?\s?(?:nummer|nr\.?)|Vergabe-?\s?ID`],
  ['vergabestelle', String.raw`Vergabestelle|Ausschreibende Stelle`],
  ['auftraggeber', String.raw`Auftraggeber(?:in)?|Bauherr(?:in|schaft)?|Öffentlicher Auftraggeber`],
  ['ersteller', String.raw`Planverfasser(?:in)?|Entwurfsverfasser(?:in)?|LV-?\s?Verfasser|Aufgestellt(?:\s+(?:durch|von))?|Objektplan(?:ung|er)|Planungsbüro|Planung|Architekt(?:in|en)?|Landschaftsarchitekt(?:in|en)?|Fachplaner(?:in)?`],
  ['titel', String.raw`Bauvorhaben|Baumaßnahme|Maßnahme|Projekt(?:bezeichnung)?|Vorhaben|BV|Objekt`],
  ['beginn', String.raw`Ausführungsbeginn|Beginn der (?:Ausführung|Arbeiten|Bauarbeiten|Leistung)|Baubeginn`],
  ['ende', String.raw`Fertigstellung(?:stermin)?|Vollendung(?: der (?:Ausführung|Arbeiten|Leistung))?|Ausführungsende|Bauende`],
  ['baustelle', String.raw`Baustelle|Lage der Baustelle|Bauort|Ausführungsort|Ort der (?:Ausführung|Leistung|Baustelle|Leistungserbringung)|Leistungsort|Erfüllungsort`],
];
const LABELS = LABEL_KERNE.map(([f, k]) => [f, new RegExp(String.raw`(?:^|[\s(])(?:${k})\s*:`, 'i'), new RegExp(String.raw`^\s*(?:${k})(?:\s+(?=\S)|\s*$)`, 'i')] as const);
const ALLE_LABELS = new RegExp(String.raw`(?:^|[\s(])(?:${LABEL_KERNE.map(([, k]) => k).join('|')}|Datum|Stand|Telefon|Tel\.|E-Mail|Fax|Seite|Projekt-?\s?Nr\.?|LV)\s*:`, 'i');

/** Wert hinter einer Beschriftung: bis zur nächsten Beschriftung derselben Zeile, sonst die Folgezeile. */
function wertNach(lines: string[], i: number, ab: number): string {
  const rest = lines[i].slice(ab);
  const cut = rest.search(ALLE_LABELS);
  let v = (cut >= 0 ? rest.slice(0, cut) : rest).trim();
  // „Planverfasser ...“: Punkte/Striche sind nur Füllzeichen, der Wert steht in der nächsten Zeile
  if (/^[.…\-–_\s]*$/.test(v)) v = '';
  if (!v && i + 1 < lines.length && !ALLE_LABELS.test(lines[i + 1])) v = lines[i + 1].trim();
  return v.replace(/^[-–:\s]+|[\s,;.]+$/g, '').replace(/\s{2,}/g, ' ').slice(0, 160);
}

/** „Stadt Bedburg, Am Rathaus 1, 50181 Bedburg“ → „Stadt Bedburg“ (Anschrift gehört nicht in den Kopf des Vermerks). */
const ohneAnschrift = (v: string) => {
  const i = v.indexOf(',');
  if (i > 0 && /\b\d{5}\b|str(?:\.|aße)|platz|weg\b|allee|postfach/i.test(v.slice(i))) return v.slice(0, i).trim();
  // ohne Komma: vor Straße mit Hausnummer bzw. vor der Postleitzahl abschneiden
  const j = v.search(/\s(?=\S*(?:str\.|straße|platz|weg|allee|ring|gasse|markt)\s+\d)|\s(?=\d{5}\s)/i);
  return j > 0 ? v.slice(0, j).trim() : v;
};

/** „Am Rathaus 1, 50181 Bedburg“ → „50181 Bedburg“ (leer, wenn keine Postleitzahl darin steht). */
const plzOrt = (v: string) => v.match(/(?<!\d)(\d{5})\s+([\p{L}][\p{L}.\s-]*[\p{L}.])/u)?.slice(1, 3).join(' ') ?? undefined;

/**
 * Vergabeverfahren aus einer Angabe wie „Beschränkte Ausschreibung ohne Teilnahmewettbewerb“ (Kopf der Formblätter);
 * null, wenn Verfahrensart oder Regelwerk nicht eindeutig sind (z. B. „Beschränkte Ausschreibung“ ohne „mit/ohne Teilnahmewettbewerb“).
 * Ohne Angabe des Regelwerks gilt bei Bauleistungen die VOB/A (national) bzw. VOB/A-EU für die EU-Verfahren.
 */
export function verfahrenAus(t: string): string | null {
  const tw = /ohne\s+(?:öffentlichen\s+)?Teilnahme-?\s?wettbewerb/i.test(t) ? 'ohne' : /(?:mit|nach)\s+(?:öffentlichem\s+)?Teilnahme-?\s?wettbewerb/i.test(t) ? 'mit' : null;
  const mitTw = (art: string) => (tw ? `${art} ${tw} Teilnahmewettbewerb` : null);
  const eu = /VOB\/?A[- ]?EU|§\s?\d+[a-z]?\s?EU\b|EU-weit|europaweit|\bVgV\b|Offenes Verfahren|Nicht\s?-?offenes Verfahren|Verhandlungsverfahren|Wettbewerblicher Dialog|Innovationspartnerschaft/i.test(t);
  const regel = /\bVgV\b/i.test(t) ? 'VgV' : /UVgO|Verhandlungsvergabe/i.test(t) ? 'UVgO' : eu ? 'VOB/A-EU' : 'VOB/A';
  const art = eu
    ? /Nicht\s?-?offenes Verfahren/i.test(t) ? 'Nicht offenes Verfahren'
      : /Offenes Verfahren/i.test(t) ? 'Offenes Verfahren'
      : /Verhandlungsverfahren/i.test(t) ? mitTw('Verhandlungsverfahren')
      : /Wettbewerblicher Dialog/i.test(t) ? 'Wettbewerblicher Dialog'
      : /Innovationspartnerschaft/i.test(t) ? 'Innovationspartnerschaft'
      : null
    : /Direktauftrag/i.test(t) ? 'Direktauftrag'
      : /Öffentliche Ausschreibung/i.test(t) ? 'Öffentliche Ausschreibung'
      : /Beschränkte Ausschreibung/i.test(t) ? mitTw('Beschränkte Ausschreibung')
      : /Verhandlungsvergabe/i.test(t) ? mitTw('Verhandlungsvergabe')
      : /Freihändig/i.test(t) && regel === 'VOB/A' ? 'Freihändige Vergabe'
      : null;
  return art ? verfahrenName(art, regel) : null;
}

/** Eckdaten aus Textzeilen (Deckblatt des LV-PDF, Vorbemerkungen). Die Beschriftungen werden am Anfang gesucht, die MwSt. im ganzen Text. */
export function kopfAusText(lines: string[]): Kopf {
  const k: Kopf = {};
  const vorn = lines.slice(0, 400);
  vorn.forEach((l, i) => {
    for (const [feld, mitDp, amAnfang] of LABELS) {
      if (k[feld]) continue;
      // ohne Doppelpunkt nur auf dem Deckblatt (Vorbemerkungen enthalten Überschriften wie „Beginn der Arbeiten“)
      const m = mitDp.exec(l) ?? (i < 80 ? amAnfang.exec(l) : null);
      if (!m) continue;
      const v = wertNach(vorn, i, m.index + m[0].length);
      // Werte ohne Buchstaben/Ziffern oder offensichtliche Fließtexte verwerfen (ohne Doppelpunkt strenger: kurz, beginnt groß)
      if (!/[\p{L}\d]/u.test(v) || v.split(' ').length > 18) continue;
      // „k.A.“ = keine Angabe; ein Wert, der selbst eine Beschriftung ist (Spaltenköpfe „Ausführungsbeginn Ausführungsende“), zählt nicht
      if (/^(?:k\.\s?A\.?|keine Angabe?n?|n\.\s?a\.?)(?:\s|$)/i.test(v) || LABELS.some(([, , a]) => a.test(v))) continue;
      if (!m[0].includes(':') && (v.split(' ').length > 10 || !/^[\p{Lu}\d]/u.test(v))) continue;
      if (feld === 'nummer' && !/\d/.test(v)) continue;
      // Baustelle nur mit Doppelpunkt („Baustelle ist während …“ in den Vorbemerkungen ist kein Ort)
      if (feld === 'baustelle' && (!m[0].includes(':') || v.split(' ').length > 8)) continue;
      if (feld === 'auftraggeber' && !k.agOrt) k.agOrt = plzOrt(v);
      if ((feld === 'beginn' || feld === 'ende') && !/\d{1,2}\.\d{1,2}\.|\bKW\b|\b20\d\d\b|sofort|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|Frühjahr|Sommer|Herbst|Winter|Quartal|Woche|Monat|Tag/i.test(v)) continue;
      k[feld] = feld === 'nummer' ? v.split(' ')[0] : feld === 'baustelle' ? v : ohneAnschrift(v);
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
      const hit = v && verfahrenAus(v);
      if (hit) k.verfahren = hit;
    }
    if (!k.kostenDatum) {
      const m = l.match(new RegExp(String.raw`\b(?:Stand|Datum|aufgestellt am)\s*:?\s*${DATUM}`, 'i'));
      if (m) k.kostenDatum = isoAus(m[0]) || undefined;
      // Fußzeile von AVA-Ausdrucken: „07.04.2026 - Seite 1“
      const f = !k.kostenDatum && l.match(new RegExp(String.raw`^\s*${DATUM}\s*[-–]\s*Seite\s+1\b`, 'i'));
      if (f) k.kostenDatum = isoAus(f[0]) || undefined;
    }
  });
  // Ausführungszeitraum im Fließtext der Vorbemerkungen („… im Zeitraum von August 26 bis Mitte Oktober 26.“), auch über Zeilen hinweg
  if (!k.beginn && !k.ende) {
    const MONAT = String.raw`(?:Anfang|Mitte|Ende)?\s*(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(?:20)?\d{2}|KW\s*\d{1,2}(?:\s*\/?\s*(?:20)?\d{2})?|\d{1,2}\.\d{1,2}\.\d{2,4}`;
    const m = vorn.join(' ').match(new RegExp(String.raw`(?:Zeitraum|Ausführungszeitraum|Bauzeit)\s+(?:von|vom)?\s*(${MONAT})\s+bis\s+(?:zum\s+)?(${MONAT})`, 'i'));
    const jahr = (t: string) => t.trim().replace(/\s+/g, ' ').replace(/(\p{L})\s+(\d{2})$/u, '$1 20$2');
    if (m) { k.beginn = `ab ${jahr(m[1])}`; k.ende = jahr(m[2]); }
  }
  for (const l of lines) {
    const m = l.match(/(\d{1,2})(?:,0+)?\s*%\s*(?:MwSt|Mehrwertsteuer|Umsatzsteuer|USt)|(?:MwSt|Mehrwertsteuer|Umsatzsteuer|USt)\.?\s*\(?\s*(\d{1,2})(?:,0+)?\s*%/i);
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
    agOrt: doc.auftraggeberOrt || t.agOrt,
  };
  return k;
}

const DEFAULT_VERFAHREN = ''; // „bitte wählen“
const DEFAULT_MWST = 19;

/** Welche Felder würde `applyKopf` vorbelegen? (für die Meldung) */
export function kopfLuecken(p: Project, k: Kopf): string[] {
  const out: string[] = [];
  if (!k.baustelle && k.agOrt && !p.baustelle?.trim()) out.push('Baustelle (Ort des Auftraggebers)');
  for (const f of Object.keys(FELDNAME) as (keyof typeof FELDNAME)[]) {
    const v = k[f];
    if (v == null || v === '') continue;
    if (f === 'verfahren') { if (p.verfahren === DEFAULT_VERFAHREN && v !== p.verfahren) out.push(FELDNAME[f]); }
    else if (f === 'mwst') { if (p.mwst === DEFAULT_MWST && v !== p.mwst) out.push(FELDNAME[f]); }
    else if (!String(p[f] ?? '').trim()) out.push(FELDNAME[f]);
  }
  return out;
}

/** Felder, die leer sind und auch im LV nicht gefunden wurden (für die Meldung „Nicht im LV gefunden“). */
export function kopfFehlt(p: Project, k: Kopf): string[] {
  const felder: TextFeld[] = ['titel', 'nummer', 'auftraggeber', 'vergabestelle', 'ersteller', 'eroeffnung', 'zuschlagsfrist', 'beginn', 'ende', 'baustelle'];
  return felder.filter((f) => !String(p[f] ?? '').trim() && !k[f] && !(f === 'baustelle' && k.agOrt)).map((f) => FELDNAME[f]);
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
  // ohne Angabe im LV: Ort des Auftraggebers als Baustelle annehmen (bei kommunalen Maßnahmen meist zutreffend; im Schritt „Vergabe“ prüfen)
  if (!p.baustelle?.trim() && k.agOrt) p.baustelle = k.agOrt;
}

/** Zwei Quellen zusammenführen; die erste hat Vorrang. */
export const kopfMerge = (a: Kopf, b: Kopf): Kopf => {
  const out: Kopf = { ...b };
  for (const [key, v] of Object.entries(a) as [keyof Kopf, Kopf[keyof Kopf]][]) if (v != null && v !== '') (out as Record<string, unknown>)[key] = v;
  return out;
};
