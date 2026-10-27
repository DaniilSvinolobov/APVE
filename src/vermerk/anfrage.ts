import type { Anfrage, AnfrageModus, Los, State } from '../domain/types';
import { positionsVergleich, type AufklPos, type Cell } from '../domain/calc';
import { fmtNum } from '../domain/fmt';

/** E-Mail an den Auftraggeber während der Angebotsprüfung: Ausschluss einzelner Bieter vorab empfehlen und für auffällige Positionen
 *  eine detaillierte Angebotskalkulation nachfordern lassen. Nur Text – ändert weder Wertung noch Vergabevermerk. */

export const leereAnfrage = (): Anfrage => ({ anrede: '', modus: {}, grund: {}, pos: {} });
export const anfrageOf = (s: State, los: Los): Anfrage => ({ ...leereAnfrage(), ...(s.anfrage?.[los.id] ?? {}) });

export const bieterNr = (nr: number) => `Bieter Nr. ${String(nr).padStart(3, '0')}`;

/** Angebote einer Runde, die für die Anfrage in Frage kommen: vollständig bepreist, nicht zurückgezogen/formal ausgeschlossen. */
export const anfrageCells = (cells: Cell[], runde: number) => cells.filter((c) => c.offer.runde === runde && c.complete && !c.offer.status);

const ozSort = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });

export interface AnfrageBieter {
  c: Cell;
  modus: AnfrageModus;
  vergleich: AufklPos[]; // alle bepreisten Positionen mit Vergleichswerten (ohne die zum Ausschluss empfohlenen Bieter)
  auto: string[]; // automatisch vorgeschlagene Positionen
  liste: string[]; // Positionen in der E-Mail
  manuell: boolean;
}

/** Stand je Bieter: Modus (von Hand oder automatisch) und Positionen. Zum Ausschluss empfohlene Bieter zählen nicht zum Mittel der übrigen. */
export function anfrageBieter(s: State, los: Los, cells: Cell[], runde: number): AnfrageBieter[] {
  const a = anfrageOf(s, los);
  const rc = anfrageCells(cells, runde);
  const aus = rc.filter((c) => a.modus[c.offer.id] === 'aus').map((c) => c.offer.id);
  return rc.map((c) => {
    const vergleich = positionsVergleich(s, los, cells, c, aus);
    const auto = vergleich.filter((p) => p.auffaellig).map((p) => p.oz);
    const hand = a.pos[c.offer.id];
    const liste = hand == null ? auto : [...new Set(hand.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean))].sort(ozSort);
    return { c, modus: a.modus[c.offer.id] ?? (auto.length ? 'nach' : 'ohne'), vergleich, auto, liste, manuell: hand != null };
  });
}

/** Vorschlag für die Begründung der Ausschlussempfehlung aus Abstand zum Schätzpreis und Ausreißern nach oben. */
export function ausschlussAuto(b: AnfrageBieter): string {
  const { c } = b;
  const teile: string[] = [];
  if (c.dKosten != null && c.dKosten > 0) teile.push(`das Angebot rund ${fmtNum(c.dKosten, 0)} % über unserem Schätzpreis liegt`);
  else if (c.dMin != null && c.dMin > 0) teile.push(`das Angebot rund ${fmtNum(c.dMin, 0)} % über dem günstigsten Angebot liegt`);
  const hoch = b.vergleich.filter((p) => p.auffaellig && p.ep > (p.avg ?? p.schaetz ?? 0)).length;
  if (hoch >= 3) teile.push('im Vergleich zu den anderen Bietern teilweise extreme Ausreißer nach oben aufweist');
  return teile.join(' und ');
}

export function anfrageText(s: State, los: Los, cells: Cell[], runde: number): string {
  const a = anfrageOf(s, los);
  const bieter = anfrageBieter(s, los, cells, runde);
  const aus = bieter.filter((b) => b.modus === 'aus');
  const nach = bieter.filter((b) => b.modus === 'nach' && b.liste.length);
  const losText = s.lose.length > 1 ? ` für ${los.nr}${los.name ? ` (${los.name})` : ''}` : '';
  const schaetz = Object.keys(s.schaetz ?? {}).length > 0;

  const out = [a.anrede.trim() || 'Sehr geehrte Damen und Herren,', '', `wir befinden uns noch in der Angebotsprüfung${losText}.`];
  for (const b of aus) {
    const grund = (a.grund[b.c.offer.id] ?? '').trim() || ausschlussAuto(b) || '[Grund angeben]';
    out.push('', `Wir empfehlen vorab, den ${bieterNr(b.c.offer.nr)} ${b.c.offer.firma} von der weiteren Angebotsprüfung auszuschließen, da ${grund.replace(/\.$/, '')}.`);
  }
  if (nach.length) {
    out.push('', `Wir bitten, für ${nach.length > 1 ? 'folgende Bieter' : 'folgenden Bieter'} für die jeweils aufgeführten Positionen eine detaillierte Angebotskalkulation nachzufordern, da diese von den übrigen Angebotspreisen${schaetz ? ' und unserem LV-Schätzpreis' : ''} deutlich abweichen.`);
    for (const b of nach) out.push('', `${bieterNr(b.c.offer.nr)} ${b.c.offer.firma}:`, `Pos. ${b.liste.join(', ')}`);
  }
  out.push('', 'Für weitere Rückfragen stehe ich gerne zur Verfügung.', '', 'Mit freundlichen Grüßen');
  if (s.project.unterzeichner.trim()) out.push(s.project.unterzeichner.trim());
  return out.join('\n');
}
