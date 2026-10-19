import type { GaebDoc, GaebPos } from '../gaeb/gaeb';
import { ozNorm, pdfLvSumme, type Befund } from '../gaeb/lvCheck';

/**
 * Eigenes LV nur als PDF (keine GAEB-Datei vorhanden): Positionen, Mengen, Einheiten, Titel und – bei einem
 * bepreisten LV – Einheitspreise direkt aus den Textzeilen lesen. Ergebnis ist ein GaebDoc wie aus einer X83/X82,
 * damit der Rest der App unverändert arbeitet. Liefert null, wenn das PDF nicht wie ein LV aussieht.
 */

const NUM = String.raw`\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?`;
const SNUM = String.raw`-?(?:${NUM})`;
/** Übliche LV-Einheiten (bewusst ohne cm/mm, die in Langtexten als Maße vorkommen). */
const EINHEIT = String.raw`m²|m2|qm|m³|m3|cbm|lfm|lfdm|m|St(?:ck|k|\.)?|Stück|psch|pschl|pauschal|PA|h|Std\.?|t|kg|l|km|Wo|Woche[n]?|Mon(?:at)?|Mt|d|Tag(?:e)?|StWo|StTag|Satz|Sa|Paar|Pa|ha|a`;
const deNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Positionszeile: OZ mit mindestens zwei Stufen, danach Text (z. B. „01.1 Abdichtung … KG: - KG: -“). */
const POS_START = /^(\d{1,3}(?:\.\d{1,4}){1,4})\s+(\S.*)$/;
/** Titelzeile: „01 Titel Abdichtungen“, „01.02 Titel …“ (Inhaltsverzeichnis mit Seitenzahl am Ende). */
const TITEL = /^(\d{1,3}(?:\.\d{1,4}){0,3})\s+(?:Titel|Untertitel|Abschnitt|Los)\s+(.+?)(?:\s+\d{1,4}(?:\s+[\d.,]+)?)?$/i;
/** LV-Zeile im Seitenkopf: „01 LV Landschaftstreppe - Landschaftsarbeiten“. */
const LV_ZEILE = /^\d{1,3}\s+LV\s+(.+)$/;
/** Seitenkopf/-fuß und Überträge – gehören zu keiner Position. */
const RAUSCHEN = /^(?:Übertrag|Summe|Seite|Alle Einzelbeträge|Nr\.\s+(?:Leistungsbeschreibung|Bezeichnung)|- Fortsetzung|Gesamtsumme|zzgl\.)|\d{2}\.\d{2}\.\d{4}\s*-\s*Seite\s+\d+/i;
const BEDARF = /\b(?:Bedarfsposition|Eventualposition|Alternativposition|Wahlposition|nur Einh(?:eits)?\.?-?Pr(?:eis)?|NEP)\b/i;

interface Block { oz: string; kopf: string; zeilen: string[] }

function auswerten(b: Block): GaebPos | null {
  const text = b.zeilen.join(' ').replace(/ /g, ' ').replace(/\.{3,}|…+/g, ' ').replace(/\s+/g, ' ');
  let menge: number | null = null, einheit = '', ep: number | null = null, gp: number | null = null;
  // „EP …… 20,00 GP …… 9.920,00 496 m²“ (Preise vor der Menge; Pauschalen nur mit GP)
  const lab = [...text.matchAll(new RegExp(String.raw`(?:\bEP:?\s*(${SNUM})\s+)?\bGP:?\s*(${SNUM})\s+(${NUM})\s*(${EINHEIT})(?=\s|$)`, 'gi'))].pop();
  if (lab) {
    menge = deNum(lab[3]); einheit = lab[4]; gp = deNum(lab[2]);
    ep = lab[1] != null ? deNum(lab[1]) : menge ? Math.round((gp / menge) * 1000) / 1000 : gp;
  } else {
    // „496 m² 20,00 9.920,00“ – nur übernehmen, wenn Menge × EP = GP
    const pr = [...text.matchAll(new RegExp(String.raw`(?<![\d.,])(${NUM})\s*(${EINHEIT})\s+(${SNUM})\s+(${SNUM})(?![\d,])`, 'gi'))]
      .filter((m) => Math.abs(r2(deNum(m[1]) * deNum(m[3])) - deNum(m[4])) <= 0.05).pop();
    if (pr) { menge = deNum(pr[1]); einheit = pr[2]; ep = deNum(pr[3]); gp = deNum(pr[4]); }
    else {
      // unbepreistes LV: Menge und Einheit in einer eigenen Zeile („496 m²“), die letzte gilt
      const q = [...b.zeilen].reverse().map((z) => z.trim().match(new RegExp(String.raw`^(${NUM})\s*(${EINHEIT})(?:\s+[._]{3,}.*)?$`, 'i'))).find(Boolean);
      if (q) { menge = deNum(q[1]); einheit = q[2]; }
    }
  }
  if (menge == null) return null;
  const lang = b.zeilen.filter((z) => !/\b[EG]P\b/.test(z) && !new RegExp(String.raw`^(${NUM})\s*(${EINHEIT})$`, 'i').test(z.trim())).join('\n').trim();
  return { oz: b.oz, kurz: b.kopf.replace(/\s+KG:.*$/, '').trim(), lang, menge, einheit, bedarf: BEDARF.test(b.kopf + ' ' + text), ep, gp };
}

