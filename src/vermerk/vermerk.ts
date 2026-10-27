import type { Los, State } from '../domain/types';
import { angemessenheit, auffaelligkeiten, computeLos, eignungsNachweis, engereWahl, finalRound, getBew, kostenOf, nuOf, offerBrutto, pruefStatus, schaetzSumme, unterlageZeile, zuschlagCell, type Cell } from '../domain/calc';
import { PSTATUS, type Nachunternehmer, type Offer } from '../domain/types';
import { fmtDate, fmtEUR, fmtNum, fmtDateTime, listDe, round2 } from '../domain/fmt';
import { kmFuerVermerk } from '../geo/entfernung';

export type Block =
  | { t: 'meta'; lines: { k?: string; v: string; bold?: boolean }[] }
  | { t: 'h'; n: string; text: string; lvl: 1 | 2 | 3 }
  | { t: 'p'; id: string; text: string }
  | { t: 'kv'; rows: { k: string; v: string; bold?: boolean }[]; ra?: boolean }
  | { t: 'tab'; cols: { h: string; w: number; a?: 'l' | 'c' | 'r' }[]; rows: string[][]; hl?: number[] }
  | { t: 'pruef'; title: string; head: string[]; rows: { label: string; cells: { txt: string; kind: string }[] }[]; foot: string[] }
  | { t: 'sign'; lines: string[] }
  | { t: 'anlagen'; items: string[] }
  | { t: 'gap' };

export const AKEYS = ['eroeffnung', 'mitteilung1', 'preisspiegel1', 'mitteilung2', 'preisspiegel2', 'vollstaendigkeit'] as const;

const pctDe = (v: number) => fmtNum(v, 2);
const losNrList = (lose: Los[]) => {
  const nums = lose.map((l) => Number(l.nr.replace(/\D/g, ''))).filter((n) => n > 0);
  if (nums.length === lose.length && nums.length > 1 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) return `LOS${nums[0]}-${nums[nums.length - 1]}`;
  return lose.map((l) => l.nr).join('+');
};
export const footerText = (s: State) => `${s.project.titel || 'Vergabe'}${s.lose.length ? ' / ' + losNrList(s.lose) : ''}, Vergabevermerk vom ${fmtDate(s.project.datum)}`;

/** Anlagenverzeichnis inkl. automatisch erzeugter Standardanlagen. */
export function anlagenList(s: State): { key: string; titel: string; custom?: boolean }[] {
  const hr0 = s.offers.length ? Math.min(...s.offers.map((o) => o.runde)) : 1;
  const r1 = s.offers.filter((o) => o.runde === hr0);
  const r2 = s.offers.filter((o) => o.runde > hr0);
  const range = (os: typeof r1) => (os.length ? (os.length > 1 ? `Nr. ${Math.min(...os.map((o) => o.nr))}-${Math.max(...os.map((o) => o.nr))}` : `Nr. ${os[0].nr}`) : '');
  const def: Record<string, string> = {
    eroeffnung: `Niederschrift über die (Er)Öffnung der Angebote vom ${fmtDate(s.project.eroeffnung)}`,
    mitteilung1: `Mitteilung über das Ergebnis nach Öffnung der Angebote vom ${fmtDate(s.project.eroeffnung)}`,
    preisspiegel1: `Preisspiegel Angebote ${range(r1)}${s.project.datum ? ` vom ${fmtDate(s.project.datum)}` : ''}`,
    mitteilung2: 'Mitteilung über das Ergebnis nach Öffnung der Angebote (Nachverhandlung)',
    preisspiegel2: `Preisspiegel Angebote ${range(r2)} (Nachverhandlung)`,
    vollstaendigkeit: 'Prüfung auf Vollständigkeit der abgegebenen Angebotsunterlagen',
  };
  const keys = AKEYS.filter((k) => (k.endsWith('2') ? r2.length > 0 : k === 'vollstaendigkeit' ? s.project.vollstaendigkeit : true));
  const out: { key: string; titel: string; custom?: boolean }[] = keys.map((k) => ({ key: k as string, titel: s.texte[`anlage:${k}`] ?? def[k] }));
  for (const a of s.anlagen) out.push({ key: a.id, titel: a.titel, custom: true });
  return out;
}

