import type { Offer, State } from './types';
import { uid } from './fmt';
import { DEFAULT_UNTERLAGEN } from './types';

export function emptyState(): State {
  return {
    v: 2,
    project: {
      titel: '', nummer: '', auftraggeber: '', vergabestelle: '', ersteller: '', ort: '', baustelle: '', verfahren: '',
      kostenBasis: 'brutto', kostenDatum: '', mwst: 19, schwelle: 15, abweichung: 30, engereWahl: 2,
      eroeffnung: '', zuschlagsfrist: '', beginn: '', ende: '', angefordert: null, budgetBrutto: null, unterzeichner: '', datum: '', vollstaendigkeit: true,
    },
    lose: [], titles: {}, unterlagen: DEFAULT_UNTERLAGEN.map((label) => ({ id: uid(), label })), lv: [], offers: [], bew: {}, texte: {}, zuschlag: {},
    anlagen: [],
    logo: '', schaetz: {}, lvInfo: { lv: '', schaetz: '' },
  };
}

const mkOffer = (nr: number, firma: string, ort: string, runde: 1 | 2, lose: string[], prices: Offer['prices'], extra: Partial<Offer> = {}): Offer => ({
  id: uid(), nr, firma, ort, runde, datum: runde === 1 ? '2026-07-30' : '2026-08-24', lose, nachlass: null, nachlassLose: [], skonto: null,
  prices, summen: {}, pruef: {}, textErg: [], nachforderung: [], dateien: [], warnungen: [], quelle: 'Beispiel', ...extra,
});

/** Synthetisches Beispiel (frei erfunden): 2 Lose, 3 Bieter, Nachverhandlung für LOS1. */
export function demoState(): State {
  const s = emptyState();
  s.project = {
    ...s.project, titel: 'Neubau Quartierspark Nordstadt (BA2)', nummer: 'V-2026-0087', auftraggeber: 'Stadt Beispielburg',
    vergabestelle: 'Zentrale Vergabestelle der Stadt Beispielburg', ersteller: 'Landschaftsarchitekten Muster GmbH', ort: 'Berlin', baustelle: '50181 Bedburg',
    kostenDatum: '2026-06-10', eroeffnung: '2026-07-14T10:00', zuschlagsfrist: '2026-08-14', beginn: 'ab 07.09.2026', ende: 'Ende 2026',
    angefordert: 12, budgetBrutto: 213000, unterzeichner: 'i. A. Erika Mustermann', datum: '2026-09-02',
  };
  const l1 = { id: uid(), oz: '01', nr: 'LOS1', name: 'Wege- und Landschaftsbauarbeiten', kosten: 165000, imVermerk: true, imBudget: true };
  const l2 = { id: uid(), oz: '02', nr: 'LOS2', name: 'Spielgeräte und Ausstattung', kosten: 48000, imVermerk: true, imBudget: true };
  s.lose = [l1, l2];
  s.titles = { '01': 'LOS1 - Wege- und Landschaftsbauarbeiten', '01.01': 'Abbruch und Erdarbeiten', '01.02': 'Wege und Plätze', '01.03': 'Vegetationsarbeiten', '02': 'LOS2 - Spielgeräte und Ausstattung', '02.01': 'Spielgeräte', '02.02': 'Ausstattung' };
  const defs: [string, string, number, string, number[]][] = [
    ['01.01.01', 'Wegedecke aufnehmen und entsorgen', 1400, 'm²', [4.2, 4.8, 3.9]],
    ['01.01.02', 'Boden abtragen, Klasse 3–5', 900, 'm³', [11.5, 12.9, 10.8]],
    ['01.01.03', 'Baumstümpfe roden', 14, 'St', [180, 210, 95]],
    ['01.02.01', 'Tragschicht Schotter 0/32, d=25 cm', 1250, 'm²', [18.9, 19.5, 17.8]],
    ['01.02.02', 'Pflasterbelag Betonstein 10/20/8', 640, 'm²', [58, 61.5, 55]],
    ['01.02.03', 'Randeinfassung Rasenbord', 380, 'm', [24.5, 26, 33.8]],
    ['01.03.01', 'Rasenansaat inkl. Fertigstellungspflege', 3100, 'm²', [2.1, 2.6, 1.4]],
    ['01.03.02', 'Gehölzpflanzung, Sträucher 60–100', 1450, 'St', [9.8, 11.2, 6.9]],
    ['01.03.03', 'Baumpflanzung, Hochstamm 18–20', 22, 'St', [420, 465, 380]],
    ['02.01.01', 'Klettergerüst liefern und montieren', 2, 'St', [8400, 8950, 9100]],
    ['02.01.02', 'Fallschutzbelag EPDM, 4 cm', 120, 'm²', [96, 104, 99]],
    ['02.02.01', 'Sitzbank mit Rückenlehne', 9, 'St', [820, 790, 860]],
  ];
  s.lv = defs.map(([oz, kurz, menge, einheit]) => ({ oz, kurz, menge, mengeOrig: menge, einheit, bedarf: false }));
  const pr = (i: number, only?: string) => Object.fromEntries(defs.filter((d) => !only || d[0].startsWith(only)).map((d) => [d[0].replace(/\./g, ''), { ep: d[4][i], gp: Math.round(d[2] * d[4][i] * 100) / 100 }]));
  const o1 = mkOffer(1, 'Gartenbau Weber GmbH', 'Kerpen', 1, [l1.id, l2.id], pr(0), { nachlass: 2, nachlassLose: [l1.id] });
  const o2 = mkOffer(2, 'Grün & Form Landschaftsbau KG', '46395 Bocholt', 1, [l1.id, l2.id], pr(1));
  const o3 = mkOffer(3, 'Natura Außenanlagen GmbH', 'Düren', 1, [l1.id, l2.id], pr(2));
  // Nachverhandlung LOS1: Bieter 3 senkt Position 01.02.03 auf marktüblichen Preis
  const p4 = pr(2, '01'); p4['010203'] = { ep: 26.2, gp: Math.round(380 * 26.2 * 100) / 100 };
  const o4 = mkOffer(4, 'Natura Außenanlagen GmbH', 'Düren', 2, [l1.id], p4);
  const o5 = mkOffer(5, 'Gartenbau Weber GmbH', 'Kerpen', 2, [l1.id], pr(0, '01'));
  s.offers = [o1, o2, o3, o4, o5];
  for (const o of [o1, o2, o3]) for (const u of s.unterlagen) o.pruef[u.id] = { s: /222|234|248|223/.test(u.label) ? 'entf' : 'ok', d: '' };
  o3.pruef[s.unterlagen.find((u) => u.label.includes('221'))!.id] = { s: 'nach', d: '2026-08-04' };
  o2.pruef[s.unterlagen.find((u) => u.label.includes('233'))!.id] = { s: 'fehlt', d: '' };
  o3.nachforderung = ['VVB 221'];
  s.bew[`${o3.id}|${l1.id}`] = { ausschluss: '', aufklaerung: 'angemessen', aufklaerungNotiz: 'Rasen/Pflanzen aus eigener Baumschule', qualifikation: 'Die Qualifikation des Bieters ist bekannt, die Fachfirma hat bereits vergleichbare Leistungen für die Stadt erbracht (Quartierspark BA1).', km: null, auskoemm: true, erlaeuterung: 'Es handelt sich hierbei insbesondere um die Pflanzenlieferungen (Eigenproduktion).', zusatz: '', nichtGewertet: '' };
  return s;
}
