export type Mode = 'lv' | 'summe';
export type Kriterien = 'preis' | 'mehrere';

export interface Project {
  titel: string;
  nummer: string;
  auftraggeber: string;
  gewerk: string;
  verfahren: string;
  vergabeart: string;
  submission: string;
  sachbearbeiter: string;
  kostenschaetzung: number | null; // netto
  mwst: number;
  schwelle: number; // % für Aufklärung bei auffallend niedrigem Preis
  mode: Mode;
  kriterienModus: Kriterien;
}

export interface Bidder {
  id: string;
  name: string;
  checks: Record<string, boolean>;
  excluded: boolean;
  exclusionReason: string;
  nachlass: number | null; // % ohne Bedingung
  skonto: number | null; // % nur Info, wird nicht gewertet
  summeBieter: number | null; // Angebotssumme laut Bieter (netto)
  summe: number | null; // nur Modus "summe"
  aufklaerung: '' | 'angemessen' | 'unangemessen';
  aufklaerungNotiz: string;
}

export interface Position {
  id: string;
  nr: string;
  text: string;
  menge: number | null;
  einheit: string;
  bedarf: boolean; // Bedarfs-/Alternativposition, nicht in Summe
}

export interface Criterion {
  id: string;
  name: string;
  weight: number; // %
}

export interface State {
  project: Project;
  bidders: Bidder[];
  positions: Position[];
  prices: Record<string, Record<string, number | null>>; // [posId][bidderId]
  criteria: Criterion[];
  scores: Record<string, Record<string, number | null>>; // [criterionId][bidderId] 0-10
  empfehlungBieter: string; // '' = automatisch
  begruendung: string; // '' = automatisch
  begruendungManuell: boolean;
  freigabe: { pruefer: string; freigeber: string; datum: string };
}

export const FORMAL_CHECKS: { id: string; label: string; hint: string }[] = [
  { id: 'frist', label: 'Fristgerecht eingegangen', hint: 'Eingang vor Ablauf der Angebotsfrist' },
  { id: 'unterschrift', label: 'Angebot unterschrieben', hint: 'Rechtsverbindliche Unterschrift bzw. Signatur' },
  { id: 'preise', label: 'Preise vollständig angegeben', hint: 'Alle geforderten Positionen bepreist' },
  { id: 'erklaerungen', label: 'Erklärungen & Nachweise vorhanden', hint: 'Eignungsnachweise, Eigenerklärungen, Formblätter' },
  { id: 'unveraendert', label: 'Vergabeunterlagen unverändert', hint: 'Keine Änderungen oder Ergänzungen des Bieters' },
  { id: 'nu', label: 'Nachunternehmer-Angaben vollständig', hint: 'Falls gefordert' },
];

export const VERFAHREN = ['VOB/A (national)', 'VOB/A-EU', 'UVgO', 'VgV', 'Privat / intern'];
export const VERGABEARTEN = [
  'Öffentliche Ausschreibung',
  'Beschränkte Ausschreibung',
  'Freihändige Vergabe / Verhandlungsvergabe',
  'Offenes Verfahren',
  'Nicht offenes Verfahren',
  'Interne Vergabe',
];
