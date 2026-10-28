/** Ergebnis der LV-Prüfung (siehe gaeb/lvCheck.ts) */
export interface LvBefund { kind: 'bad' | 'warn' | 'info'; text: string; quelle: 'gaeb' | 'pdf'; datei?: string }

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
  lang?: string; // Langtext (gekürzt), nur für den Textabgleich mit Bieterdateien
  menge: number | null;
  mengeOrig: number | null;
  einheit: string;
  bedarf: boolean;
}

/** Position aus der Bieterdatei, wie eingelesen – erlaubt erneutes Zuordnen, wenn das Soll-LV später geladen oder ersetzt wird. */
export interface BidPos { oz: string; kurz: string; lang: string; menge: number | null; einheit: string; bedarf: boolean; ep: number | null; gp: number | null }

/** Position der Bieterdatei, die im Soll-LV nicht vorkommt: gehört zum Angebot des Bieters und wird mitgewertet, aber als „neu“ gekennzeichnet. */
export interface ZusatzPos { oz: string; kurz: string; einheit: string; menge: number | null; ep: number | null; gp: number | null; bedarf: boolean }

/** Endsumme laut Bieterdatei und Gegenprobe im PDF des Bieters. */
export interface SummenCheck {
  gaeb: number | null; // Nettosumme laut GAEB-Datei (Kopfsumme, sonst Summe der Titelsummen)
  positionen: number; // Summe aller Gesamtpreise der Positionen in der GAEB-Datei
  pdf?: { datei: string; betrag: number | null; gefunden: boolean; lesbar: boolean }; // betrag = im PDF als Endsumme benannt; gefunden = GAEB-Summe kommt im PDF vor
}

export interface PriceEntry {
  ep: number | null;
  gp: number | null; // Gesamtpreis laut Bieterdatei
}

export type PStatus = 'ok' | 'nach' | 'fehlt' | 'leer' | 'teil' | 'unsign' | 'entf' | 'pdf';

/** Eine Referenz aus den Referenzunterlagen des Bieters, ausgewertet mit KI (api/eignung). */
export interface KiReferenz { projekt: string; auftraggeber: string; ort: string; zeitraum: string; auftragssumme: string; leistungen: string; vergleichbar: 'ja' | 'teilweise' | 'nein' | 'unklar'; begruendung: string }

/** Ergebnisse der optionalen KI-Eignungsprüfung je Angebot (stand = ISO-Zeitpunkt). */
export interface Eignung {
  referenzen?: { liste: KiReferenz[]; hinweise: string[]; fazit: string; dateien: string[]; stand: string };
  recherche?: { text: string; profil?: RechercheProfil; quellen: { url: string; titel: string }[]; stand: string };
}

/** Ergebnis der Internetrecherche in Abschnitten (text = Sätze für den Vermerk). */
export interface RechercheProfil {
  vermerk: string; fakten: { k: string; v: string }[]; leistungen: string[]; referenzen: string[]; vergleichbarkeit: string; offen: string[];
}

/** Nachunternehmer (VVB 233) bzw. Unternehmen, auf deren Kapazitäten sich der Bieter beruft (VVB 235). */
/** art: Herkunft laut KI (nu = VVB 233, kapazitaet = VVB 235); in Liste und Vermerk nicht mehr unterschieden. */
export interface Nachunternehmer { oz: string; leistung: string; firma: string; art?: 'nu' | 'kapazitaet' | 'beide'; pq?: string } // pq = Präqualifikation dieses Unternehmens

/** Handschriftliche Eintragung in einem Dokument (Befund der KI-Prüfung). */
export interface HsEintrag { seite?: number; feld: string; wert: string }