export function lvAusPdf(lines: string[]): GaebDoc | null {
  const titles: Record<string, string> = {};
  let lvName = '';
  const blocks: Block[] = [];
  let cur: Block | null = null;
  // Seitenköpfe wiederholen sich auf jeder Seite („SHR - …“, „00 Titel …“) – sie unterbrechen keine Position
  const haeufig = new Map<string, number>();
  for (const raw of lines) { const l = raw.trim(); haeufig.set(l, (haeufig.get(l) ?? 0) + 1); }
  const seitenkopf = (l: string) => (haeufig.get(l) ?? 0) >= 3 && !/^\d[\d.,]*\s*\S{0,6}$/.test(l);
  for (const raw of lines) {
    const l = raw.replace(/ /g, ' ').trim();
    if (!l) continue;
    const t = l.match(TITEL);
    if (t) {
      // neuer Titel beendet die Position; die Wiederholung im Seitenkopf nicht
      if (!(t[1] in titles)) { titles[t[1]] = t[2].trim(); cur = null; }
      else if (!titles[t[1]]) titles[t[1]] = t[2].trim();
      continue;
    }
    const lv = l.match(LV_ZEILE);
    if (lv) { lvName ||= lv[1].trim(); continue; }
    if (/^Summe\b/i.test(l)) { cur = null; continue; }
    if (RAUSCHEN.test(l) || seitenkopf(l)) continue;
    const m = l.match(POS_START);
    // Datum („07.04.2026 …“) und Mengenzeile („1.800 m²“) sind keine OZ
    if (m && !/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(m[1]) && !new RegExp(String.raw`^(?:${EINHEIT})(?:\s+[-\d.,\s]*)?$`, 'i').test(m[2])) { cur = { oz: m[1], kopf: m[2], zeilen: [] }; blocks.push(cur); continue; }
    cur?.zeilen.push(l);
  }
  // Dieselbe OZ kann mehrfach vorkommen (Kurzübersicht in den Vorbemerkungen, dann die Position) – die mit Menge zählt
  const byOz = new Map<string, GaebPos>();
  for (const b of blocks) { const p = auswerten(b); if (p && !byOz.has(ozNorm(p.oz))) byOz.set(ozNorm(p.oz), p); }
  const positions = [...byOz.values()];
  if (positions.length < 3) return null;
  // Titel ohne „Titel“-Zeile: Vorstufen der Positionen mit leerem Text, damit Lose/Summen funktionieren
  for (const p of positions) {
    const parts = p.oz.split('.');
    for (let i = 1; i < parts.length; i++) { const k = parts.slice(0, i).join('.'); titles[k] ??= ''; }
  }
  const priced = positions.filter((p) => p.ep != null).length * 2 >= positions.filter((p) => !p.bedarf).length;
  return {
    format: 'X', phase: priced ? 82 : 83, projekt: lvName, bezeichnung: '', auftraggeber: '', bieter: '', datum: '',
    titles, positions, totals: {}, total: { net: priced ? pdfLvSumme(lines) : null, gross: null },
  };
}

/** Befund zum Lesen des LV aus dem PDF: Anzahl der Positionen und – bei Preisen – Gegenprobe mit der Endsumme im PDF. */
export function lvPdfBefund(name: string, doc: GaebDoc): Befund {
  const preise = doc.phase === 82;
  const summe = r2(doc.positions.filter((p) => !p.bedarf).reduce((a, p) => a + (p.gp ?? 0), 0));
  const eur = (v: number) => `${v.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €`;
  const passt = doc.total.net == null || Math.abs(summe - doc.total.net) <= 0.05;
  const pruef = !preise ? 'Bitte Mengen stichprobenartig mit dem PDF vergleichen.'
    : doc.total.net == null ? 'Keine Endsumme im PDF gefunden – bitte stichprobenartig prüfen.'
    : passt ? `Die Summe stimmt mit der Endsumme im PDF (${eur(doc.total.net)}) überein.`
    : `ACHTUNG: Die Summe weicht von der Endsumme im PDF (${eur(doc.total.net)}) ab – bitte prüfen.`;
  return { kind: preise && !passt ? 'bad' : 'info', quelle: 'pdf', text: `${name}: LV aus dem PDF gelesen – ${doc.positions.length} Positionen${preise ? `, Preise ${eur(summe)} netto` : ', ohne Preise'}. ${pruef}` };
}
