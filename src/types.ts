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
  checks: Record<string, boolean>;
  evidence: Record<string, string>;
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
}

export interface State {
  v: 2;
  project: Project;
  lose: Los[];
  titles: Record<string, string>;
  lv: LvPos[];
  offers: Offer[];
  bew: Record<string, Bew>;
  texte: Record<string, string>;
  zuschlag: Record<string, string>; // [losId] -> offerId ('' = automatisch)
  anlagen: Anlage[];
  logo: string; // data-URL
}

export const FORMAL_CHECKS = [
  { id: 'frist', label: 'Fristgerecht eingegangen' },
  { id: 'unterschrift', label: 'Unterschrieben / signiert' },
  { id: 'preise', label: 'Preise vollständig' },
  { id: 'erklaerungen', label: 'Erklärungen & Nachweise' },
  { id: 'unveraendert', label: 'Unterlagen unverändert' },
  { id: 'nu', label: 'Nachunternehmer-Angaben' },
] as const;

export const VERFAHREN = ['Nichtförmliches Verfahren', 'VOB/A (national)', 'VOB/A-EU', 'UVgO', 'VgV', 'Freihändige Vergabe', 'Privat / intern'];
