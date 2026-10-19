import type { Los, State } from '../domain/types';
import { auffaelligkeiten, computeLos, engereWahl, finalRound, getBew, kostenOf, offerBrutto, pruefStatus, zuschlagCell, type Cell } from '../domain/calc';
import { PSTATUS } from '../domain/types';
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
    preisspiegel1: `Preisspiegel Angebote ${range(r1)}`,
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
  const vergabe = /VOB/.test(p.verfahren);
  const hasR2 = s.offers.some((o) => o.runde > hr);

  /* Kopf */
  B.push({
    t: 'meta',
    lines: [
      { v: p.titel || 'Maßnahme', bold: true },
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
  B.push(T('rechnerisch', `${errs.length ? `Bei folgenden Angeboten wurden Rechenfehler festgestellt: ${errs.map((c) => `Angebot Nr. ${c.offer.nr} (${c.los.nr})`).join(', ')}.` : 'Alle Angebote wurden nachgerechnet, es wurden keine Fehler festgestellt.'}\n${aNr('preisspiegel1')}`));

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
    nichtEinzeln.length ? `${nichtEinzeln.length > 1 ? 'Die Angebote' : 'Das Angebot'} Nr. ${listDe(nichtEinzeln)} ${nichtEinzeln.length > 1 ? 'kommen' : 'kommt'} aufgrund des Preisrangs für den Zuschlag nicht in Betracht und ${nichtEinzeln.length > 1 ? 'werden' : 'wird'} nicht einzeln bewertet.` : '',
    '',
    ...s.offers.filter((o) => !o.status).flatMap((o) => {
      const ps = pruefStatus(s, o);
      const out: string[] = [];
      if (ps.nach.length) {
        const ds = [...new Set(ps.nach.map((x) => x.d).filter(Boolean))];
        out.push(`Für das Angebot Nr. ${o.nr} ${ps.nach.length > 1 ? 'fehlten die Unterlagen' : 'fehlte die Unterlage'} ${listDe(ps.nach.map((x) => x.label))}; ${ps.nach.length > 1 ? 'diese wurden' : 'diese wurde'} nachträglich durch die ${p.vergabestelle || 'Vergabestelle'} bei Fa. ${o.firma} angefordert${ds.length === 1 ? ` und am ${fmtDate(ds[0])} nachgereicht` : ''}.`);
      } else if (!Object.keys(o.pruef ?? {}).length && o.nachforderung.length) out.push(`Für das Angebot Nr. ${o.nr} fehlten Unterlagen (${o.nachforderung.join(', ')}); diese wurden nachträglich durch die ${p.vergabestelle || 'Vergabestelle'} bei Fa. ${o.firma} angefordert.`);
      if (o.preisQuelle === 'pdf') out.push(`Das Angebot Nr. ${o.nr} (Fa. ${o.firma}) enthält die Preise nur im Leistungsverzeichnis als PDF; die beigefügte GAEB-Datei ist nicht bepreist. Die Preise wurden aus dem PDF übernommen und rechnerisch geprüft.`);
      if (ps.fehlt.length) out.push(`Beim Angebot Nr. ${o.nr} fehlen weiterhin: ${listDe(ps.fehlt)}.`);
      return out;
    }),
    ...(sep.length ? ['', `Die Angebote für ${listDe(sep.map((l) => l.nr))} werden durch die ${p.auftraggeber || 'Auftraggeberin'} technisch und wirtschaftlich geprüft und nachfolgend nicht weiter im Vergabevermerk aufgeführt.`] : []),
  ].join('\n').replace(/\n{3,}/g, '\n\n')));

  /* 4.5 ff. je Los */
  let n = 5;
  for (const l of vLose) {
    const cells = allCells.get(l.id) ?? [];
    if (!cells.length) continue;
    const hrl = Math.min(...cells.map((c) => c.offer.runde));
    const first = cells.filter((c) => c.offer.runde === hrl);
    const { take, ranked } = engereWahl(s, cells);
    const eng = ranked.length > take.length;
    B.push({ t: 'h', n: `4.${n}`, text: `Technische und wirtschaftliche Prüfung der Angebote ${l.nr}${eng ? ' (Engere Wahl)' : ''}`, lvl: 2 });
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
  const bud = p.budgetBrutto;
  const diff = bud ? (sum / bud - 1) * 100 : null;
  B.push(T('budget', [
    `Im Rahmen des Bauvorhabens „${p.titel || '…'}“ wurden für ${listDe(s.lose.filter((l) => l.imBudget).map((l) => l.nr))} durch Unterzeichner Baukosten in Höhe von brutto ${bud ? fmtEUR(bud) : '[Gesamtbudget angeben]'} ermittelt.`,
    bw.length ? `${listDe(bw.map((w) => `das Angebot des günstigsten Bieters für ${w.l.nr}, Fa. ${w.c.offer.firma} vom ${fmtDate(w.c.offer.datum)}`)).replace(/^d/, 'D')} ${bw.length > 1 ? 'unterschreiten' : 'unterschreitet'} diese Kostenermittlung${diff != null && diff > 0 ? ' nicht' : diff != null && diff < -10 ? ' deutlich' : ''} (Gesamt, brutto: ${fmtEUR(sum)}).`.replace('unterschreiten diese Kostenermittlung nicht', 'überschreiten diese Kostenermittlung').replace('unterschreitet diese Kostenermittlung nicht', 'überschreitet diese Kostenermittlung') : '',
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
    if (b.qualifikation) L.push(b.qualifikation);
    const km = kmFuerVermerk(s, o, b);
    if (km) L.push(`Durch die Entfernung zur Baustelle (ca. ${km} km) fallen für o.g. Fachfirma zusätzliche Fahrt- und Betriebskosten an, welche bei der Kalkulation der Einheitspreise berücksichtigt wurden.`);
    const a = auffaelligkeiten(s, l, cells, c);
    const platz = c.rankAll === 1 ? 'erste' : c.rankAll === 2 ? 'zweite' : `${c.rankAll}.`;
    if (a.guenstig.length || a.titel.length) {
      L.push('', `${name} bietet diverse Leistungen mit sehr niedrigen Einheitspreisen an, auf Grund derer der ${platz} Platz in der Rangfolge erreicht wird.`);
      if (b.erlaeuterung) L.push(b.erlaeuterung);
      else if (a.titel.length) L.push(`Es handelt sich hierbei insbesondere um Leistungen unter Titel ${listDe(a.titel.slice(0, 4).map((t) => t.oz))}.`);
      if (a.guenstig.length) L.push(`Die Einheitspreise unter Pos. ${listDe(a.guenstig.slice(0, 5).map((x) => x.oz))} wurden überdurchschnittlich günstig angeboten.`);
      if (b.auskoemm) L.push('Durch Unterzeichner wurde eine Auskömmlichkeitserklärung empfohlen.');
    } else if (b.erlaeuterung) L.push('', b.erlaeuterung);
    if (a.hoch.length) L.push('', `Die Einheitspreise unter Position ${listDe(a.hoch.slice(0, 3).map((x) => x.oz))} wurden überdurchschnittlich hochpreisig angeboten.`);
    if (b.aufklaerung === 'angemessen') L.push(`Der Preis wurde aufgeklärt und als angemessen bewertet${b.aufklaerungNotiz ? ` (${b.aufklaerungNotiz})` : ''}.`);
  }
  if (b.zusatz.trim()) L.push('', b.zusatz.trim());
  L.push('', `Mit einer Gesamtsumme von brutto ${fmtEUR(c.gross)} unterbreitet ${name} in rechnerischer, fachlich-technischer und wirtschaftlicher Hinsicht das ${ord[rk - 1] ?? `${rk}.-günstigste`} Angebot${nv ? '' : ` für ${l.nr}`}.`);
  return L.join('\n').replace(/\n{3,}/g, '\n\n');
}
void fmtDateTime;
