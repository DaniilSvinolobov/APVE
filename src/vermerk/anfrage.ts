import type { Anfrage, AnfrageModus, Los, State } from '../domain/types';
import { aufklMinEuro, losPositions, positionsVergleich, zkey, type AufklPos, type Cell } from '../domain/calc';
import { fmtNum, round2 } from '../domain/fmt';

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
  vergleich: AufklPos[]; // alle bepreisten Positionen mit Vergleich, nach Auswirkung absteigend (ohne die zum Ausschluss empfohlenen Bieter)
  auto: string[]; // automatisch vorgeschlagene Positionen (auffällig)
  liste: string[]; // Positionen in der E-Mail
  manuell: boolean;
}

/** Mindestauswirkung je Position: von Hand gesetzt, sonst automatisch aus den Angebotssummen der Runde. */
export const anfrageMinEuro = (a: Anfrage, cells: Cell[], runde: number) => a.minEuro ?? aufklMinEuro(cells, runde);

/** Stand je Bieter: Modus (von Hand oder automatisch) und Positionen. Zum Ausschluss empfohlene Bieter zählen nicht zum Vergleich der übrigen. */
export function anfrageBieter(s: State, los: Los, cells: Cell[], runde: number): AnfrageBieter[] {
  const a = anfrageOf(s, los);
  const rc = anfrageCells(cells, runde);
  const min = anfrageMinEuro(a, cells, runde);
  const aus = rc.filter((c) => a.modus[c.offer.id] === 'aus').map((c) => c.offer.id);
  return rc.map((c) => {
    const vergleich = positionsVergleich(s, los, cells, c, min, aus);
    const auto = vergleich.filter((p) => p.status === 'auffaellig').map((p) => p.oz).sort(ozSort);
    const hand = a.pos[c.offer.id];
    const liste = hand == null ? auto : [...new Set(hand.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean))].sort(ozSort);
    return { c, modus: a.modus[c.offer.id] ?? (auto.length ? 'nach' : 'ohne'), vergleich, auto, liste, manuell: hand != null };
  });
}

/** Positionen, bei denen die Bieter untereinander ähnlich liegen, unser LV-Schätzpreis aber deutlich abweicht (Median aller Bieter der Runde). */
export function schaetzAbweichungen(s: State, los: Los, cells: Cell[], runde: number, minEuro: number) {
  const rc = anfrageCells(cells, runde).filter((c) => !c.excluded);
  if (rc.length < 2) return [];
  const th = s.project.abweichung / 100;
  const out: { oz: string; kurz: string; schaetz: number; median: number; pct: number; delta: number }[] = [];
  for (const p of losPositions(s, los)) {
    const sch = s.schaetz?.[zkey(p.oz)];
    if (p.bedarf || sch == null || sch <= 0) continue;
    const eps = rc.map((c) => c.offer.prices[zkey(p.oz)]?.ep).filter((v): v is number => v != null).sort((x, y) => x - y);
    if (eps.length < 2) continue;
    const m = eps.length % 2 ? eps[eps.length >> 1] : (eps[eps.length / 2 - 1] + eps[eps.length / 2]) / 2;
    // alle Bieter weichen in dieselbe Richtung vom Schätzpreis ab
    if (!(eps[0] > sch * (1 + th) || eps[eps.length - 1] < sch * (1 - th))) continue;
    const delta = round2((p.menge ?? 0) * (m - sch));
    if (Math.abs(delta) >= minEuro) out.push({ oz: p.oz, kurz: p.kurz, schaetz: sch, median: m, pct: (m / sch - 1) * 100, delta });
  }
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

/** Vorschlag für die Begründung der Ausschlussempfehlung aus Abstand zum Schätzpreis und Ausreißern nach oben. */
export function ausschlussAuto(b: AnfrageBieter): string {
  const { c } = b;
  const teile: string[] = [];
  if (c.dKosten != null && c.dKosten > 0) teile.push(`das Angebot rund ${fmtNum(c.dKosten, 0)} % über unserem Schätzpreis liegt`);
  else if (c.dMin != null && c.dMin > 0) teile.push(`das Angebot rund ${fmtNum(c.dMin, 0)} % über dem günstigsten Angebot liegt`);
  const hoch = b.vergleich.filter((p) => p.status === 'auffaellig' && p.delta > 0).length;
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
