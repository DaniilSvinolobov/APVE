import { Fragment, useMemo, useState, type ClipboardEvent } from 'react';
import type { State } from '../domain/types';
import { computeLos, losPositions, lvFremd, mindestEuro, positionsVergleich, schaetzSumme, titelKey, zkey, zusatzWert } from '../domain/calc';
import { fmtEur, fmtNum, fmtPct, parseNum, round2 } from '../domain/fmt';
import { Chip, FlagList, Icon, NumInput, Seg, Tabs } from '../components/ui';
import { downloadCsv } from '../storage/exportCsv';

type Up = (fn: (d: State) => void) => void;
type RK = 'avg' | 'min' | 'sch';
type BK = 'min' | 'sch';

export function StepPreisspiegel({ s, up }: { s: State; up: Up }) {
  const [losId, setLosId] = useState(s.lose[0]?.id ?? '');
  const los = s.lose.find((l) => l.id === losId) ?? s.lose[0];
  const [runde, setRunde] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyAuff, setOnlyAuff] = useState(false);
  const [basis, setBasis] = useState<'min' | 'schaetz' | 'beide'>('min');
  const [pdfBusy, setPdfBusy] = useState(false);

  const cellsAll = useMemo(() => (los ? computeLos(s, los) : []), [s, los]);
  if (!los) return <section className="card"><h2>Preisspiegel</h2><p className="muted">Bitte zuerst Lose anlegen bzw. das LV laden (Schritt 2).</p></section>;
  const runden = [...new Set(cellsAll.map((c) => c.offer.runde))].sort();
  const rd = runde != null && runden.includes(runde as 1 | 2 | 3) ? runde : runden[runden.length - 1] ?? 1;
  const cells = cellsAll.filter((c) => c.offer.runde === rd);
  const pos = losPositions(s, los);
  const hasLv = pos.length > 0;

  const groups = new Map<string, typeof pos>();
  for (const p of pos) { const k = titelKey(p.oz); groups.set(k, [...(groups.get(k) ?? []), p]); }

  const epOf = (c: (typeof cells)[number], oz: string) => c.offer.prices[zkey(oz)]?.ep ?? null;
  const peerStats = (oz: string) => {
    const v = cells.filter((c) => c.complete && !c.excluded).map((c) => epOf(c, oz)).filter((x): x is number => x != null && x > 0);
    return { low: v.length > 1 ? Math.min(...v) : null, high: v.length > 1 ? Math.max(...v) : null, n: v.length };
  };
  // auffällige Positionen nach derselben Regel wie Wertung, Vermerk und Rückfrage
  const minEuro = mindestEuro(cells, rd);
  const auff = new Map(cells.map((c) => [c.offer.id, new Set(positionsVergleich(s, los, cells, c, minEuro).filter((v) => v.status === 'auffaellig').map((v) => v.oz))]));
  const isOut = (c: (typeof cells)[number], oz: string) => !!auff.get(c.offer.id)?.has(oz);
  const titelSum = (c: (typeof cells)[number], ps: typeof pos) => round2(ps.filter((p) => !p.bedarf).reduce((a, p) => a + (p.menge ?? 0) * (epOf(c, p.oz) ?? 0), 0));

  /* Vergleichswerte: Mittelwert und Günstigst über die gewerteten Bieter, LV-Schätzpreis = eigenes LV (GAEB 82 oder Handeingabe) */
  const valid = cells.filter((c) => c.complete && !c.excluded);
  const hasSch = Object.keys(s.schaetz ?? {}).length > 0;
  const bases: BK[] = basis === 'beide' ? ['min', 'sch'] : basis === 'schaetz' ? ['sch'] : ['min'];
  const mw = 1 + s.project.mwst / 100;
  const avgOf = (v: number[]) => (v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null);
  const minOf = (v: number[]) => (v.length ? Math.min(...v) : null);
  const refEp = (oz: string) => {
    const v = valid.map((c) => epOf(c, oz)).filter((x): x is number => x != null && x > 0);
    return { avg: avgOf(v), min: minOf(v), sch: s.schaetz?.[zkey(oz)] ?? null };
  };
  const refSum = (sums: number[], sch: number | null) => { const v = sums.filter((x) => x > 0); return { avg: avgOf(v), min: minOf(v), sch }; };
  const gpOf = (p: (typeof pos)[number], ep: number | null) => (ep == null ? null : round2((p.menge ?? 0) * ep));
  const pct = (v: number | null, ref: number | null) => (v == null || ref == null || ref <= 0 || v <= 0 ? null : (v / ref - 1) * 100);
  /** Abweichung zum Günstigsten und/oder zum LV-Schätzpreis (je nach Auswahl); bei beiden mit Kürzel G/LV. */
  const Pct = ({ v, to, skip }: { v: number | null; to: Partial<Record<BK, number | null>>; skip?: RK }) => {
    const items = bases.filter((k) => k !== skip).map((k) => [k, pct(v, to[k] ?? null)] as const).filter((x): x is readonly [BK, number] => x[1] != null && Math.abs(x[1]) >= 0.05);
    return items.length ? <>{items.map(([k, d]) => <small key={k} className="pct">{bases.length > 1 ? (k === 'min' ? 'G ' : 'LV ') : ''}{fmtPct(d)}</small>)}</> : null;
  };
  const refHead: [RK, string][] = [['avg', 'Ø Bieter'], ['min', 'Günstigst'], ['sch', 'LV-Schätzpreis']];
  const bLabel: Record<BK, string> = { min: 'zum Günstigsten', sch: 'zum LV-Schätzpreis' };

  const refTotNum = (k: RK, f: (c: (typeof cells)[number]) => number | null): number | null => {
    if (k === 'sch') { const n = schaetzSumme(s, los); return n; }
    const v = valid.map(f).filter((x): x is number => x != null && x > 0);
    return k === 'avg' ? avgOf(v) : minOf(v);
  };
  const refTot = (k: RK, f: (c: (typeof cells)[number]) => number | null) => { const n = refTotNum(k, f); return n == null ? null : fmtNum(n); };

  const onPaste = (e: ClipboardEvent<HTMLElement>, oz0: string, c0: number, visible: string[]) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const rows = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((r) => r.split('\t'));
    const r0 = visible.indexOf(oz0);
    up((d) => rows.forEach((row, i) => { const oz = visible[r0 + i]; if (oz) row.forEach((cell, j) => { const o = cells[c0 + j]?.offer; if (o) { const dd = d.offers.find((x) => x.id === o.id)!; dd.prices[zkey(oz)] = { ep: parseNum(cell), gp: null }; } }); }));
  };

  const setEp = (offerId: string, oz: string, v: number | null) => up((d) => { const o = d.offers.find((x) => x.id === offerId)!; o.prices[zkey(oz)] = { ep: v, gp: null }; });
  const setSch = (oz: string, v: number | null) => up((d) => { d.schaetz = d.schaetz ?? {}; if (v == null) delete d.schaetz[zkey(oz)]; else d.schaetz[zkey(oz)] = v; });
  const totNet = { min: refTotNum('min', (c) => c.net), sch: refTotNum('sch', (c) => c.net) };
  const nlBetrag = (c: (typeof cells)[number]) => (c.sumNet != null && c.net != null ? round2(c.sumNet - c.net) : null);
  const skontoOf = (c: (typeof cells)[number]) => (c.offer.skonto && c.gross != null ? round2((c.gross * c.offer.skonto) / 100) : null);
  const hasSkonto = cells.some((c) => c.offer.skonto);
  const schFehlt = pos.filter((p) => !p.bedarf && s.schaetz?.[zkey(p.oz)] == null).length;
  const exportCsv = () => {
    const head = ['Pos.', 'Leistung', 'Menge', 'Einheit', ...cells.flatMap((c) => [`Nr.${c.offer.nr} ${c.offer.firma} EP`, `GP`]), ...refHead.flatMap(([, l]) => [`${l} EP`, `${l} GP`])];
    const rows = pos.map((p) => { const r = refEp(p.oz); return [p.oz, p.kurz, p.menge ?? '', p.einheit, ...cells.flatMap((c) => { const ep = epOf(c, p.oz); return [ep ?? '', gpOf(p, ep) ?? '']; }), ...refHead.flatMap(([k]) => [r[k] ?? '', gpOf(p, r[k]) ?? ''])]; });
    for (const r of zList) rows.push([`neu: ${r.oz}`, r.kurz, r.menge ?? '', r.einheit, ...cells.flatMap((c) => { const z = r.per.get(c.offer.id); return z ? [z.ep ?? '', zusatzWert(z)] : ['', '']; }), ...refHead.flatMap(() => ['', ''])]);
    const blank = refHead.flatMap(() => ['', '']);
    const tot = (f: (c: (typeof cells)[number]) => number | null) => refHead.map(([k]) => refTotNum(k, f) ?? '');
    const fill = (vals: (number | string)[]) => refHead.flatMap((_, i) => ['', vals[i] ?? '']);
    const netRef = tot((c) => c.net);
    const pr = (v: number | null) => (v == null ? '' : round2(v));
    rows.push([], ['', 'Summe netto', '', '', ...cells.flatMap((c) => ['', c.sumNet ?? '']), ...fill(tot((c) => c.sumNet))], ['', 'Nachlass %', '', '', ...cells.flatMap((c) => ['', c.nachlass]), ...blank], ['', 'Nachlass €', '', '', ...cells.flatMap((c) => ['', nlBetrag(c) ?? '']), ...blank], ['', 'Gesamt netto', '', '', ...cells.flatMap((c) => ['', c.net ?? '']), ...fill(netRef)], ['', `zzgl. MwSt. (${s.project.mwst} %)`, '', '', ...cells.flatMap((c) => ['', c.net == null ? '' : round2(c.net * (mw - 1))]), ...fill(netRef.map((v) => (v === '' ? v : round2(Number(v) * (mw - 1)))))], ['', 'Gesamt brutto', '', '', ...cells.flatMap((c) => ['', c.gross ?? '']), ...fill(netRef.map((v) => (v === '' ? v : round2(Number(v) * mw))))]);
    for (const k of ['min', 'sch'] as BK[]) rows.push(['', `% ${bLabel[k]}`, '', '', ...cells.flatMap((c) => ['', pr(pct(c.net, totNet[k]))]), ...fill(netRef.map((v) => pr(pct(v === '' ? null : Number(v), totNet[k]))))]);
    if (hasSkonto) rows.push(['', 'Skonto % (informativ)', '', '', ...cells.flatMap((c) => ['', c.offer.skonto ?? '']), ...blank], ['', 'Gesamt brutto abzgl. Skonto (informativ)', '', '', ...cells.flatMap((c) => { const sk = skontoOf(c); return ['', c.gross == null ? '' : round2(c.gross - (sk ?? 0))]; }), ...blank]);
    downloadCsv(`Preisspiegel_${los.nr}_Runde${rd}.csv`, [head, ...rows]);
  };

  /* PDF wird im Browser erzeugt; Modul erst bei Bedarf laden */
  const exportPdf = async () => {
    setPdfBusy(true);
    try { const { downloadPreisspiegelPdf } = await import('../storage/preisspiegelPdf'); await downloadPreisspiegelPdf(s, los, rd, basis); }
    catch (e) { alert(`PDF konnte nicht erstellt werden: ${e instanceof Error ? e.message : e}`); }
    finally { setPdfBusy(false); }
  };

  /* Positionen der Bieter, die im Soll-LV nicht stehen: eine Zeile je Position, gleiche Texte verschiedener Bieter stehen in einer Zeile */
  const normTxt = (t: string) => t.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
  const zRows = new Map<string, { oz: string; kurz: string; einheit: string; menge: number | null; per: Map<string, (typeof cells)[number]['zusatz'][number]> }>();
  for (const c of cells) for (const z of c.zusatz) {
    const k = z.kurz && normTxt(z.kurz) ? `${normTxt(z.kurz)}|${z.einheit}` : `${c.offer.id}|${z.oz}`;
    const row = zRows.get(k) ?? { oz: z.oz, kurz: z.kurz, einheit: z.einheit, menge: z.menge, per: new Map() };
    row.per.set(c.offer.id, z);
    zRows.set(k, row);
  }
  const zList = [...zRows.values()];
  const zSum = (c: (typeof cells)[number]) => round2(c.zusatz.filter((z) => !z.bedarf).reduce((a, z) => a + zusatzWert(z), 0));
  const lvFremdText = lvFremd(s, cells);
  const visibleGroups = [...groups.entries()].filter(([, ps]) => !onlyAuff || ps.some((p) => cells.some((c) => isOut(c, p.oz))));
  const visibleOz = visibleGroups.flatMap(([k, ps]) => (open.has(k) || onlyAuff ? ps.map((p) => p.oz) : []));
  const anyOpen = visibleOz.length > 0 || (zList.length > 0 && hasLv);
  const ncol = hasLv ? 4 : 1;
  const notes: { kind: 'warn' | 'info'; text: string }[] = [];
  if (lvFremdText) notes.push({ kind: 'warn', text: lvFremdText });
  if (cells.some((c) => c.mengeAbw.length)) notes.push({ kind: 'warn', text: 'Mengen im LV weichen von der Bieterdatei ab – betroffene Zellen sind links blau markiert.' });
  if (hasLv && hasSch && schFehlt > 0) notes.push({ kind: 'warn', text: `${schFehlt} Position(en) ohne LV-Schätzpreis – Summe und Abweichung zum LV nur bedingt aussagekräftig.` });
  if (hasLv && !hasSch) notes.push({ kind: 'info', text: 'Keine LV-Schätzpreise geladen – X82 im Schritt „Vergabe“ laden oder EP in der Spalte „LV-Schätzpreis“ eintragen.' });
  if (cells.some((c) => c.zusatz.length)) notes.push({ kind: 'info', text: 'Bieter haben Positionen ergänzt, die nicht im LV stehen – unten unter „Zusätzliche Positionen“ aufgeführt und in den Summen enthalten.' });
  const legend: [string, string][] = [
    ['low', 'günstigster EP'],
    ['high', 'höchster EP'],
    ['out', `auffällig (> ${s.project.abweichung} % neben ${hasSch ? 'dem LV-Schätzpreis, ohne Schätzpreis dem günstigsten EP' : 'dem günstigsten EP'}, Auswirkung ab ${fmtNum(minEuro, 0)} €)`],
    ...(cells.some((c) => c.mengeAbw.length) ? [['mabw', 'Menge laut Bieter weicht vom LV ab'] as [string, string]] : []),
    ...(zList.length ? [['neu', 'neue Position (nicht im LV)'] as [string, string]] : []),
  ];

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div><h2>Preisspiegel</h2><p className="lead">Titel anklicken für Einzelpositionen; Einheitspreise sind direkt korrigierbar.</p></div>
          <div className="row">
            <button className="btn" onClick={exportCsv}><Icon name="download" /> Excel (CSV)</button>
            <button className="btn" onClick={exportPdf} disabled={pdfBusy || cells.length === 0}><Icon name="download" /> {pdfBusy ? 'PDF wird erstellt …' : 'PDF'}</button>
          </div>
        </div>
        <Tabs value={los.id} onChange={setLosId} items={s.lose.map((l) => ({ value: l.id, label: l.nr, sub: l.name }))} />
        {runden.length > 1 && (
          <div className="row" style={{ margin: '14px 0 0' }}>
            <span className="field-label">Runde:</span>
            {runden.map((r) => <button key={r} className={`pill btnpill ${r === rd ? 'on' : ''}`} onClick={() => setRunde(r)}>{r === 1 ? 'Hauptangebote' : `Nachverhandlung${r > 2 ? ' ' + (r - 1) : ''}`} ({cellsAll.filter((c) => c.offer.runde === r).length})</button>)}
          </div>
        )}
        {cells.length === 0 ? <p className="muted" style={{ marginTop: 18 }}>Für {los.nr} liegt in dieser Runde kein Angebot vor.</p> : (
          <>
            <div className="toolbar">
              {hasLv && <div className="row">
                <button className="btn small" onClick={() => setOpen(open.size ? new Set() : new Set(groups.keys()))}><Icon name={open.size ? 'right' : 'down'} /> {open.size ? 'Alle Titel schließen' : 'Alle Titel öffnen'}</button>
                <label className="mini"><input type="checkbox" checked={onlyAuff} onChange={(e) => setOnlyAuff(e.target.checked)} /> nur Titel mit Preisauffälligkeiten</label>
              </div>}
              <div className="row">
                <span className="field-label">Abweichung in % zu</span>
                <Seg small value={basis} onChange={setBasis} options={[{ value: 'min', label: 'Günstigstem' }, { value: 'schaetz', label: 'LV-Schätzpreis' }, { value: 'beide', label: 'beiden' }]} />
              </div>
            </div>
            {notes.length > 0 && <div className={`notes ${notes.some((n) => n.kind === 'warn') ? 'warn' : ''}`}><b>Hinweise zu diesem Los</b><FlagList items={notes} /></div>}
            <div className="scroll big" onPaste={(e) => { const t = e.target as HTMLElement; const oz = t.dataset.oz, c = t.dataset.c; if (oz && c) onPaste(e, oz, Number(c), visibleOz); }}>
              <table className="preis" style={{ minWidth: 440 + refHead.length * 125 + cells.length * 180 }}>
                <thead>
                  <tr>
                    {hasLv ? <><th className="sticky c0 left">Pos.</th><th className="sticky c1 left">Leistung</th><th>Menge</th><th>Einh.</th></> : <th className="left">Position</th>}
                    {hasLv && refHead.map(([k, l]) => <th key={k} colSpan={2} className="bh ref g0"><span className="bnr">{k === 'sch' ? 'eigenes LV' : 'gewertete Bieter'}</span>{l}</th>)}
                    {cells.map((c) => <th key={c.offer.id} colSpan={hasLv ? 2 : 1} className={`bh g0 ${c.excluded ? 'dim' : ''}`}><span className="bnr">Nr. {c.offer.nr}</span>{c.offer.firma}</th>)}
                  </tr>
                  {hasLv && <tr className="sub"><th className="sticky c0" /><th className="sticky c1" /><th /><th />{anyOpen
                    ? <>{refHead.map(([k]) => <Fragment key={k}><th className="ref g0 r">EP €</th><th className="ref r">GP €</th></Fragment>)}{cells.map((c) => <Fragment key={c.offer.id}><th className="g0 r">EP €</th><th className="r">GP €</th></Fragment>)}</>
                    : <>{refHead.map(([k]) => <th key={k} colSpan={2} className="ref g0 r">Titelsumme €</th>)}{cells.map((c) => <th key={c.offer.id} colSpan={2} className="g0 r">Titelsumme €</th>)}</>}</tr>}
                </thead>
                <tbody>
                  {!hasLv && (
                    <tr><td className="left"><b>Angebotssumme (netto, vor Nachlass)</b></td>{cells.map((c) => <td key={c.offer.id}><NumInput value={c.offer.summen[los.id] ?? null} suffix="€" onChange={(v) => up((d) => void (d.offers.find((x) => x.id === c.offer.id)!.summen[los.id] = v))} /></td>)}</tr>
                  )}
                  {visibleGroups.map(([k, ps]) => {
                    const isOpen = open.has(k) || onlyAuff;
                    const sums = cells.map((c) => titelSum(c, ps));
                    const min = Math.min(...sums.filter((x) => x > 0));
                    const vs = sums.filter((x, i) => x > 0 && valid.includes(cells[i]));
                    const max = vs.length > 1 ? Math.max(...vs) : null;
                    const tr = refSum(sums.filter((_, i) => valid.includes(cells[i])), schaetzSumme(s, los, k));
                    return (
                      <Fragment key={k}>
                        <tr className="titel" onClick={() => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; })}>
                          <td className="sticky c0 left"><Icon name={isOpen ? 'down' : 'right'} /> {k}</td>
                          <td className="sticky c1 left"><b>{s.titles[k] || `Titel ${k}`}</b><small className="muted"> · {ps.length} Pos.</small></td><td /><td />
                          {refHead.map(([rk]) => <td key={rk} colSpan={2} className="gp strong ref g0">{tr[rk] != null ? fmtNum(tr[rk]!) : ''}<Pct v={tr[rk]} to={tr} skip={rk} /></td>)}
                          {cells.map((c, i) => <td key={c.offer.id} colSpan={2} className={`gp strong g0 ${sums[i] > 0 && sums[i] === min ? 'low' : sums[i] === max && !c.excluded ? 'high' : ''}`}>{fmtNum(sums[i])}<Pct v={sums[i]} to={tr} /></td>)}
                        </tr>
                        {isOpen && ps.map((p) => {
                          const st = peerStats(p.oz);
                          const abw = cells.map((c) => c.mengeAbw.find((m) => m.oz === p.oz));
                          const rp = refEp(p.oz);
                          const base = { min: gpOf(p, rp.min), sch: gpOf(p, rp.sch) };
                          return (
                            <tr key={p.oz} className={p.bedarf ? 'bedarf' : ''}>
                              <td className="sticky c0 left">{p.oz}</td>
                              <td className="sticky c1 left" title={p.kurz}><span className="kurz">{p.kurz}</span>{p.bedarf && <small className="muted"> (Bedarf)</small>}</td>
                              <td>
                                <NumInput value={p.menge} decimals={p.menge != null && Number.isInteger(p.menge) ? 0 : 3} className={`sm ${p.menge !== p.mengeOrig ? 'chg' : ''}`} label="Menge" onChange={(v) => up((d) => void (d.lv.find((x) => x.oz === p.oz)!.menge = v))} />
                                {p.menge !== p.mengeOrig && <small className="muted block">LV-Original: {p.mengeOrig}</small>}
                              </td>
                              <td>{p.einheit}</td>
                              {refHead.map(([rk]) => <Fragment key={rk}>
                                <td className="ref gp g0">{rk === 'sch'
                                  ? <input className="epin" inputMode="decimal" defaultValue={rp.sch == null ? '' : fmtNum(rp.sch)} key={`sch${p.oz}${rp.sch}`} aria-label={`LV-Schätzpreis ${p.oz}`} onFocus={(e) => e.currentTarget.select()} onBlur={(e) => { const v = parseNum(e.target.value); if (v !== rp.sch) setSch(p.oz, v); }} />
                                  : rp[rk] != null ? fmtNum(rp[rk]!) : ''}</td>
                                <td className="ref gp">{rp[rk] != null ? fmtNum(gpOf(p, rp[rk])!) : ''}<Pct v={gpOf(p, rp[rk])} to={base} skip={rk} /></td>
                              </Fragment>)}
                              {cells.map((c, ci) => {
                                const ep = epOf(c, p.oz);
                                const gp = ep == null ? null : round2((p.menge ?? 0) * ep);
                                const cls = [c.excluded ? 'dim' : '', ep != null && st.low != null && ep === st.low && ep > 0 && !c.excluded ? 'low' : ep != null && st.high != null && ep === st.high && !c.excluded ? 'high' : '', isOut(c, p.oz) ? 'out' : ''].join(' ');
                                return (
                                  <Fragment key={c.offer.id}>
                                    <td className={`g0 ${cls} ${abw[ci] ? 'mabw' : ''}`}>
                                      <input className="epin" data-oz={p.oz} data-c={ci} inputMode="decimal" defaultValue={ep == null ? '' : fmtNum(ep)} key={`${c.offer.id}${p.oz}${ep}`} aria-label={`EP ${p.oz} Nr. ${c.offer.nr}`}
                                        onFocus={(e) => e.currentTarget.select()} onBlur={(e) => { const v = parseNum(e.target.value); if (v !== ep) setEp(c.offer.id, p.oz, v); }} />
                                    </td>
                                    <td className={`gp ${cls}`}>
                                      {gp == null ? '' : fmtNum(gp)}{!c.excluded && <Pct v={gp} to={base} />}
                                      {abw[ci] && <button className="mini-act" title={`Bieter rechnet mit ${abw[ci]!.bieter} ${p.einheit} (LV: ${p.menge ?? '–'})`} onClick={() => up((d) => void (d.lv.find((x) => x.oz === p.oz)!.menge = abw[ci]!.bieter))}>Menge {abw[ci]!.bieter} übernehmen</button>}
                                    </td>
                                  </Fragment>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                  {hasLv && zList.length > 0 && (
                    <>
                      <tr className="titel neu-kopf">
                        <td className="sticky c0 left">neu</td>
                        <td className="sticky c1 left"><b>Zusätzliche Positionen (nicht im LV)</b><small className="muted"> · {zList.length} Pos., in den Summen enthalten</small></td><td /><td />
                        {refHead.map(([rk]) => <td key={rk} colSpan={2} className="ref g0" />)}
                        {cells.map((c) => <td key={c.offer.id} colSpan={2} className="gp strong g0">{c.zusatz.length ? fmtNum(zSum(c)) : ''}</td>)}
                      </tr>
                      {zList.map((r, i) => (
                        <tr key={i} className="neu">
                          <td className="sticky c0 left">{r.oz}</td>
                          <td className="sticky c1 left" title={r.kurz}><span className="kurz">{r.kurz || '(ohne Text in der Bieterdatei)'}</span> <small className="neu-tag">neu</small></td>
                          <td>{r.menge ?? ''}</td>
                          <td>{r.einheit}</td>
                          {refHead.map(([rk]) => <Fragment key={rk}><td className="ref g0" /><td className="ref" /></Fragment>)}
                          {cells.map((c) => { const z = r.per.get(c.offer.id); return <Fragment key={c.offer.id}><td className={`gp g0 ${c.excluded ? 'dim' : ''}`}>{z?.ep != null ? fmtNum(z.ep) : z ? '' : '–'}</td><td className={`gp ${c.excluded ? 'dim' : ''}`}>{z ? fmtNum(zusatzWert(z)) : ''}</td></Fragment>; })}
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
                <tfoot>
                  <FootRow ncol={ncol} hasLv={hasLv} label="Summe netto (ohne Bedarfspositionen)">{hasLv && refHead.map(([rk]) => <td key={rk} colSpan={2} className="gp strong ref g0">{refTot(rk, (c) => c.sumNet) ?? ''}</td>)}{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className="gp strong g0">{fmtNum(c.sumNet ?? 0)}</td>)}</FootRow>
                  <FootRow ncol={ncol} hasLv={hasLv} label="Nachlass ohne Bedingung">{hasLv && refHead.map(([rk]) => <td key={rk} colSpan={2} className="ref g0" />)}{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className="gp g0">{c.nachlass ? <><b>{fmtNum(c.nachlass)} %</b> · −{fmtNum(nlBetrag(c) ?? 0)}</> : <span className="muted">–</span>}</td>)}</FootRow>
                  <tr className="total">
                    <td className={hasLv ? 'sticky c0' : ''} />{hasLv ? <td className="sticky c1 left"><b>Gesamt netto</b></td> : <td className="left"><b>Gesamt netto</b></td>}{hasLv && <><td /><td /></>}
                    {hasLv && refHead.map(([rk]) => <td key={rk} colSpan={2} className="ref g0"><div className="big">{fmtEur(refTotNum(rk, (c) => c.net))}</div></td>)}
                    {cells.map((c) => (
                      <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className={`g0 ${c.excluded ? 'dim' : ''}`}>
                        <div className="big">{fmtEur(c.net)}</div>
                        <div>{c.rank && <Chip kind={c.rank === 1 ? 'ok' : 'info'}>Rang {c.rank}</Chip>} {c.dKosten != null && <Chip kind="info" title="zum Kostenvoranschlag">KV {fmtPct(c.dKosten)}</Chip>}</div>
                      </td>
                    ))}
                  </tr>
                  <FootRow ncol={ncol} hasLv={hasLv} label={`zzgl. MwSt. (${fmtNum(s.project.mwst, 1)} %)`}>{hasLv && refHead.map(([rk]) => { const n = refTotNum(rk, (c) => c.net); return <td key={rk} colSpan={2} className="gp ref g0">{n == null ? '' : fmtNum(round2(n * (mw - 1)))}</td>; })}{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className="gp g0">{c.net == null ? '' : fmtNum(round2(c.net * (mw - 1)))}</td>)}</FootRow>
                  <FootRow ncol={ncol} hasLv={hasLv} label="Gesamt brutto">{hasLv && refHead.map(([rk]) => { const n = refTotNum(rk, (c) => c.net); return <td key={rk} colSpan={2} className="gp strong ref g0">{n == null ? '' : fmtNum(round2(n * mw))}</td>; })}{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className="gp strong g0">{c.gross == null ? '' : fmtNum(c.gross)}</td>)}</FootRow>
                  {(['min', 'sch'] as BK[]).filter((k) => k === 'min' || hasSch).map((k) => (
                    <FootRow key={k} ncol={ncol} hasLv={hasLv} label={`Abweichung ${bLabel[k]}`}>{hasLv && refHead.map(([rk]) => { const d = rk === k ? null : pct(refTotNum(rk, (c) => c.net), totNet[k]); return <td key={rk} colSpan={2} className="gp ref g0">{rk === k ? 'Basis' : d == null ? '' : fmtPct(d)}</td>; })}{cells.map((c) => { const d = pct(c.net, totNet[k]); return <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className={`gp strong g0 ${c.excluded ? 'dim' : ''}`}>{d == null ? '–' : Math.abs(d) < 0.05 ? '±0,0 %' : fmtPct(d)}</td>; })}</FootRow>
                  ))}
                  {hasSkonto && <FootRow ncol={ncol} hasLv={hasLv} label="Skonto (informativ, nicht gewertet)">{hasLv && refHead.map(([rk]) => <td key={rk} colSpan={2} className="ref g0" />)}{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className="gp g0">{c.offer.skonto ? <>{fmtNum(c.offer.skonto)} % · ({fmtNum(skontoOf(c) ?? 0)})</> : <span className="muted">–</span>}</td>)}</FootRow>}
                  {hasSkonto && <FootRow ncol={ncol} hasLv={hasLv} label="Gesamt brutto abzgl. Skonto (informativ)">{hasLv && refHead.map(([rk]) => <td key={rk} colSpan={2} className="ref g0" />)}{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className="gp g0">{c.gross == null ? '' : `(${fmtNum(round2(c.gross - (skontoOf(c) ?? 0)))})`}</td>)}</FootRow>}
                  <FootRow ncol={ncol} hasLv={hasLv} label="Hinweise">{hasLv && refHead.map(([rk]) => <td key={rk} colSpan={2} className="ref g0" />)}{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className={`flags g0 ${c.excluded ? 'dim' : ''}`}>{c.flags.length ? <FlagList items={c.flags} /> : <span className="muted">keine</span>}</td>)}</FootRow>
                </tfoot>
              </table>
            </div>
            <div className="legend">
              <b>Legende</b>
              {legend.map(([k, t]) => <span key={k}><i className={`sw ${k}`} /> {t}</span>)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function FootRow({ label, children, hasLv, ncol }: { label: string; children: React.ReactNode; hasLv: boolean; ncol: number }) {
  return (
    <tr className="footrow">
      {hasLv ? <><td className="sticky c0" /><td className="sticky c1 left">{label}</td><td /><td /></> : <td className="left" colSpan={ncol}>{label}</td>}
      {children}
    </tr>
  );
}