export function buildVermerk(s: State): Block[] {
  const p = s.project;
  const B: Block[] = [];
  const T = (id: string, text: string): Block => ({ t: 'p', id, text: s.texte[id] ?? text });
  const anl = anlagenList(s);
  const aNr = (key: string) => { const i = anl.findIndex((a) => a.key === key); return i >= 0 ? `Siehe Anlage ${i + 1} - ${anl[i].titel}` : ''; };
  const vLose = s.lose.filter((l) => l.imVermerk);
  const allCells = new Map(s.lose.map((l) => [l.id, computeLos(s, l)]));
  const hr = s.offers.length ? Math.min(...s.offers.map((o) => o.runde)) : 1;
  const r1 = s.offers.filter((o) => o.runde === hr);
  const vergabe = /VOB|Ausschreibung/.test(p.verfahren);
  const hasR2 = s.offers.some((o) => o.runde > hr);

  /* Kopf */
  B.push({
    t: 'meta',
    lines: [
      { v: p.titel || 'Maßnahme', bold: true },
      ...(p.massnahmeNr?.trim() ? [{ k: 'Maßnahmennummer:', v: p.massnahmeNr.trim(), bold: true }] : []),
      { k: 'Vergabenummer:', v: p.nummer || '–', bold: true },
      ...s.lose.map((l, i) => ({ k: i === 0 ? 'Leistung:' : '', v: `${l.nr}: ${l.name}`, bold: true })),
      { v: 'Prüfbericht und Vergabevorschlag (Vergabevermerk)', bold: true },
    ],
  });

  /* 1 */
  B.push({ t: 'h', n: '1.', text: 'Veranlassung', lvl: 1 });
  B.push(T('veranlassung',
    `Die ${p.auftraggeber || 'Auftraggeberin'} beabsichtigt die Umsetzung der Maßnahme „${p.titel || '…'}“.\nFür die Umsetzung sind noch diverse Bauleistungen erforderlich.\nGrundlage für diese Leistungen sind die Ausführungsplanung und Leistungsbeschreibung${p.ersteller ? ` des Planungsbüros ${p.ersteller}` : ''}.`));

  /* 2 */
  B.push({ t: 'h', n: '2.', text: 'Gegenstand der Ausschreibung', lvl: 1 });
  B.push(T('gegenstand', `Bei den ausgeschriebenen Leistungen handelt es sich um:\n${s.lose.map((l, i) => `${l.nr}: ${l.name}${i === s.lose.length - 1 ? '.' : ''}`).join('\n')}`));

  /* 3 */
  B.push({ t: 'h', n: '3.', text: 'Vergabeverfahren', lvl: 1 });
  B.push(T('verfahren', `Gewähltes Vergabeverfahren: ${p.verfahren || '–'}`));
  if (s.lose.some((l) => kostenOf(s, l) != null)) {
    B.push({ t: 'p', id: '_kosten', text: `Ermittlung Baukosten, Kostenvoranschlag${p.kostenDatum ? ' vom ' + fmtDate(p.kostenDatum) : ''}:` });
    B.push({ t: 'kv', rows: s.lose.filter((l) => kostenOf(s, l) != null).map((l) => ({ k: `${l.nr}:`, v: fmtEUR(kostenOf(s, l)) })), ra: true });
  }
  B.push({ t: 'p', id: '_fristen', text: 'Vergabefristen:' });
  B.push({ t: 'kv', rows: [
    { k: '- Eröffnungstermin am:', v: fmtDateTime(p.eroeffnung) },
    ...(p.zuschlagsfrist ? [{ k: '- Ende der Zuschlagsfrist:', v: fmtDate(p.zuschlagsfrist) }] : []),
  ] });
  if (p.beginn || p.ende) {
    B.push({ t: 'p', id: '_vertrag', text: 'Vertragsinhalt:' });
    B.push({ t: 'kv', rows: [...(p.beginn ? [{ k: '- Beginn der Ausführung:', v: p.beginn }] : []), ...(p.ende ? [{ k: '- Vollendung der Ausführung:', v: p.ende }] : [])] });
  }
  B.push({ t: 'p', id: '_teiln', text: 'Teilnehmer am Wettbewerb:' });
  B.push(T('teilnehmer', `- Anzahl der zur Angebotsabgabe aufgeforderten Unternehmen: ${p.angefordert ?? '–'}\n- Anzahl der eingegangenen Angebote: ${r1.length}\n  ${aNr('eroeffnung')}`));

  /* 4 */
  B.push({ t: 'h', n: '4.', text: 'Prüfung und Wertung der Angebote', lvl: 1 });
  B.push({ t: 'p', id: '_bieterliste', text: `Reihenfolge der eingegangenen Angebote / Bieternummern / ungeprüfte Brutto-Angebotssummen inkl. Preisnachlässe (${aNr('eroeffnung').replace('Siehe', 'Siehe')}):` });
  const nlLabel = (o: (typeof r1)[number]) => {
    if (!o.nachlass) return '-';
    const scope = o.nachlassLose.length ? `(${o.nachlassLose.map((id) => s.lose.find((l) => l.id === id)?.nr ?? '').join('+')})\n` : '';
    return `${scope}${pctDe(o.nachlass)}`;
  };
  const losSuffix = (o: (typeof r1)[number]) => {
    const sel = s.lose.filter((l) => o.lose.includes(l.id));
    if (s.lose.length < 2 || !sel.length) return '';
    return ` (LOS ${sel.map((l) => l.nr.replace(/^LOS\s*/i, '')).join('+')})`;
  };
  B.push({
    t: 'tab',
    cols: [{ h: 'Angebot\nNr.', w: 12, a: 'c' }, { h: 'Bieter\nFirmenname, Ort', w: 46 }, { h: 'Nachlass\nv. H.', w: 14, a: 'c' }, { h: 'Angebotssumme\nungeprüft (brutto EUR)', w: 28, a: 'c' }],
    rows: r1.map((o) => o.status === 'zurueck'
      ? [String(o.nr), `${o.firma}${losSuffix(o)}\n(Angebot zurückgezogen)`, '-', '-']
      : [String(o.nr), `${o.firma}${losSuffix(o)}`, nlLabel(o), fmtNum(offerBrutto(s, o) ?? 0)]),
  });

  B.push({ t: 'h', n: '4.1', text: `Formale Prüfung der Angebote${vergabe ? ' gem. VOB/A § 16' : ''}`, lvl: 2 });
  const zurueck = r1.filter((o) => o.status === 'zurueck');
  const formalAus = r1.filter((o) => o.status === 'formal');
  B.push(T('formal', [
    `Die ${p.vergabestelle || 'Vergabestelle'} hat eine erste formelle und rechnerische Prüfung durchgeführt.`,
    formalAus.length
      ? `Folgende Angebote wurden von der weiteren Prüfung ausgeschlossen:\n${formalAus.map((o) => `- Angebot Nr. ${o.nr}, Fa. ${o.firma}${o.statusGrund?.trim() ? `: ${o.statusGrund.trim().replace(/\.$/, '')}` : ' [Grund angeben]'}`).join('\n')}`
      : 'Es wurden keine Angebote von der weiteren Prüfung ausgeschlossen.',
    ...zurueck.map((o) => `Das Angebot Nr. ${o.nr} der Fa. ${o.firma} wurde zurückgezogen.`),
    aNr('mitteilung1'),
    s.project.vollstaendigkeit ? `Das Ergebnis der Prüfung auf Vollständigkeit der Angebotsunterlagen ist in Anlage ${anl.findIndex((a) => a.key === 'vollstaendigkeit') + 1} dargestellt.` : '',
  ].filter(Boolean).join('\n')));

  B.push({ t: 'h', n: '4.2', text: 'Submissionsergebnis', lvl: 2 });
  const nachlassNrs = r1.filter((o) => o.nachlass && o.status !== 'zurueck').map((o) => o.nr);
  const neben = r1.filter((o) => o.nebenangebot && o.status !== 'zurueck');
  const keinLos = r1.flatMap((o) => s.lose.filter((l) => !o.lose.includes(l.id) && r1.some((x) => x !== o && x.lose.includes(l.id))).map((l) => `In Hauptangebot Nr. ${o.nr} wurde kein Angebot für ${l.nr} abgegeben.`));
  B.push(T('submission', [
    // „fristgerecht“ nur, solange kein Angebot formal ausgeschlossen ist (der Grund kann die Frist sein)
    `Es wurden insgesamt ${r1.length} Hauptangebote${formalAus.length ? '' : ' fristgerecht'} zum Submissionstermin am ${fmtDate(p.eroeffnung)} eingereicht.`,
    zurueck.length ? `${zurueck.length > 1 ? 'Die Angebote' : 'Das Angebot'} Nr. ${listDe(zurueck.map((o) => String(o.nr)))} ${zurueck.length > 1 ? 'wurden' : 'wurde'} zurückgezogen.` : '',
    nachlassNrs.length ? `Hauptangebot Nr. ${listDe(nachlassNrs.map(String))} wurde${nachlassNrs.length > 1 ? 'n' : ''} mit einem Nachlass eingereicht.` : '',
    ...keinLos,
    neben.length ? `${neben.length > 1 ? 'Den Hauptangeboten' : 'Dem Hauptangebot'} Nr. ${listDe(neben.map((o) => String(o.nr)))} wurde${neben.length > 1 ? ' jeweils' : ''} ein Nebenangebot beigefügt.` : 'Es wurden keine Nebenangebote beigefügt.',
    'Es handelt sich um folgende Firmen mit nachstehend genannten Brutto-Angebotssummen inkl. Preisnachlässe (ungeprüft) in der angegebenen Rangfolge aufgeteilt nach Lose:',
  ].filter(Boolean).join('\n')));
  const rangTab = (cells: Cell[]): Block => ({
    t: 'tab',
    cols: [{ h: 'Rang\nNr.', w: 10, a: 'c' }, { h: 'Angebot\nNr.', w: 12, a: 'c' }, { h: 'Bieter\nFirmenname, Ort', w: 38 }, { h: 'Nachlass\nv. H.', w: 13, a: 'c' }, { h: 'Angebotssumme\nungeprüft (brutto EUR)', w: 27, a: 'c' }],
    rows: cells.filter((c) => c.rankAll).sort((a, b) => a.rankAll! - b.rankAll!).map((c) => [String(c.rankAll), String(c.offer.nr), `${c.offer.firma}${c.offer.status === 'formal' ? ' (ausgeschlossen)' : ''}`, c.nachlass ? pctDe(c.nachlass) : '-', fmtNum(c.gross ?? 0)]),
    hl: [0],
  });
  for (const l of s.lose) {
    const cells = (allCells.get(l.id) ?? []).filter((c) => c.offer.runde === hr);
    if (!cells.length) continue;
    B.push({ t: 'h', n: '', text: `${l.nr}: ${l.name}`, lvl: 3 });
    B.push(rangTab(cells));
  }

  B.push({ t: 'h', n: '4.3', text: 'Rechnerische Prüfung der Angebote', lvl: 2 });
  const errs = s.lose.flatMap((l) => (allCells.get(l.id) ?? []).filter((c) => c.rechenDiff != null && Math.abs(c.rechenDiff) > 0.01 && !c.mengeAbw.length));
  const gewertet = (l: Los) => (allCells.get(l.id) ?? []).filter((c) => c.offer.runde === hr && c.rankAll && !c.offer.status).sort((a, b) => a.rankAll! - b.rankAll!);
  const offenPos = s.lose.flatMap((l) => gewertet(l).filter((c) => s.lv.length && (c.missing || c.zero)).map((c) => `Im Angebot Nr. ${c.offer.nr}${s.lose.length > 1 ? ` (${l.nr})` : ''} ${c.missing ? `${c.missing === 1 ? 'ist 1 Position' : `sind ${c.missing} Positionen`} nicht verpreist` : ''}${c.missing && c.zero ? ', ' : ''}${c.zero ? `${c.zero === 1 ? 'ist 1 Position' : `sind ${c.zero} Positionen`} mit 0,00 € verpreist` : ''}.`));
  B.push(T('rechnerisch', [
    errs.length ? `Bei folgenden Angeboten wurden Rechenfehler festgestellt: ${errs.map((c) => `Angebot Nr. ${c.offer.nr} (${c.los.nr})`).join(', ')}.` : 'Alle Angebote wurden nachgerechnet, es wurden keine Fehler festgestellt.',
    s.lv.length ? (offenPos.length ? offenPos.join('\n') : 'Alle Positionen der Angebote waren ordnungsgemäß verpreist.') : '',
    aNr('preisspiegel1'),
    'Nach abgeschlossener rechnerischer Prüfung ergibt sich folgendes Angebotsergebnis der Bieter:',
  ].filter(Boolean).join('\n')));
  const mwf = 1 + p.mwst / 100;
  for (const l of s.lose) {
    const cs = gewertet(l);
    if (!cs.length) continue;
    const k = kostenOf(s, l);
    const kNet = schaetzSumme(s, l) ?? (k == null ? null : p.kostenBasis === 'brutto' ? round2(k / mwf) : k);
    const kBr = k != null && p.kostenBasis === 'brutto' ? k : kNet == null ? null : round2(kNet * mwf);
    if (s.lose.length > 1) B.push({ t: 'h', n: '', text: `${l.nr}: ${l.name}`, lvl: 3 });
    B.push({
      t: 'tab',
      cols: [{ h: 'Angebot', w: 56 }, { h: 'geprüfte Angebotssumme\nnetto (EUR)', w: 22, a: 'r' }, { h: '\nbrutto (EUR)', w: 22, a: 'r' }],
      rows: [
        ...cs.map((c) => [`${c.offer.nr}_${c.offer.firma}`, fmtNum(c.net ?? 0), fmtNum(c.gross ?? 0)]),
        ...(kNet != null ? [[`Verpreistes Leistungsverzeichnis (Kostenvoranschlag${p.ersteller ? ` ${p.ersteller}` : ''})`, fmtNum(kNet), kBr != null ? fmtNum(kBr) : '–']] : []),
      ],
    });
  }

  B.push({ t: 'h', n: '4.4', text: 'Festlegungen aufgrund der formalen und rechnerischen Prüfung', lvl: 2 });
  const sep = s.lose.filter((l) => !l.imVermerk);
  // einzeln geprüft werden die Angebote der engeren Wahl je Los (Abschnitt 4.5 ff.); die übrigen wertbaren nur benennen
  const nrs = (os: { nr: number }[]) => [...new Set(os.map((o) => o.nr))].sort((a, b) => a - b).map(String);
  const geprueft = nrs(vLose.flatMap((l) => engereWahl(s, allCells.get(l.id) ?? []).take.map((c) => c.offer)));
  const nichtEinzeln = nrs(vLose.flatMap((l) => engereWahl(s, allCells.get(l.id) ?? []).ranked.map((c) => c.offer))).filter((n) => !geprueft.includes(n));
  B.push(T('festlegungen', [
    formalAus.length
      ? `Aufgrund o.a. Prüfung ${formalAus.length > 1 ? 'wurden die Angebote' : 'wurde das Angebot'} Nr. ${listDe(nrs(formalAus))} von der weiteren Prüfung ausgeschlossen.`
      : 'Aufgrund o.a. Prüfung wurde kein Angebot von der weiteren Prüfung ausgeschlossen.',
    geprueft.length ? `Nachfolgend ${geprueft.length > 1 ? 'werden die Angebote' : 'wird das Angebot'} Nr. ${listDe(geprueft)} technisch und wirtschaftlich geprüft${nichtEinzeln.length ? ' (engere Wahl)' : ''}.` : '',
    ...vLose.flatMap((l) => engereText(s, l, allCells.get(l.id) ?? [], vLose.length > 1)),
    '',
    ...s.offers.filter((o) => !o.status).flatMap((o) => {
      const ps = pruefStatus(s, o);
      const out: string[] = [];
      if (ps.nach.length) {
        const ds = [...new Set(ps.nach.map((x) => x.d).filter(Boolean))];
        out.push(`Für das Angebot Nr. ${o.nr} ${ps.nach.length > 1 ? 'fehlten die Unterlagen' : 'fehlte die Unterlage'} ${listDe(ps.nach.map((x) => x.label))}; ${ps.nach.length > 1 ? 'diese wurden' : 'diese wurde'} nachträglich durch die ${p.vergabestelle || 'Vergabestelle'} bei Fa. ${o.firma} angefordert${ds.length === 1 ? ` und am ${fmtDate(ds[0])} nachgereicht` : ''}.`);
      } else if (!Object.keys(o.pruef ?? {}).length && o.nachforderung.length) out.push(`Für das Angebot Nr. ${o.nr} fehlten Unterlagen (${o.nachforderung.join(', ')}); diese wurden nachträglich durch die ${p.vergabestelle || 'Vergabestelle'} bei Fa. ${o.firma} angefordert.`);
      if (o.preisQuelle === 'pdf') out.push(`Das Angebot Nr. ${o.nr} (Fa. ${o.firma}) enthält die Preise nur im Leistungsverzeichnis als PDF; die beigefügte GAEB-Datei ist nicht bepreist. Die Preise wurden aus dem PDF übernommen und rechnerisch geprüft.`);
      out.push(...offeneUnterlagen(s, o));
      return out;
    }),
    ...(sep.length ? ['', `Die Angebote für ${listDe(sep.map((l) => l.nr))} werden durch die ${p.auftraggeber || 'Auftraggeberin'} technisch und wirtschaftlich geprüft und nachfolgend nicht weiter im Vergabevermerk aufgeführt.`] : []),
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim()));

  /* 4.5 Nachweise und Eignung (je einzeln geprüftem Angebot) */
  let n = 5;
  const eigOffers = [...new Map(vLose.flatMap((l) => engereWahl(s, allCells.get(l.id) ?? []).take.map((c) => [c.offer.id, c.offer] as const))).values()].sort((a, b) => a.nr - b.nr);
  if (eigOffers.length) {
    B.push({ t: 'h', n: `4.${n}`, text: 'Nachweise und Eignungsprüfung', lvl: 2 });
    for (const o of eigOffers) {
      B.push({ t: 'h', n: '', text: `Angebot Nr. ${o.nr}, ${o.firma}`, lvl: 3 });
      B.push(T(`eignung:${o.id}`, eignungText(s, o)));
    }
    n++;
  }

  /* 4.6 ff. je Los */
  for (const l of vLose) {
    const cells = allCells.get(l.id) ?? [];
    if (!cells.length) continue;
    const hrl = Math.min(...cells.map((c) => c.offer.runde));
    const first = cells.filter((c) => c.offer.runde === hrl);
    const { take, ranked } = engereWahl(s, cells);
    const eng = ranked.length > take.length;
    B.push({ t: 'h', n: `4.${n}`, text: `Technische und wirtschaftliche Prüfung der Angebote ${l.nr}${eng ? ' (Engere Wahl)' : ''}`, lvl: 2 });
    const ang = angemessenText(s, l, take);
    if (ang) B.push(T(`angem:${l.id}`, ang));
    take.forEach((c, i) => {
      B.push({ t: 'h', n: `4.${n}.${i + 1}`, text: `Prüfung und Wertung des Angebotes auf Rang ${c.rankAll}, ${c.offer.firma}`, lvl: 3 });
      B.push(T(`bew:${c.offer.id}|${l.id}`, bewText(s, l, cells, c)));
    });
    n++;
    const later = [...new Set(cells.filter((c) => c.offer.runde > hrl).map((c) => c.offer.runde))].sort();
    for (const rd of later) {
      const rc = cells.filter((c) => c.offer.runde === rd);
      B.push({ t: 'h', n: `4.${n}`, text: `Nachverhandlung der Angebote für ${l.nr}: ${l.name}`, lvl: 2 });
      const missing = first.filter((c) => !rc.some((x) => x.offer.firma === c.offer.firma) && !c.excluded);
      B.push(T(`nv:${l.id}:${rd}`, [
        `Im Rahmen der technischen und wirtschaftlichen Prüfung (siehe Titel 4.${n - 1}) wurde Folgendes festgestellt:`,
        s.nvGrund?.[l.id]?.trim() || '[Anlass der Nachverhandlung angeben – Schritt „Wertung“]',
        `Aufgrund o.g. Feststellungen wurde ${l.nr} nachverhandelt.`,
        '',
        `Es wurden insgesamt ${rc.length} nachverhandelte Angebote für ${l.nr}${rc.every((c) => !c.nachlass) ? ' ohne Nachlass' : ''} eingereicht.`,
        ...missing.map((c) => `Fa. ${c.offer.firma} hat im Rahmen der Nachverhandlung kein Angebot abgegeben.`),
        aNr('mitteilung2'),
      ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n')));
      B.push({ t: 'p', id: `_nvtab:${l.id}`, text: `Es handelt sich um folgende Firmen mit nachstehend genannten Brutto-Angebotssummen in der angegebenen Rangfolge (${aNr('preisspiegel2')}):` });
      B.push(rangTab(rc));
      rc.filter((c) => c.rankAll).sort((a, b) => a.rankAll! - b.rankAll!).forEach((c) => B.push(T(`bew:${c.offer.id}|${l.id}`, bewText(s, l, cells, c, true))));
      n++;
    }
  }

  /* 5 Vergabevorschlag */
  B.push({ t: 'h', n: '5.', text: 'Vergabevorschlag', lvl: 1 });
  B.push(T('vorschlag', 'Es wird vorgeschlagen, den Zuschlag auf das insgesamt annehmbarste Angebot zu erteilen:\n\nDamit ergäben sich nachfolgende Auftragssummen:'));
  const winners: { l: Los; c: Cell }[] = [];
  for (const l of vLose) {
    const cells = allCells.get(l.id) ?? [];
    const c = zuschlagCell(s, l, cells);
    if (!c) continue;
    winners.push({ l, c });
    B.push({ t: 'p', id: `_z:${l.id}`, text: `${l.nr}: Fa. ${c.offer.firma}` });
    const mw = round2((c.gross ?? 0) - (c.net ?? 0));
    B.push({ t: 'kv', rows: [
      ...(c.nachlass ? [{ k: `Angebotssumme netto vor Nachlass`, v: fmtEUR(c.sumNet) }, { k: `Nachlass ${pctDe(c.nachlass)} %`, v: fmtEUR(round2((c.net ?? 0) - (c.sumNet ?? 0))) }] : []),
      { k: 'Angebotssumme netto', v: fmtEUR(c.net) }, { k: `${pctDe(s.project.mwst)} % MwSt.`, v: fmtEUR(mw) }, { k: 'Auftragssumme brutto', v: fmtEUR(c.gross), bold: true },
    ], ra: true });
  }

  /* 6 Budget */
  B.push({ t: 'h', n: '6.', text: 'Einordnung in das Gesamtbudget des Bauvorhabens', lvl: 1 });
  const bw = winners.filter((w) => w.l.imBudget);
  const sum = round2(bw.reduce((a, w) => a + (w.c.gross ?? 0), 0));
  const bud = p.budgetBrutto ?? budgetAusKosten(s);
  const diff = bud ? (sum / bud - 1) * 100 : null;
  B.push(T('budget', [
    `Im Rahmen des Bauvorhabens „${p.titel || '…'}“ wurden für ${listDe(s.lose.filter((l) => l.imBudget).map((l) => l.nr))} durch Unterzeichner Baukosten in Höhe von brutto ${bud ? fmtEUR(bud) : '[Gesamtbudget angeben]'}${p.budgetBrutto == null && bud ? ` (Kostenvoranschlag${p.kostenDatum ? ` vom ${fmtDate(p.kostenDatum)}` : ''})` : ''} ermittelt.`,
    bw.length ? `${listDe(bw.map((w) => `das Angebot des ${w.c.rank === 1 ? 'günstigsten' : 'für den Zuschlag vorgeschlagenen'} Bieters für ${w.l.nr}, Fa. ${w.c.offer.firma} vom ${fmtDate(w.c.offer.datum)}`)).replace(/^d/, 'D')} ${bw.length > 1 ? 'unterschreiten' : 'unterschreitet'} diese Kostenermittlung${diff != null && diff > 0 ? ' nicht' : diff != null && diff < -10 ? ' deutlich' : ''}${diff != null && Math.abs(diff) >= 0.005 ? ` um ca. ${pctDe(Math.abs(diff))} %` : ''} (Gesamt, brutto: ${fmtEUR(sum)}).`.replace('unterschreiten diese Kostenermittlung nicht', 'überschreiten diese Kostenermittlung').replace('unterschreitet diese Kostenermittlung nicht', 'überschreitet diese Kostenermittlung') : '',
  ].filter(Boolean).join('\n')));

  B.push({ t: 'gap' });
  B.push({ t: 'sign', lines: [`${p.ort || '…'}, den ${fmtDate(p.datum)}`, p.unterzeichner ? `${p.unterzeichner},` : '', p.ersteller] });
  B.push({ t: 'anlagen', items: anl.map((a, i) => `${i + 1} - ${a.titel}`) });
  if (p.vollstaendigkeit && s.offers.length) {
    const st = Object.fromEntries(PSTATUS.map((x) => [x.v, x]));
    B.push({
      t: 'pruef',
      title: 'Prüfung auf Vollständigkeit der abgegebenen Angebotsunterlagen',
      head: s.offers.map((o) => `${o.nr}_${o.firma}`),
      rows: s.unterlagen.filter((u) => u.label.trim()).map((u) => ({
        label: u.label,
        cells: s.offers.map((o) => {
          const x = o.pruef?.[u.id];
          if (!x) return { txt: '', kind: '' };
          return { txt: x.s === 'nach' ? `Nachgereicht${x.d ? ' ' + fmtDate(x.d) : ''}` : st[x.s].cell, kind: x.s };
        }),
      })),
      foot: [fmtDate(p.datum), p.ersteller],
    });
  }
  void finalRound; void hasR2; void getBew;
  return B;
}

/** Offene Punkte der Vollständigkeitsprüfung als Sätze, getrennt nach Befund (fehlt, nicht ausgefüllt, teilweise, nicht unterschrieben). */
export function offeneUnterlagen(s: State, o: Offer): string[] {
  const rows = s.unterlagen.map((u) => ({ u, p: o.pruef?.[u.id] })).filter((r) => r.p);
  const z234 = unterlageZeile(s, '234');
  const lab = (st: string) => rows.filter((r) => r.p!.s === st).map((r) => r.u.label + (r.u.id === z234?.id && st === 'leer' ? ' (keine Bietergemeinschaft vorgesehen)' : ''));
  const out: string[] = [];
  const mehr = (l: string[]) => l.length > 1;
  const fehlt = lab('fehlt'), leer = lab('leer'), teil = lab('teil'), unsign = lab('unsign');
  if (fehlt.length) out.push(`Beim Angebot Nr. ${o.nr} ${mehr(fehlt) ? 'fehlen' : 'fehlt'} weiterhin: ${listDe(fehlt)}.`);
  if (leer.length) out.push(`Beim Angebot Nr. ${o.nr} ${mehr(leer) ? 'wurden folgende Unterlagen' : 'wurde folgende Unterlage'} unausgefüllt eingereicht: ${listDe(leer)}.`);
  if (teil.length) out.push(`Beim Angebot Nr. ${o.nr} ${mehr(teil) ? 'sind folgende Unterlagen' : 'ist folgende Unterlage'} nur teilweise ausgefüllt: ${listDe(teil)}.`);
  if (unsign.length) out.push(`Beim Angebot Nr. ${o.nr} ${mehr(unsign) ? 'sind folgende Unterlagen' : 'ist folgende Unterlage'} nicht unterschrieben: ${listDe(unsign)}.`);
  return out;
}

/** „Fa. Straat 1“ – ohne doppeltes „Fa.“ und ohne „Fa.“ vor Büros („Vermessungsbüro …“). */
const faName = (f: string) => (/^(Fa\.|Firma)\s/i.test(f) || /büro|^Ing/i.test(f) ? f : `Fa. ${f}`);
const nuZeile = (x: Nachunternehmer) => {
  const det = [x.leistung.trim(), x.oz.trim() ? `OZ ${x.oz.trim()}` : ''].filter(Boolean).join(', ');
  return `- ${x.firma.trim() ? faName(x.firma.trim()) : '[Unternehmen angeben]'}${det ? ` (${det})` : ''}`;
};

/** Abschnitt „Nachweise und Eignungsprüfung“ für ein Angebot: Eignungsnachweis und Nachunternehmereinsatz. */
export function eignungText(s: State, o: Offer): string {
  const L: string[] = [];
  const eg = eignungsNachweis(s, o);
  const z124 = unterlageZeile(s, '124');
  const nach = z124 && o.pruef?.[z124.id]?.s === 'nach' ? o.pruef[z124.id].d : null;
  if (eg === 'pq') L.push(`Der Bieter ist präqualifiziert unter der Nr. ${o.pq!.trim()}.`);
  else if (eg === '124') L.push(`Der Bieter hat mit dem Dokument Eigenerklärung zur Eignung (VVB 124) den Eignungsnachweis erbracht${nach != null ? ` (nachgereicht${nach ? ` am ${fmtDate(nach)}` : ''})` : ''}.`);
  else L.push('Ein Eignungsnachweis (Präqualifikation oder Eigenerklärung zur Eignung, VVB 124) wurde nicht festgestellt. [bitte prüfen]');
  const nu = nuOf(s, o);
  const eigen = nu?.filter((x) => x.art !== 'kapazitaet') ?? [];
  const kap = nu?.filter((x) => x.art === 'kapazitaet') ?? [];
  if (!nu) L.push('Angaben zum Nachunternehmereinsatz (VVB 233): [bitte ergänzen]');
  else if (!eigen.length) L.push('Ein Nachunternehmereinsatz ist nicht vorgesehen.');
  else L.push('Folgender Nachunternehmereinsatz wurde vorgesehen:', ...eigen.map(nuZeile));
  if (kap.length) L.push('Der Bieter beruft sich auf die Kapazitäten folgender Unternehmen (VVB 235):', ...kap.map(nuZeile));
  return L.join('\n');
}

/** Kostenvoranschlag brutto aller Lose „im Budget“ (Ersatz, wenn kein Gesamtbudget eingetragen ist). */
export function budgetAusKosten(s: State): number | null {
  const ls = s.lose.filter((l) => l.imBudget);
  const ks = ls.map((l) => kostenOf(s, l));
  if (!ls.length || ks.some((k) => k == null)) return null;
  const f = s.project.kostenBasis === 'brutto' ? 1 : 1 + s.project.mwst / 100;
  return round2(ks.reduce<number>((a, k) => a + (k ?? 0) * f, 0));
}

/** Einleitung zur Angemessenheit der Preise je Los: Lage der geprüften Angebote zum Kostenvoranschlag. */
export function angemessenText(s: State, l: Los, take: Cell[]): string {
  const k = kostenOf(s, l);
  const cs = take.filter((c) => c.complete && c.gross != null);
  if (!k || !cs.length) return '';
  const basis = s.project.kostenBasis;
  const anteil = cs.map((c) => ((basis === 'brutto' ? c.gross! : c.net!) / k) * 100);
  const lo = Math.min(...anteil), hi = Math.max(...anteil);
  const L = [`Der Kostenvoranschlag (LV-Schätzpreis) für ${l.nr} beträgt ${basis} ${fmtEUR(k)}. ${cs.length > 1 ? `Die geprüften Angebote liegen zwischen ${pctDe(lo)} % und ${pctDe(hi)} %` : `Das geprüfte Angebot liegt bei ${pctDe(lo)} %`} des Schätzpreises (${basis}).`];
  const t = s.project.schwelle;
  if (cs.length > 1 && hi < 100 - t) L.push(`Insgesamt liegen die geprüften Angebote mit mehr als ${pctDe(t)} % Abweichung deutlich unter dem geschätzten Preis.`);
  return L.join('\n');
}

/** Auffallend hohe und niedrige Titel- und Einheitspreise eines Angebots als Absätze für den Vermerk. */
export function preisAuffaelligkeiten(s: State, l: Los, cells: Cell[], c: Cell, erlaeuterung = ''): string[] {
  const ang = angemessenheit(s, l, c, cells);
  const a = auffaelligkeiten(s, l, cells, c);
  const hatSchaetz = Object.keys(s.schaetz ?? {}).length > 0;
  const hatPeers = cells.some((x) => x !== c && x.offer.runde === c.offer.runde && x.complete && !x.excluded);
  const L: string[] = [];
  const name = (oz: string, t: string) => `${oz}${t ? ` „${t}“` : ''}`;
  const peerT = (v: number | null, me: number) => (v ? `; ${me > v ? 'über' : 'unter'} dem Mittel der übrigen Bieter von ${fmtEUR(round2(v))}` : '');
  const peerP = (v: number | null) => (v ? `; Mittel der übrigen Bieter ${fmtEUR(round2(v))}` : '');
  const tHoch = ang.titel.filter((t) => t.pct > 100), tNied = ang.titel.filter((t) => t.pct < 100);
  const pHoch = ang.pos.filter((x) => x.pct > 100).slice(0, 6), pNied = ang.pos.filter((x) => x.pct < 100).slice(0, 6);
  const tz = (t: (typeof tHoch)[number]) => `- Titel ${name(t.oz, t.name)}: ${fmtEUR(t.sum)} netto = ${pctDe(t.pct)} % des geschätzten Titelpreises von ${fmtEUR(t.schaetz)} netto${peerT(t.peer, t.sum)}`;
  const pz = (x: (typeof pHoch)[number]) => `- Pos. ${name(x.oz, x.kurz)}: EP ${fmtEUR(x.ep)} = ${pctDe(x.pct)} % des geschätzten Preises von ${fmtEUR(x.schaetz)}${peerP(x.peer)}`;
  // Vergleich mit den übrigen Bietern für Positionen, die nicht schon gegenüber dem Schätzpreis genannt sind
  const schon = new Set(ang.pos.map((x) => x.oz));
  const gue = a.guenstig.filter((x) => !schon.has(x.oz)).slice(0, 5), hoch = a.hoch.filter((x) => !schon.has(x.oz)).slice(0, 5);
  const titelNied = a.titel.filter((t) => !ang.titel.some((x) => x.oz === t.oz)).slice(0, 4);
  if (tHoch.length) L.push('', 'Deutlich über den geschätzten Preisen liegen die Titelpreise folgender Titel:', ...tHoch.map(tz));
  if (pHoch.length) L.push('', 'Auffallend hohe Einheitspreise:', ...pHoch.map(pz));
  if (hoch.length) L.push('', `Überdurchschnittlich hochpreisig im Vergleich zu den übrigen Bietern: ${listDe(hoch.map((x) => `Pos. ${x.oz} (EP ${fmtEUR(x.ep)}, Mittel ${fmtEUR(round2(x.avg))})`))}.`);
  if (tNied.length) L.push('', 'Deutlich unter den geschätzten Preisen liegen die Titelpreise folgender Titel:', ...tNied.map(tz));
  if (pNied.length) L.push('', 'Auffallend niedrige Einheitspreise:', ...pNied.map(pz));
  if (gue.length || titelNied.length) {
    const platz = c.rankAll === 1 ? 'erste' : c.rankAll === 2 ? 'zweite' : `${c.rankAll}.`;
    L.push('', `Fa. ${c.offer.firma} bietet gegenüber den übrigen Bietern diverse Leistungen mit sehr niedrigen Preisen an, auf Grund derer der ${platz} Platz in der Rangfolge erreicht wird.`);
    if (titelNied.length) L.push(`Es handelt sich hierbei insbesondere um Leistungen unter Titel ${listDe(titelNied.map((t) => name(t.oz, t.name)))}.`);
    if (gue.length) L.push(`Überdurchschnittlich günstig im Vergleich zu den übrigen Bietern: ${listDe(gue.map((x) => `Pos. ${x.oz} (EP ${fmtEUR(x.ep)}, Mittel ${fmtEUR(round2(x.avg))})`))}.`);
  }
  if (erlaeuterung.trim()) L.push(erlaeuterung.trim());
  if (!L.length) {
    if (hatSchaetz || hatPeers) L.push('', `Auffallend hohe oder niedrige Titel- bzw. Einheitspreise wurden ${hatSchaetz ? `gegenüber den geschätzten Preisen${hatPeers ? ' und ' : ''}` : ''}${hatPeers ? 'gegenüber den übrigen Angeboten' : ''} nicht festgestellt (Schwelle ${pctDe(s.project.abweichung)} %).`);
    else L.push('', 'Eine Prüfung der Einzelpreise auf auffallend hohe oder niedrige Preise war mangels LV-Schätzpreisen und weiterer Angebote nicht möglich.');
  }
  return L;
}

/**
 * Engere Wahl eines Loses: Festlegung (z. B. Abstimmung mit der Vergabestelle) und je nicht einzeln geprüftem Angebot der Grund.
 * Ohne Eingabe wird der Grund aus den Preisen formuliert; liegt ein übergangenes Angebot preislich vor einem geprüften, bleibt er offen.
 */
export function engereText(s: State, l: Los, cells: Cell[], mitLos: boolean): string[] {
  const { take, ranked } = engereWahl(s, cells);
  const raus = ranked.filter((c) => !take.includes(c));
  if (!raus.length) return [];
  const notiz = s.engereNotiz?.[l.id]?.trim();
  const L: string[] = ['', ...(mitLos ? [`${l.nr}:`] : [])];
  if (notiz) L.push(/[.!?]$/.test(notiz) ? notiz : `${notiz}.`);
  L.push(`In die engere Wahl ${take.length > 1 ? 'kommen die Angebote' : 'kommt das Angebot'} Nr. ${listDe(take.map((c) => c.offer.nr).sort((a, b) => a - b).map(String))}.`);
  for (const c of raus) L.push(nichtGewertetText(s, c, take));
  return L;
}

/** Satz zu einem Angebot, das nicht in die engere Wahl kommt: Grund von Hand, sonst Abstand zu den geprüften Angeboten und zum Kostenvoranschlag. */
export function nichtGewertetText(s: State, c: Cell, take: Cell[]): string {
  const wer = `Das Angebot Nr. ${c.offer.nr} der Fa. ${c.offer.firma}`;
  const grund = getBew(s, c.offer.id, c.los.id).nichtGewertet.trim();
  if (grund) return `${wer} wird nicht weiter gewertet: ${/[.!?]$/.test(grund) ? grund : `${grund}.`}`;
  const auto = nichtGewertetAuto(s, c, take);
  return auto ? `${wer} ${auto}` : `${wer} wird nicht weiter gewertet. [Begründung angeben]`;
}

/** Automatische Begründung (ohne Subjekt) oder '' , wenn das Angebot nicht teurer ist als alle geprüften. */
export function nichtGewertetAuto(s: State, c: Cell, take: Cell[]): string {
  const ref = take.filter((x) => x.gross != null && x.gross > 0);
  if (c.gross == null || !ref.length || ref.some((x) => x.gross! >= c.gross!)) return '';
  const pcts = ref.map((x) => (c.gross! / x.gross! - 1) * 100);
  const lo = Math.min(...pcts), hi = Math.max(...pcts);
  const spanne = ref.length > 1 && Math.round(lo) !== Math.round(hi) ? `ca. ${fmtNum(lo, 0)} % bis ${fmtNum(hi, 0)} %` : `ca. ${fmtNum(hi, 0)} %`;
  const wen = ref.length > 1 ? `den Angeboten Nr. ${listDe(ref.map((x) => String(x.offer.nr)))}` : `dem Angebot Nr. ${ref[0].offer.nr}`;
  const ks = c.dKosten != null && c.dKosten > 0.5 ? ` und ca. ${fmtNum(c.dKosten, 0)} % über dem Kostenvoranschlag` : '';
  return `liegt mit brutto ${fmtEUR(c.gross)} ${spanne} über ${wen}${ks}. Es kommt für den Zuschlag nicht in Betracht und wird aus der weiteren Wertung genommen.`;
}

const ord = ['günstigste', 'zweitgünstigste', 'drittgünstigste', 'viertgünstigste', 'fünftgünstigste'];

/** Bewertungstext für ein Angebot (Abschnitt 4.5.x / Nachverhandlung). */
export function bewText(s: State, l: Los, cells: Cell[], c: Cell, nv = false): string {
  const b = getBew(s, c.offer.id, l.id);
  const o = c.offer;
  const rk = c.rankAll ?? 1;
  const name = `Fa. ${o.firma}`;
  const L: string[] = [];
  const same = `ist nach rechnerischer, fachlich-technischer und wirtschaftlicher Prüfung das ${ord[rk - 1] ?? `${rk}.-günstigste`} Angebot.`;
  L.push(`Das Angebot der ${name} ${same}`);
  if (b.ausschluss.trim()) {
    if (b.qualifikation) L.push(b.qualifikation);
    L.push(`Aufgrund ${b.ausschluss.trim().replace(/\.$/, '')} wurde ${name} durch die ${s.project.vergabestelle || 'Vergabestelle'} ausgeschlossen.`);
    L.push('', 'Das Angebot wird nachfolgend nicht weiter durch Unterzeichner geprüft und gewertet.');
    return L.join('\n');
  }
  if (nv) {
    const prev = cells.find((x) => x.offer.runde < o.runde && x.offer.firma.toLowerCase().replace(/\W/g, '') === o.firma.toLowerCase().replace(/\W/g, ''));
    if (prev) {
      const changed = Object.keys(o.prices).filter((k) => {
        const a = o.prices[k]?.ep, p = prev.offer.prices[k]?.ep;
        return a != null && p != null && Math.abs(a - p) > 0.005 && s.lv.some((x) => x.oz.replace(/\./g, '') === k && (!l.oz || x.oz.startsWith(l.oz + '.')));
      }).map((k) => s.lv.find((x) => x.oz.replace(/\./g, '') === k)!.oz);
      if (changed.length) L.push(`Der Einheitspreis für Position ${listDe(changed)} wurde neu angeboten, alle weiteren Einheitspreise wurden durch den Bieter bestätigt.`);
      else L.push('Alle Einheitspreise wurden durch den Bieter bestätigt.');
    }
  } else {
    // Angemessenheit der Preise: Lage zum Kostenvoranschlag, auffallend hohe und niedrige Titel- und Einheitspreise
    // (gegenüber LV-Schätzpreis und den übrigen Angeboten) – jedes einzeln geprüfte Angebot erhält dazu eine Aussage
    if (c.dKosten != null && Math.abs(c.dKosten) >= 0.005) L.push('', `Das Angebot liegt ca. ${pctDe(Math.abs(c.dKosten))} % ${c.dKosten < 0 ? 'unter' : 'über'} dem Kostenvoranschlag.`);
    L.push(...preisAuffaelligkeiten(s, l, cells, c, b.erlaeuterung));
    const km = kmFuerVermerk(s, o, b);
    if (km) L.push(`Durch die Entfernung zur Baustelle (ca. ${km} km) fallen für o.g. Fachfirma zusätzliche Fahrt- und Betriebskosten an, welche bei der Kalkulation der Einheitspreise berücksichtigt wurden.`);
    if (b.auskoemm) L.push('Durch Unterzeichner wurde eine Auskömmlichkeitserklärung empfohlen.');
    if (b.aufklaerung === 'angemessen') L.push(`Der Preis wurde aufgeklärt und als angemessen bewertet${b.aufklaerungNotiz ? ` (${b.aufklaerungNotiz})` : ''}.`);
    else if (b.aufklaerung === '' && c.flags.some((f) => f.text.includes('Aufklärung prüfen'))) L.push(`Der Angebotspreis ist auffallend niedrig; eine Aufklärung beim Bieter ist angezeigt. [Ergebnis der Aufklärung ergänzen]`);
    if (b.qualifikation.trim()) L.push('', 'Fachliche Auswertung:', b.qualifikation.trim());
  }
  if (b.zusatz.trim()) L.push('', b.zusatz.trim());
  L.push('', `Mit einer Gesamtsumme von brutto ${fmtEUR(c.gross)} unterbreitet ${name} in rechnerischer, fachlich-technischer und wirtschaftlicher Hinsicht das ${ord[rk - 1] ?? `${rk}.-günstigste`} Angebot${nv ? '' : ` für ${l.nr}`}.`);
  return L.join('\n').replace(/\n{3,}/g, '\n\n');
}
void fmtDateTime;