export interface Offer {
  id: string;
  nr: number; // Angebot Nr.
  firma: string;
  ort: string;
  runde: 1 | 2 | 3; // 1 = Hauptangebot, 2+ = Nachverhandlung
  basis?: string; // Nachverhandlung: ID des Hauptangebots desselben Bieters (siehe domain/runden.ts); fehlt = Hauptangebot
  status?: '' | 'zurueck' | 'formal'; // zurueck = Angebot zurückgezogen; formal = bei der formalen Prüfung ausgeschlossen (Grund in statusGrund)
  statusGrund?: string;
  nebenangebot?: boolean; // dem Hauptangebot ist ein Nebenangebot beigefügt
  datum: string;
  lose: string[];
  nachlass: number | null;
  nachlassLose: string[]; // leer = alle Lose
  skonto: number | null;
  prices: Record<string, PriceEntry>; // [OZ ohne Punkte]
  summen: Record<string, number | null>; // [losId] netto, wenn ohne LV erfasst
  pruef: Record<string, { s: PStatus; d: string; n?: string; k?: 'auto' | 'ki' | 'user' }>; // Vollständigkeitsprüfung [Zeilen-ID]; n = Hinweis, k = Quelle
  kiDocs?: { datei: string; titel?: string; art: string; zeilen?: string[]; vorlage?: boolean; inhalt: string; unterschrift: string; stempel?: boolean; handschrift?: string | HsEintrag[]; nachunternehmer?: Nachunternehmer[]; pq?: string; sicherheit?: string; bemerkung: string }[]; // Ergebnis der Dokumentprüfung (KI); handschrift als Text = ältere Prüfung
  kiInfo?: { s: 'ok' | 'skip' | 'fehler'; t: string }; // Stand der letzten KI-Prüfung dieses Angebots (geprüft / übersprungen / Fehler)
  eignung?: Eignung; // Referenzauswertung und Recherche (KI, optional)
  nu?: Nachunternehmer[]; // Nachunternehmer laut VVB 233/235; fehlt = noch nicht erfasst, [] = keine
  nuQuelle?: 'ki' | 'user'; // user = von Hand bearbeitet, wird von einer neuen KI-Prüfung nicht überschrieben
  pq?: string; // Präqualifikationsnummer (leer = nicht präqualifiziert bzw. unbekannt)
  pqQuelle?: string; // Datei, aus der die KI die PQ-Nummer gelesen hat (leer = von Hand eingetragen)
  textErg: { oz: string; text: string }[];
  nachforderung: string[];
  dateien: { name: string; kat: string; nach?: string }[]; // nach = nachgereicht am (ISO-Datum, '' = unbekannt)
  warnungen: string[];
  bidPos?: BidPos[];
  zusatz?: ZusatzPos[]; // Positionen, die im Soll-LV nicht vorkommen (neu), in der Summe enthalten
  check?: SummenCheck;
  ozZuordnung?: { bieter: string; lv: string; score: number }[]; // Positionen, die über den Text statt über die OZ dem Soll-LV zugeordnet wurden
  quelle: string;
  preisQuelle?: 'gaeb' | 'pdf' | 'keine'; // pdf = GAEB-Datei des Bieters ohne Preise, Preise aus dem bepreisten LV-PDF gelesen; keine = keine lesbaren Preise im Ordner
  lvPdf?: { name: string; befunde: LvBefund[] }[]; // Abgleich des beigelegten LV-PDF mit der GAEB-Preisdatei
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
  nichtGewertet: string; // Begründung, warum das Angebot nicht in die engere Wahl kommt (leer = automatischer Text)
}

/** E-Mail an den Auftraggeber während der Prüfung (nur Text, ändert weder Wertung noch Vergabevermerk). */
export type AnfrageModus = 'ohne' | 'nach' | 'aus'; // nicht erwähnen | Angebotskalkulation nachfordern | Ausschluss empfehlen
export interface Anfrage {
  anrede: string; // leer = „Sehr geehrte Damen und Herren,“
  modus: Record<string, AnfrageModus>; // [offerId]; fehlt = „nach“ bei auffälligen Positionen und Bieter in der engeren Wahl, sonst „ohne“
  grund: Record<string, string>; // [offerId] Begründung der Ausschlussempfehlung (leer = automatischer Text)
  pos: Record<string, string>; // [offerId] Positionen von Hand (kommagetrennt); fehlt = automatisch
}

export interface Anlage {
  id: string;
  key: string; // eroeffnung | mitteilung1 | preisspiegel1 | mitteilung2 | preisspiegel2 | frei
  titel: string;
}

export interface Project {
  titel: string;
  nummer: string;
  massnahmeNr?: string; // Maßnahmennummer des Auftraggebers (Kopf der Formblätter)
  auftraggeber: string;
  vergabestelle: string;
  ersteller: string; // Planungsbüro / Verfasser
  ort: string;
  baustelle: string; // Lage der Baustelle („PLZ Ort“) – für die geschätzte Entfernung der Bieter
  verfahren: string;
  kostenBasis: 'brutto' | 'netto';
  kostenDatum: string;
  mwst: number;
  schwelle: number; // % Angebotssumme unter Kostenvoranschlag bzw. nächstem Angebot → Aufklärung prüfen
  abweichung: number; // % Abweichung eines EP vom Median der übrigen Bieter bzw. vom LV-Schätzpreis
  engereWahl: number;
  eroeffnung: string;
  zuschlagsfrist: string;
  beginn: string;
  ende: string;
  angefordert: number | null;
  budgetBrutto: number | null;
  unterzeichner: string;
  datum: string; // Datum des Vermerks
  vollstaendigkeit: boolean; // Vollständigkeitsprüfung im Anlagenverzeichnis aufführen (eigenes PDF)
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
  engere?: Record<string, string[]>; // [losId] -> offerIds der im Vermerk einzeln geprüften Angebote (erste Runde); fehlt = automatisch
  nvGrund?: Record<string, string>; // [losId] Anlass der Nachverhandlung (Text für den Vermerk)
  engereNotiz?: Record<string, string>; // [losId] Festlegung zur engeren Wahl, z. B. Abstimmung mit der Vergabestelle (Text für den Vermerk)
  anfrage?: Record<string, Anfrage>; // [losId] Anforderung der Angebotskalkulation (E-Mail an den Auftraggeber)
  anlagen: Anlage[];
  logo: string; // data-URL
  schaetz: Record<string, number>; // LV-Schätzpreis (EP netto) je Position [OZ ohne Punkte], aus GAEB 82
  lvInfo: { lv: string; schaetz: string; pdfs?: string[] }; // Quelldateien des eigenen LV (Anzeige)
  lvPruef?: LvBefund[]; // Plausibilitätsprüfung des eigenen LV (GAEB untereinander, PDF gegen GAEB)
}

