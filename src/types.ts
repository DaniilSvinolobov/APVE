export interface Los {
  id: string;
  oz: string; // erste OZ-Ebene im LV, z. B. "01"
  nr: string; // "LOS1"
  name: string; // "Wege- und Landschaftsbauarbeiten"
  kosten: number | null; // Kostenvoranschlag
  imVermerk: boolean; // false = separat geprüft, nicht im Vermerk
  imBudget: boolean; // in Gesamtbudget-Vergleich einbezogen
}

export interface LvPos {
  oz: string;
  kurz: string;
  menge: number | null;
  mengeOrig: number | null;
  einheit: string;
  bedarf: boolean;
}

export interface PriceEntry {
  ep: number | null;
  gp: number | null; // Gesamtpreis laut Bieterdatei
}

export type PStatus = 'ok' | 'nach' | 'fehlt' | 'leer' | 'teil' | 'unsign' | 'entf';

export interface Offer {
  id: string;
  nr: number; // Angebot Nr.
  firma: string;
  ort: string;
  runde: 1 | 2 | 3; // 1 = Hauptangebot, 2+ = Nachverhandlung
  datum: string;
  lose: string[];
  nachlass: number | null;
  nachlassLose: string[]; // leer = alle Lose
  skonto: number | null;
  prices: Record<string, PriceEntry>; // [OZ ohne Punkte]
  summen: Record<string, number | null>; // [losId] netto, wenn ohne LV erfasst
  pruef: Record<string, { s: PStatus; d: string; n?: string; k?: 'auto' | 'ki' | 'user' }>; // Vollständigkeitsprüfung [Zeilen-ID]; n = Hinweis, k = Quelle
  kiDocs?: { datei: string; art: string; inhalt: string; unterschrift: string; bemerkung: string }[]; // Ergebnis der Dokumentprüfung (KI)
  textErg: { oz: string; text: string }[];
  nachforderung: string[];
  dateien: { name: string; kat: string }[];
  warnungen: string[];
  quelle: string;
}

export interface Bew {
  ausschluss: string;
  aufklaerung: '' | 'angemessen' | 'unangemessen';
  aufklaerungNotiz: string;
  qualifikation: string;
  km: number | null;
  auskoemm: boolean;
  erlaeuterung: string;
  zusatz: string;
}

export interface Anlage {
  id: string;
  key: string; // eroeffnung | mitteilung1 | preisspiegel1 | mitteilung2 | preisspiegel2 | frei
  titel: string;
}

export interface Project {
  titel: string;
  nummer: string;
  auftraggeber: string;
  vergabestelle: string;
  ersteller: string; // Planungsbüro / Verfasser
  ort: string;
  verfahren: string;
  kostenBasis: 'brutto' | 'netto';
  kostenDatum: string;
  mwst: number;
  schwelle: number; // % für auffallend niedrig
  abweichung: number; // % für Einzelpreis-Auffälligkeit
  engereWahl: number;
  eroeffnung: string;
  zuschlagsfrist: string;
  beginn: string;
  ende: string;
  angefordert: number | null;
  budgetBrutto: number | null;
  unterzeichner: string;
  datum: string; // Datum des Vermerks
  vollstaendigkeit: boolean; // Vollständigkeitsprüfung als Anlage drucken
}

export interface State {
  v: 2;
  project: Project;
  lose: Los[];
  titles: Record<string, string>;
  unterlagen: { id: string; label: string }[]; // Prüfzeilen der Vollständigkeitsprüfung
  lv: LvPos[];
  offers: Offer[];
  bew: Record<string, Bew>;
  texte: Record<string, string>;
  zuschlag: Record<string, string>; // [losId] -> offerId ('' = automatisch)
  anlagen: Anlage[];
  logo: string; // data-URL
}

export const PSTATUS: { v: PStatus; label: string; cell: string }[] = [
  { v: 'ok', label: 'vorhanden', cell: 'x' },
  { v: 'nach', label: 'nachgereicht', cell: 'Nachgereicht' },
  { v: 'fehlt', label: 'nicht beigefügt', cell: 'Nicht beigefügt' },
  { v: 'leer', label: 'nicht ausgefüllt', cell: 'Nicht ausgefüllt' },
  { v: 'teil', label: 'teilweise ausgefüllt', cell: 'Teilweise ausgefüllt' },
  { v: 'unsign', label: 'nicht unterschrieben', cell: 'Nicht unterschrieben' },
  { v: 'entf', label: 'entfällt', cell: 'durchgestrichen' },
];

/** Standard-Prüfzeilen (Vorlage: „Prüfung auf Vollständigkeit der abgegebenen Angebotsunterlagen“) */
export const DEFAULT_UNTERLAGEN = [
  'Fristgerecht eingegangen',
  'Angebot unterschrieben / signiert',
  'Preise vollständig (GAEB-Angebotsdatei)',
  'VVB 124 - Eigenerklärung zur Eignung',
  'VVB 213 - Angebotsschreiben',
  'VVB 221 - Preisermittlung bei Zuschlagskalkulation',
  'VVB 222 - Preisermittlung bei Kalkulation über die Endsumme',
  'VVB 223 - Aufgliederung der Einheitspreise',
  'VVB 233 - Verzeichnis der Nachunternehmerleistungen',
  'VVB 234 - Erklärung Bieter-/Arbeitsgemeinschaft',
  'VVB 235 - Verzeichnis der Leistungen/Kapazitäten anderer Unternehmen',
  'VVB 248 - Erklärung zur Verwendung von Holzprodukten',
];

export const VERFAHREN = ['Nichtförmliches Verfahren', 'VOB/A (national)', 'VOB/A-EU', 'UVgO', 'VgV', 'Freihändige Vergabe', 'Privat / intern'];
