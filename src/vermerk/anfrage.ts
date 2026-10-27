import type { Anfrage, Los, State } from '../domain/types';
import { aufklaerungsPositionen, type Cell } from '../domain/calc';
import { fmtNum } from '../domain/fmt';

/** E-Mail an den Auftraggeber während der Angebotsprüfung: Ausschluss vorab empfehlen und für auffällige Positionen
 *  eine detaillierte Angebotskalkulation nachfordern lassen. Der Text wird kopiert bzw. ins E-Mail-Programm übergeben. */

export const leereAnfrage = (): Anfrage => ({ anrede: '', ausschluss: {}, pos: {} });
export const anfrageOf = (s: State, los: Los): Anfrage => ({ ...leereAnfrage(), ...(s.anfrage?.[los.id] ?? {}) });

export const bieterNr = (nr: number) => `Bieter Nr. ${String(nr).padStart(3, '0')}`;

/** Angebote einer Runde, die für die Anfrage in Frage kommen: vollständig bepreist, nicht zurückgezogen/formal ausgeschlossen. */
export const anfrageCells = (cells: Cell[], runde: number) => cells.filter((c) => c.offer.runde === runde && c.complete && !c.offer.status);

/** Positionen je Angebot: von Hand eingetragen, sonst automatisch (gegenüber den übrigen Angeboten ohne die zum Ausschluss empfohlenen). */
export function anfragePositionen(s: State, los: Los, cells: Cell[], c: Cell, a: Anfrage): { auto: string[]; liste: string[]; manuell: boolean } {
  const auto = aufklaerungsPositionen(s, los, cells, c, Object.keys(a.ausschluss)).map((p) => p.oz);
  const hand = a.pos[c.offer.id];
  if (hand == null) return { auto, liste: auto, manuell: false };
  return { auto, liste: hand.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean), manuell: true };
}

/** Vorschlag für die Begründung der Ausschlussempfehlung aus Abstand zum Schätzpreis und Ausreißern nach oben. */
export function ausschlussAuto(s: State, los: Los, cells: Cell[], c: Cell): string {
  const teile: string[] = [];
  if (c.dKosten != null && c.dKosten > 0) teile.push(`das Angebot rund ${fmtNum(c.dKosten, 0)} % über unserem Schätzpreis liegt`);
  else if (c.dMin != null && c.dMin > 0) teile.push(`das Angebot rund ${fmtNum(c.dMin, 0)} % über dem günstigsten Angebot liegt`);
  const hoch = aufklaerungsPositionen(s, los, cells, c).filter((p) => p.ep > (p.avg ?? p.schaetz ?? 0)).length;
  if (hoch >= 3) teile.push('im Vergleich zu den anderen Bietern teilweise extreme Ausreißer nach oben aufweist');
  return teile.join(' und ') || '[Grund angeben]';
}

export function anfrageText(s: State, los: Los, cells: Cell[], runde: number): string {
  const a = anfrageOf(s, los);
  const p = s.project;
  const rc = anfrageCells(cells, runde);
  const aus = rc.filter((c) => c.offer.id in a.ausschluss);
  const nach = rc
    .filter((c) => !(c.offer.id in a.ausschluss))
    .map((c) => ({ c, pos: anfragePositionen(s, los, cells, c, a).liste }))
    .filter((x) => x.pos.length);
  const losText = s.lose.length > 1 ? ` für ${los.nr}${los.name ? ` (${los.name})` : ''}` : '';
  const schaetz = Object.keys(s.schaetz ?? {}).length > 0;

  const out = [a.anrede.trim() || 'Sehr geehrte Damen und Herren,', '', `wir befinden uns noch in der Angebotsprüfung${losText}.`];
  for (const c of aus) {
    const grund = a.ausschluss[c.offer.id].trim() || ausschlussAuto(s, los, cells, c);
    out.push('', `Wir empfehlen vorab, den ${bieterNr(c.offer.nr)} ${c.offer.firma} von der weiteren Angebotsprüfung auszuschließen, da ${grund.replace(/\.$/, '')}.`);
  }
  if (nach.length) {
    out.push('', `Wir bitten, für ${nach.length > 1 ? 'folgende Bieter' : 'folgenden Bieter'} für die jeweils aufgeführten Positionen eine detaillierte Angebotskalkulation nachzufordern, da diese von den übrigen Angebotspreisen${schaetz ? ' und unserem LV-Schätzpreis' : ''} deutlich abweichen.`);
    for (const x of nach) out.push('', `${bieterNr(x.c.offer.nr)} ${x.c.offer.firma}:`, `Pos. ${x.pos.join(', ')}`);
  }
  if (!aus.length && !nach.length) out.push('', 'Die Einzelpreise der Angebote geben derzeit keinen Anlass, eine Angebotskalkulation nachzufordern.');
  out.push('', 'Für weitere Rückfragen stehe ich gerne zur Verfügung.', '', 'Mit freundlichen Grüßen');
  if (p.unterzeichner.trim()) out.push(p.unterzeichner.trim());
  return out.join('\n');
}