export const PSTATUS: { v: PStatus; label: string; cell: string }[] = [
  { v: 'ok', label: 'vorhanden', cell: 'x' },
  { v: 'nach', label: 'nachgereicht', cell: 'Nachgereicht' },
  { v: 'fehlt', label: 'nicht beigefügt', cell: 'Nicht beigefügt' },
  { v: 'leer', label: 'nicht ausgefüllt', cell: 'Nicht ausgefüllt' },
  { v: 'teil', label: 'teilweise ausgefüllt', cell: 'Teilweise ausgefüllt' },
  { v: 'unsign', label: 'nicht unterschrieben', cell: 'Nicht unterschrieben' },
  { v: 'entf', label: 'entfällt', cell: 'durchgestrichen' },
  { v: 'pdf', label: 'Preise nur im PDF', cell: 'Nur als PDF (GAEB ohne Preise)' },
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

/**
 * Vergabeverfahren, gegliedert nach Rechtsgrundlage. Gespeichert wird „<Verfahrensart> nach <Regelwerk>“
 * (z. B. „Beschränkte Ausschreibung ohne Teilnahmewettbewerb nach VOB/A“), damit der Vermerk eindeutig ist.
 * Begriffe: § 3 VOB/A, § 3 EU VOB/A, § 8 UVgO, § 14 VgV, § 119 GWB. Ober-/unterschwellige Begriffe nicht mischen
 * („Offenes Verfahren“ gibt es nur EU-weit, „Verhandlungsvergabe“ nur nach UVgO, „Freihändige Vergabe“ nur noch nach VOB/A).
 */
export const VERFAHREN_GRUPPEN: { titel: string; regel: string; arten: string[] }[] = [
  {
    titel: 'Bauleistungen national (VOB/A Abschnitt 1)', regel: 'VOB/A',
    arten: ['Öffentliche Ausschreibung', 'Beschränkte Ausschreibung mit Teilnahmewettbewerb', 'Beschränkte Ausschreibung ohne Teilnahmewettbewerb', 'Freihändige Vergabe', 'Direktauftrag'],
  },
  {
    titel: 'Bauleistungen EU-weit (VOB/A Abschnitt 2)', regel: 'VOB/A-EU',
    arten: ['Offenes Verfahren', 'Nicht offenes Verfahren', 'Verhandlungsverfahren mit Teilnahmewettbewerb', 'Verhandlungsverfahren ohne Teilnahmewettbewerb', 'Wettbewerblicher Dialog', 'Innovationspartnerschaft'],
  },
  {
    titel: 'Liefer- und Dienstleistungen national (UVgO)', regel: 'UVgO',
    arten: ['Öffentliche Ausschreibung', 'Beschränkte Ausschreibung mit Teilnahmewettbewerb', 'Beschränkte Ausschreibung ohne Teilnahmewettbewerb', 'Verhandlungsvergabe mit Teilnahmewettbewerb', 'Verhandlungsvergabe ohne Teilnahmewettbewerb', 'Direktauftrag'],
  },
  {
    titel: 'Liefer- und Dienstleistungen EU-weit (VgV)', regel: 'VgV',
    arten: ['Offenes Verfahren', 'Nicht offenes Verfahren', 'Verhandlungsverfahren mit Teilnahmewettbewerb', 'Verhandlungsverfahren ohne Teilnahmewettbewerb', 'Wettbewerblicher Dialog', 'Innovationspartnerschaft'],
  },
];
export const verfahrenName = (art: string, regel: string) => `${art} nach ${regel}`;
/** Auftraggeber ohne Bindung an das Vergaberecht (z. B. private Bauherren): Preisanfrage ohne förmliches Verfahren. */
export const VERFAHREN_PRIVAT = 'Private Vergabe (ohne Vergaberecht)';
export const VERFAHREN = [...VERFAHREN_GRUPPEN.flatMap((g) => g.arten.map((a) => verfahrenName(a, g.regel))), VERFAHREN_PRIVAT];
