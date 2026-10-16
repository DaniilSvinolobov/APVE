import type { State } from './types';
import { FORMAL_CHECKS } from './types';
import { uid } from './fmt';

const allChecks = () => Object.fromEntries(FORMAL_CHECKS.map((c) => [c.id, true]));

export function emptyState(): State {
  return {
    project: {
      titel: '', nummer: '', auftraggeber: '', gewerk: '', verfahren: 'VOB/A (national)',
      vergabeart: 'Öffentliche Ausschreibung', submission: '', sachbearbeiter: '',
      kostenschaetzung: null, mwst: 19, schwelle: 15, mode: 'lv', kriterienModus: 'preis',
    },
    bidders: [newBidder(''), newBidder(''), newBidder('')],
    positions: [],
    prices: {},
    criteria: [
      { id: uid(), name: 'Ausführungstermin / Kapazität', weight: 10 },
      { id: uid(), name: 'Qualität / Referenzen', weight: 10 },
    ],
    scores: {},
    empfehlungBieter: '',
    begruendung: '',
    begruendungManuell: false,
    freigabe: { pruefer: '', freigeber: '', datum: '' },
  };
}

export function newBidder(name: string) {
  return {
    id: uid(), name, checks: {}, excluded: false, exclusionReason: '', nachlass: null, skonto: null,
    summeBieter: null, summe: null, aufklaerung: '' as const, aufklaerungNotiz: '',
  };
}

export function demoState(): State {
  const s = emptyState();
  s.project = {
    ...s.project,
    titel: 'Neubau Kita „Sonnenhof“ – Gewerk Trockenbau',
    nummer: 'V-2026-0142',
    auftraggeber: 'Stadt Musterstadt, Hochbauamt',
    gewerk: 'Trockenbauarbeiten',
    submission: '2026-09-24',
    sachbearbeiter: 'M. Beispiel',
    kostenschaetzung: 97000,
  };
  const names = ['Trockenbau Müller GmbH', 'Ausbau Schneider & Söhne', 'KB Innenausbau GmbH', 'Raumkonzept Nord KG'];
  s.bidders = names.map((n) => ({ ...newBidder(n), checks: allChecks() }));
  s.bidders[2].checks.nu = false;
  s.bidders[3].checks.unterschrift = false;
  s.bidders[3].excluded = true;
  s.bidders[3].exclusionReason = 'Angebot nicht unterschrieben; Nachforderung nach § 16a VOB/A erfolglos (Frist abgelaufen).';
  s.bidders[0].nachlass = 2;
  s.bidders[1].skonto = 3;
  const lv: [string, string, number, string, number[]][] = [
    ['01.01', 'Metallständerwand W112, d=125 mm, 2×12,5 mm GKB beidseitig', 640, 'm²', [46.5, 49.8, 41.2, 45.0]],
    ['01.02', 'Metallständerwand W115 Feuchtraum, imprägnierte Platten', 180, 'm²', [58.9, 61.0, 52.4, 57.0]],
    ['01.03', 'Unterdecke GK abgehängt, Brandschutz F30', 520, 'm²', [52.2, 55.5, 31.0, 50.8]],
    ['01.04', 'Revisionsklappen 400×400 mm einbauen', 24, 'St', [89.0, 94.5, 78.0, 88.0]],
    ['01.05', 'Türzargen in Trockenbauwand einbauen', 36, 'St', [124.0, 131.0, 112.0, 120.0]],
    ['01.06', 'Spachtelqualität Q3 an Wänden und Decken', 1340, 'm²', [7.8, 8.4, 6.9, 7.5]],
    ['01.07', 'Mineralwolle-Dämmung 80 mm in Wänden', 820, 'm²', [9.6, 10.9, 8.8, 9.2]],
    ['01.08', 'Stundenlohnarbeiten Facharbeiter (Bedarfsposition)', 40, 'Std', [58, 62, 54, 57]],
  ];
  s.positions = lv.map(([nr, text, menge, einheit], i) => ({ id: uid(), nr, text, menge, einheit, bedarf: i === 7 }));
  s.positions.forEach((pos, i) => {
    s.prices[pos.id] = {};
    s.bidders.forEach((b, j) => (s.prices[pos.id][b.id] = lv[i][4][j]));
  });
  s.bidders[0].summeBieter = null;
  s.bidders[1].summeBieter = 98809.0;
  s.criteria.forEach((c, i) => {
    s.scores[c.id] = {};
    s.bidders.forEach((b, j) => (s.scores[c.id][b.id] = [8, 7, 6, 5][(j + i) % 4]));
  });
  return s;
}
