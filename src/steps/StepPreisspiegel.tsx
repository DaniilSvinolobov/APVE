import { Fragment, useMemo, useState, type ClipboardEvent } from 'react';
import type { State } from '../domain/types';
import { computeLos, losPositions, zkey } from '../domain/calc';
import { fmtEur, fmtNum, fmtPct, parseNum, round2 } from '../domain/fmt';
import { Chip, Icon, NumInput, Tabs } from '../components/ui';
import { downloadCsv } from '../storage/exportCsv';

type Up = (fn: (d: State) => void) => void;

export function StepPreisspiegel({ s, up }: { s: State; up: Up }) {
  const [losId, setLosId] = useState(s.lose[0]?.id ?? '');
  const los = s.lose.find((l) => l.id === losId) ?? s.lose[0];
  const [runde, setRunde] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyAuff, setOnlyAuff] = useState(false);

  const cellsAll = useMemo(() => (los ? computeLos(s, los) : []), [s, los]);
  if (!los) return <section className="card"><h2>Preisspiegel</h2><p className="muted">Bitte zuerst Lose anlegen bzw. das LV laden (Schritt 2).</p></section>;
  const runden = [...new Set(cellsAll.map((c) => c.offer.runde))].sort();
  const rd = runde != null && runden.includes(runde as 1 | 2 | 3) ? runde : runden[runden.length - 1] ?? 1;
  const cells = cellsAll.filter((c) => c.offer.runde === rd);
  const pos = losPositions(s, los);
  const hasLv = pos.length > 0;
  const th = s.project.abweichung / 100;

  const groups = new Map<string, typeof pos>();
  for (const p of pos) { const k = p.oz.split('.').slice(0, 2).join('.'); groups.set(k, [...(groups.get(k) ?? []), p]); }

  const epOf = (c: (typeof cells)[number], oz: string) => c.offer.prices[zkey(oz)]?.ep ?? null;
  const peerStats = (oz: string) => {
    const v = cells.filter((c) => c.complete && !c.excluded).map((c) => epOf(c, oz)).filter((x): x is number => x != null && x > 0);
    return { low: v.length > 1 ? Math.min(...v) : null, n: v.length };
  };
  const isOut = (c: (typeof cells)[number], oz: string) => {
    const me = epOf(c, oz);
    const others = cells.filter((x) => x !== c && x.complete && !x.excluded).map((x) => epOf(x, oz)).filter((x): x is number => x != null && x > 0);
    if (me == null || me <= 0 || others.length < 2) return false;
    const avg = others.reduce((a, b) => a + b, 0) / others.length;
    return Math.abs(me / avg - 1) > th;
  };
  const titelSum = (c: (typeof cells)[number], ps: typeof pos) => round2(ps.filter((p) => !p.bedarf).reduce((a, p) => a + (p.menge ?? 0) * (epOf(c, p.oz) ?? 0), 0));

  const onPaste = (e: ClipboardEvent<HTMLElement>, oz0: string, c0: number, visible: string[]) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const rows = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((r) => r.split('\t'));
    const r0 = visible.indexOf(oz0);
    up((d) => rows.forEach((row, i) => { const oz = visible[r0 + i]; if (oz) row.forEach((cell, j) => { const o = cells[c0 + j]?.offer; if (o) { const dd = d.offers.find((x) => x.id === o.id)!; dd.prices[zkey(oz)] = { ep: parseNum(cell), gp: null }; } }); }));
  };

  const setEp = (offerId: string, oz: string, v: number | null) => up((d) => { const o = d.offers.find((x) => x.id === offerId)!; o.prices[zkey(oz)] = { ep: v, gp: null }; });
  const exportCsv = () => {
    const head = ['Pos.', 'Leistung', 'Menge', 'Einheit', ...cells.flatMap((c) => [`Nr.${c.offer.nr} ${c.offer.firma} EP`, `GP`])];
    const rows = pos.map((p) => [p.oz, p.kurz, p.menge ?? '', p.einheit, ...cells.flatMap((c) => { const ep = epOf(c, p.oz); return [ep ?? '', ep == null ? '' : round2((p.menge ?? 0) * ep)]; })]);
    rows.push([], ['', 'Summe netto', '', '', ...cells.flatMap((c) => ['', c.sumNet ?? ''])], ['', 'Nachlass %', '', '', ...cells.flatMap((c) => ['', c.nachlass])], ['', 'Angebotssumme netto', '', '', ...cells.flatMap((c) => ['', c.net ?? ''])], ['', 'Angebotssumme brutto', '', '', ...cells.flatMap((c) => ['', c.gross ?? ''])]);
    downloadCsv(`Preisspiegel_${los.nr}_Runde${rd}.csv`, [head, ...rows]);
  };

  const visibleGroups = [...groups.entries()].filter(([, ps]) => !onlyAuff || ps.some((p) => cells.some((c) => isOut(c, p.oz))));
  const visibleOz = visibleGroups.flatMap(([k, ps]) => (open.has(k) || onlyAuff ? ps.map((p) => p.oz) : []));
  const ncol = hasLv ? 4 : 1;

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div><h2>Preisspiegel</h2><p className="lead">Automatisch aus LV und Bieterdateien erstellt. Titel anklicken, um Einzelpositionen zu sehen. Einheitspreise lassen sich direkt korrigieren.</p></div>
          <div className="row">
            <button className="btn" onClick={exportCsv}><Icon name="download" /> Excel (CSV)</button>
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
            <div className="row" style={{ margin: '14px 0' }}>
              {hasLv && <><button className="btn small" onClick={() => setOpen(new Set(groups.keys()))}>Alle Titel öffnen</button><button className="btn small" onClick={() => setOpen(new Set())}>Alle schließen</button>
              <label className="mini"><input type="checkbox" checked={onlyAuff} onChange={(e) => setOnlyAuff(e.target.checked)} /> nur Titel mit Preisauffälligkeiten</label></>}
              {cells.some((c) => c.mengeAbw.length) && <Chip kind="warn">Mengen im LV weichen von der Bieterdatei ab – siehe markierte Positionen</Chip>}
            </div>
            <div className="scroll big" onPaste={(e) => { const t = e.target as HTMLElement; const oz = t.dataset.oz, c = t.dataset.c; if (oz && c) onPaste(e, oz, Number(c), visibleOz); }}>
              <table className="preis" style={{ minWidth: 560 + cells.length * 250 }}>
                <thead>
                  <tr>
                    {hasLv ? <><th className="sticky c0 left">Pos.</th><th className="sticky c1 left">Leistung</th><th>Menge</th><th>Einh.</th></> : <th className="left">Position</th>}
                    {cells.map((c) => <th key={c.offer.id} colSpan={hasLv ? 2 : 1} className={`bh ${c.excluded ? 'dim' : ''}`}>Nr. {c.offer.nr}<small className="block muted">{c.offer.firma}</small></th>)}
                  </tr>
                  {hasLv && <tr className="sub"><th className="sticky c0" /><th className="sticky c1" /><th /><th />{cells.map((c) => <Fragment key={c.offer.id}><th>EP €</th><th>GP €</th></Fragment>)}</tr>}
                </thead>
                <tbody>
                  {!hasLv && (
                    <tr><td className="left"><b>Angebotssumme (netto, vor Nachlass)</b></td>{cells.map((c) => <td key={c.offer.id}><NumInput value={c.offer.summen[los.id] ?? null} suffix="€" onChange={(v) => up((d) => void (d.offers.find((x) => x.id === c.offer.id)!.summen[los.id] = v))} /></td>)}</tr>
                  )}
                  {visibleGroups.map(([k, ps]) => {
                    const isOpen = open.has(k) || onlyAuff;
                    const sums = cells.map((c) => titelSum(c, ps));
                    const min = Math.min(...sums.filter((x) => x > 0));
                    return (
                      <Fragment key={k}>
                        <tr className="titel" onClick={() => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; })}>
                          <td className="sticky c0 left"><Icon name={isOpen ? 'down' : 'right'} /> {k}</td>
                          <td className="sticky c1 left"><b>{s.titles[k] || `Titel ${k}`}</b><small className="muted"> · {ps.length} Pos.</small></td><td /><td />
                          {cells.map((c, i) => <Fragment key={c.offer.id}><td /><td className={`gp strong ${sums[i] > 0 && sums[i] === min ? 'low' : ''}`}>{fmtNum(sums[i])}</td></Fragment>)}
                        </tr>
                        {isOpen && ps.map((p) => {
                          const st = peerStats(p.oz);
                          const abw = cells.map((c) => c.mengeAbw.find((m) => m.oz === p.oz));
                          return (
                            <tr key={p.oz} className={p.bedarf ? 'bedarf' : ''}>
                              <td className="sticky c0 left">{p.oz}</td>
                              <td className="sticky c1 left" title={p.kurz}><span className="kurz">{p.kurz}</span>{p.bedarf && <small className="muted"> (Bedarf)</small>}</td>
                              <td>
                                <NumInput value={p.menge} decimals={p.menge != null && Number.isInteger(p.menge) ? 0 : 3} className={`sm ${p.menge !== p.mengeOrig ? 'chg' : ''}`} label="Menge" onChange={(v) => up((d) => void (d.lv.find((x) => x.oz === p.oz)!.menge = v))} />
                                {p.menge !== p.mengeOrig && <small className="muted block">LV-Original: {p.mengeOrig}</small>}
                              </td>
                              <td>{p.einheit}</td>
                              {cells.map((c, ci) => {
                                const ep = epOf(c, p.oz);
                                const gp = ep == null ? null : round2((p.menge ?? 0) * ep);
                                const cls = [c.excluded ? 'dim' : '', ep != null && st.low != null && ep === st.low && ep > 0 && !c.excluded ? 'low' : '', isOut(c, p.oz) ? 'out' : '', abw[ci] ? 'mabw' : ''].join(' ');
                                return (
                                  <Fragment key={c.offer.id}>
                                    <td className={cls}>
                                      <input className="epin" data-oz={p.oz} data-c={ci} inputMode="decimal" defaultValue={ep == null ? '' : fmtNum(ep)} key={`${c.offer.id}${p.oz}${ep}`} aria-label={`EP ${p.oz} Nr. ${c.offer.nr}`}
                                        onFocus={(e) => e.currentTarget.select()} onBlur={(e) => { const v = parseNum(e.target.value); if (v !== ep) setEp(c.offer.id, p.oz, v); }} />
                                    </td>
                                    <td className={`gp ${cls}`}>
                                      {gp == null ? '' : fmtNum(gp)}
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
                </tbody>
                <tfoot>
                  <FootRow ncol={ncol} hasLv={hasLv} label="Summe netto (ohne Bedarfspositionen)">{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className="gp strong">{fmtNum(c.sumNet ?? 0)}</td>)}</FootRow>
                  <FootRow ncol={ncol} hasLv={hasLv} label="Nachlass ohne Bedingung">{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1}>{c.nachlass ? <b>{fmtNum(c.nachlass)} %</b> : <span className="muted">–</span>}</td>)}</FootRow>
                  <tr className="total">
                    <td className={hasLv ? 'sticky c0' : ''} />{hasLv ? <td className="sticky c1 left"><b>Angebotssumme netto</b></td> : <td className="left"><b>Angebotssumme netto</b></td>}{hasLv && <><td /><td /></>}
                    {cells.map((c) => (
                      <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className={c.excluded ? 'dim' : ''}>
                        <div className="big">{fmtEur(c.net)}</div><small className="muted">brutto {fmtEur(c.gross)}</small>
                        <div>{c.rank && <Chip kind={c.rank === 1 ? 'ok' : 'info'}>Rang {c.rank}</Chip>} {c.dMin != null && c.rank !== 1 && c.rank && <Chip kind="info">{fmtPct(c.dMin)}</Chip>} {c.dKosten != null && <Chip kind="info" title="zum Kostenvoranschlag">KV {fmtPct(c.dKosten)}</Chip>}</div>
                      </td>
                    ))}
                  </tr>
                  <FootRow ncol={ncol} hasLv={hasLv} label="Hinweise">{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className="flags">{c.flags.map((f, i) => <Chip key={i} kind={f.kind}>{f.text}</Chip>)}</td>)}</FootRow>
                </tfoot>
              </table>
            </div>
            <div className="legend">
              <span><i className="sw low" /> günstigster EP der Position</span>
              <span><i className="sw out" /> Ausreißer (&gt; {s.project.abweichung} % vom Mittel der übrigen)</span>
              <span><i className="sw mabw" /> Menge laut Bieter weicht vom LV ab</span>
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
