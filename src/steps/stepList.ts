import type { State } from '../domain/types';
import { computeLos } from '../domain/calc';

/** Die fünf Schritte der Oberfläche (Reihenfolge = Reihenfolge der Views in App.tsx). */
export const STEPS = [
  { id: 'vergabe', title: 'Vergabe', sub: 'Eckdaten & Lose' },
  { id: 'unterlagen', title: 'Unterlagen', sub: 'LV & Angebote einlesen' },
  { id: 'preis', title: 'Preisspiegel', sub: 'je Los vergleichen' },
  { id: 'wertung', title: 'Wertung', sub: 'Prüfen & bewerten' },
  { id: 'vermerk', title: 'Vermerk', sub: 'Vergabevorschlag' },
];

/** Welche Schritte sind fachlich abgeschlossen (Haken in der Fortschrittsleiste). */
export function stepsDone(s: State): boolean[] {
  return [
    !!s.project.titel.trim() && s.lose.length > 0,
    s.lv.length > 0 && s.offers.length > 0,
    s.lose.length > 0 && s.lose.every((l) => computeLos(s, l).some((c) => c.complete)),
    s.lose.length > 0 && s.lose.every((l) => computeLos(s, l).some((c) => c.rank === 1)),
    false,
  ];
}
