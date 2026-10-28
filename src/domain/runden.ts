import type { Offer, State } from './types';

/**
 * Angebotsrunden eines Bieters. Eine Nachverhandlung ist ein eigenes Angebot (eigene Preise, eigener Nachlass, eigene
 * Unterlagen), das über `basis` auf das Hauptangebot desselben Bieters verweist. Die Unterlagen des Hauptangebots
 * bleiben dabei unverändert; Eignung, Nachunternehmer und Vollständigkeitsprüfung gehören zum Hauptangebot.
 */

/** Firmenname ohne Rechtsform und Satzzeichen, für den Vergleich („Outdoor Design GmbH“ = „outdoor/design“). */
export const firmaKey = (f: string) => f.toLowerCase().replace(/\b(gmbh|mbh|co|kg|ag|ug|ohg|gbr|e\.?\s?k)\b|&/g, '').replace(/[^a-z0-9äöüß]/g, '');

/** Gleicher Bieter nach Firmenname (mind. 4 Zeichen, einer enthält den anderen). */
export function gleicherBieter(a: string, b: string): boolean {
  const x = firmaKey(a), y = firmaKey(b);
  return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x));
}

/** Hauptangebot = kein Verweis auf ein anderes Angebot. Nur Hauptangebote stehen in der Vollständigkeitsprüfung. */
export const istHaupt = (o: Offer) => !o.basis;

/** Hauptangebot eines Angebots (bei einer Nachverhandlung das verknüpfte, sonst das Angebot selbst). */
export const hauptVon = (s: State, o: Offer): Offer => (o.basis ? s.offers.find((x) => x.id === o.basis) ?? o : o);

/** Nachverhandlungen zu einem Hauptangebot, nach Runde. */
export const nachverhandlungen = (s: State, haupt: Offer): Offer[] => s.offers.filter((o) => o.basis === haupt.id).sort((a, b) => a.runde - b.runde);

/** Alle Angebote eines Bieters (Hauptangebot und Nachverhandlungen), nach Runde. */
export const kette = (s: State, o: Offer): Offer[] => { const h = hauptVon(s, o); return [h, ...nachverhandlungen(s, h)]; };

/** Gehören zwei Angebote zum selben Bieter (gleiche Kette)? */
export const selberBieter = (s: State, a: Offer, b: Offer) => hauptVon(s, a).id === hauptVon(s, b).id;

/** Letztes Angebot desselben Bieters vor diesem (für den Preisvergleich in der Nachverhandlung). */
export const vorRunde = (s: State, o: Offer): Offer | undefined => kette(s, o).filter((x) => x.runde < o.runde).pop();

/** Nächste freie Runde in der Kette eines Hauptangebots (höchstens 3). */
export const naechsteRunde = (s: State, haupt: Offer): 2 | 3 => Math.min(3, Math.max(...kette(s, haupt).map((x) => x.runde)) + 1) as 2 | 3;

/**
 * Nachverhandlung ist nur in bestimmten Verfahren zulässig: In Öffentlicher und Beschränkter Ausschreibung (VOB/A, UVgO)
 * sowie im Offenen und Nicht offenen Verfahren gilt das Verhandlungsverbot (z. B. § 15 Abs. 3 VOB/A, § 15 EU Abs. 3 VOB/A).
 * Gibt einen Hinweis zurück oder '' (Freihändige Vergabe, Verhandlungsverfahren/-vergabe, Direktauftrag, private Vergabe, unbekannt).
 */
export function nvHinweis(verfahren: string): string {
  if (!/Öffentliche Ausschreibung|Beschränkte Ausschreibung|Offenes Verfahren|Nicht offenes Verfahren/.test(verfahren)) return '';
  const vob = /VOB\/A-EU/.test(verfahren) ? '§ 15 EU Abs. 3 VOB/A' : /VOB\/A/.test(verfahren) ? '§ 15 Abs. 3 VOB/A' : /VgV/.test(verfahren) ? '§ 15 Abs. 5 VgV' : 'Verhandlungsverbot nach UVgO';
  return `Im Verfahren „${verfahren}“ sind Verhandlungen über Änderungen der Angebote oder Preise grundsätzlich unzulässig (${vob}); zulässig ist nur die Aufklärung des Angebotsinhalts. Bitte Verfahrensart prüfen.`;
}

/** Ältere Projekte: Nachverhandlungen ohne Verweis dem Hauptangebot desselben Bieters zuordnen. */
export function verknuepfeAlte(s: State) {
  for (const o of s.offers) {
    if (o.runde === 1 || o.basis) continue;
    const h = s.offers.find((x) => x !== o && x.runde === 1 && !x.basis && gleicherBieter(x.firma, o.firma));
    if (h) o.basis = h.id;
  }
}

/** Angebot von Hand als Nachverhandlung einem Hauptangebot zuordnen (`hauptId`) oder wieder als Hauptangebot führen (null). */
export function setzeBasis(s: State, offerId: string, hauptId: string | null) {
  const o = s.offers.find((x) => x.id === offerId);
  if (!o) return;
  const h = hauptId ? s.offers.find((x) => x.id === hauptId && !x.basis && x.id !== offerId) : undefined;
  if (!h || nachverhandlungen(s, o).length) { delete o.basis; o.runde = 1; return; }
  delete o.basis;
  o.runde = naechsteRunde(s, h);
  o.basis = h.id;
  o.nebenangebot = false;
}

/** Umschalter „Nachverhandlung“: dem Hauptangebot desselben Bieters zuordnen; ohne eindeutigen Bieter bleibt die Zuordnung offen (Auswahl in der Karte). */
export function alsNachverhandlung(s: State, offerId: string) {
  const o = s.offers.find((x) => x.id === offerId);
  if (!o || nachverhandlungen(s, o).length) return;
  const kandidaten = s.offers.filter((x) => x !== o && !x.basis && gleicherBieter(x.firma, o.firma));
  if (kandidaten.length === 1) setzeBasis(s, o.id, kandidaten[0].id);
  else { delete o.basis; o.runde = 2; o.nebenangebot = false; }
}
