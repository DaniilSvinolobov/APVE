import { Fragment, useMemo, useState, type ClipboardEvent } from 'react';
import type { State } from '../domain/types';
import { computeLos, losPositions, schaetzSumme, titelKey, zkey, zusatzWert } from '../domain/calc';
import { fmtEur, fmtNum, fmtPct, parseNum, round2 } from '../domain/fmt';
import { Chip, Icon, NumInput, Seg, Tabs } from '../components/ui';
import { downloadCsv } from '../storage/exportCsv';

type Up = (fn: (d: State) => void) => void;
type RK = 'avg' | 'min' | 'sch';

export function StepPreisspiegel({ s, up }: { s: State; up: Up }) {
  const [losId, setLosId] = useState(s.lose[0]?.id ?? '');
  const los = s.lose.find((l) => l.id === losId) ?? s.lose[0];
  const [runde, setRunde] = useState<number | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyAuff, setOnlyAuff] = useState(false);
  const [basis, setBasis] = useState<'min' | 'schaetz'>('min');

  const cellsAll = useMemo(() => (los ? computeLos(s, los) : []), [s, los]);
  if (!los) return <section className="card"><h2>Preisspiegel</h2><p className="muted">Bitte zuerst Lose anlegen bzw. das LV laden (Schritt 2).</p></section>;
  const runden = [...new Set(cellsAll.map((c) => c.offer.runde))].sort();
  const rd = runde != null && runden.includes(runde as 1 | 2 | 3) ? runde : runden[runden.length - 1] ?? 1;
  const cells = cellsAll.filter((c) => c.offer.runde === rd);
  const pos = losPositions(s, los);
  const hasLv = pos.length > 0;
  const th = s.project.abweichung / 100;

  const groups = new Map<string, typeof pos>();
  for (const p of pos) { const k = titelKey(p.oz); groups.set(k, [...(groups.get(k) ?? []), p]); }

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

  /* Vergleichswerte: Mittelwert und Günstigst über die gewerteten Bieter, LV-Schätzpreis aus GAEB 82 */
  const valid = cells.filter((c) => c.complete && !c.excluded);
  const hasSch = Object.keys(s.schaetz ?? {}).length > 0;
  const useBasis = basis === 'schaetz' && hasSch ? 'schaetz' : 'min';
  const avgOf = (v: number[]) => (v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null);
  const minOf = (v: number[]) => (v.length ? Math.min(...v) : null);
  const refEp = (oz: string) => {
    const v = valid.map((c) => epOf(c, oz)).filter((x): x is number => x != null && x > 0);
    return { avg: avgOf(v), min: minOf(v), sch: s.schaetz?.[zkey(oz)] ?? null };
  };
  const refSum = (sums: number[], sch: number | null) => { const v = sums.filter((x) => x > 0); return { avg: avgOf(v), min: minOf(v), sch }; };
  const gpOf = (p: (typeof pos)[number], ep: number | null) => (ep == null ? null : round2((p.menge ?? 0) * ep));
  const pct = (v: number | null, ref: number | null) => (v == null || ref == null || ref <= 0 || v <= 0 ? null : (v / ref - 1) * 100);
  const Pct = ({ v, to }: { v: number | null; to: number | null }) => { const d = pct(v, to); return d == null || Math.abs(d) < 0.05 ? null : <small className="pct">{fmtPct(d)}</small>; };
  const refHead: [RK, string][] = [['avg', 'Ø Bieter'], ['min', 'Günstigst'], ...(hasSch ? ([['sch', 'LV-Schätzpreis']] as [RK, string][]) : [])];

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
  const exportCsv = () => {
    const head = ['Pos.', 'Leistung', 'Menge', 'Einheit', ...cells.flatMap((c) => [`Nr.${c.offer.nr} ${c.offer.firma} EP`, `GP`]), ...refHead.flatMap(([, l]) => [`${l} EP`, `${l} GP`])];
    const rows = pos.map((p) => { const r = refEp(p.oz); return [p.oz, p.kurz, p.menge ?? '', p.einheit, ...cells.flatMap((c) => { const ep = epOf(c, p.oz); return [ep ?? '', gpOf(p, ep) ?? '']; }), ...refHead.flatMap(([k]) => [r[k] ?? '', gpOf(p, r[k]) ?? ''])]; });
    for (const r of zList) rows.push([`neu: ${r.oz}`, r.kurz, r.menge ?? '', r.einheit, ...cells.flatMap((c) => { const z = r.per.get(c.offer.id); return z ? [z.ep ?? '', zusatzWert(z)] : ['', '']; }), ...refHead.flatMap(() => ['', ''])]);
    const blank = refHead.flatMap(() => ['', '']);
    const tot = (f: (c: (typeof cells)[number]) => number | null) => { const v = cells.filter((c) => c.complete && !c.excluded).map(f).filter((x): x is number => x != null); return [avgOf(v) ?? '', minOf(v) ?? '', ...(hasSch ? [schaetzSumme(s, los) ?? ''] : [])]; };
    const fill = (vals: (number | string)[]) => refHead.flatMap((_, i) => ['', vals[i] ?? '']);
    rows.push([], ['', 'Summe netto', '', '', ...cells.flatMap((c) => ['', c.sumNet ?? '']), ...fill(tot((c) => c.sumNet))], ['', 'Nachlass %', '', '', ...cells.flatMap((c) => ['', c.nachlass]), ...blank], ['', 'Angebotssumme netto', '', '', ...cells.flatMap((c) => ['', c.net ?? '']), ...fill(tot((c) => c.net))], ['', 'Angebotssumme brutto', '', '', ...cells.flatMap((c) => ['', c.gross ?? '']), ...fill(tot((c) => c.net).map((v) => (v === '' ? v : round2(Number(v) * (1 + s.project.mwst / 100)))))]);
    downloadCsv(`Preisspiegel_${los.nr}_Runde${rd}.csv`, [head, ...rows]);
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
              <span className="field-label" style={{ marginLeft: 8 }}>Abweichung in % zu:</span>
              <Seg small value={useBasis} onChange={setBasis} options={[{ value: 'min', label: 'Günstigstem' }, ...(hasSch ? [{ value: 'schaetz' as const, label: 'LV-Schätzpreis' }] : [])]} />
              {cells.some((c) => c.zusatz.length) && <Chip kind="info">Neue Positionen gegenüber dem LV (unten markiert) sind in den Summen enthalten</Chip>}
              {cells.some((c) => c.mengeAbw.length) && <Chip kind="warn">Mengen im LV weichen von der Bieterdatei ab – siehe markierte Positionen</Chip>}
            </div>
            <div className="scroll big" onPaste={(e) => { const t = e.target as HTMLElement; const oz = t.dataset.oz, c = t.dataset.c; if (oz && c) onPaste(e, oz, Number(c), visibleOz); }}>
              <table className="preis" style={{ minWidth: 560 + (cells.length + refHead.length) * 250 }}>
                <thead>
                  <tr>
                    {hasLv ? <><th className="sticky c0 left">Pos.</th><th className="sticky c1 left">Leistung</th><th>Menge</th><th>Einh.</th></> : <th className="left">Position</th>}
                    {hasLv && refHead.map(([k, l]) => <th key={k} colSpan={2} className="bh ref">{l}<small className="block muted">{k === 'sch' ? 'GAEB 82' : 'gewertete Bieter'}</small></th>)}
                    {cells.map((c) => <th key={c.offer.id} colSpan={hasLv ? 2 : 1} className={`bh ${c.excluded ? 'dim' : ''}`}>Nr. {c.offer.nr}<small className="block muted">{c.offer.firma}</small></th>)}
                  </tr>
                  {hasLv && <tr className="sub"><th className="sticky c0" /><th className="sticky c1" /><th /><th />{refHead.map(([k]) => <Fragment key={k}><th className="ref">EP €</th><th className="ref">GP €</th></Fragment>)}{cells.map((c) => <Fragment key={c.offer.id}><th>EP €</th><th>GP €</th></Fragment>)}</tr>}
                </thead>
                <tbody>
                  {!hasLv && (
                    <tr><td className="left"><b>Angebotssumme (netto, vor Nachlass)</b></td>{cells.map((c) => <td key={c.offer.id}><NumInput value={c.offer.summen[los.id] ?? null} suffix="€" onChange={(v) => up((d) => void (d.offers.find((x) => x.id === c.offer.id)!.summen[los.id] = v))} /></td>)}</tr>
                  )}
                  {visibleGroups.map(([k, ps]) => {
                    const isOpen = open.has(k) || onlyAuff;
                    const sums = cells.map((c) => titelSum(c, ps));
                    const min = Math.min(...sums.filter((x) => x > 0));
                    const tr = refSum(sums.filter((_, i) => valid.includes(cells[i])), schaetzSumme(s, los, k));
                    const tBase = useBasis === 'schaetz' ? tr.sch : tr.min;
                    return (
                      <Fragment key={k}>
                        <tr className="titel" onClick={() => setOpen((o) => { const n = new Set(o); n.has(k) ? n.delete(k) : n.add(k); return n; })}>
                          <td className="sticky c0 left"><Icon name={isOpen ? 'down' : 'right'} /> {k}</td>
                          <td className="sticky c1 left"><b>{s.titles[k] || `Titel ${k}`}</b><small className="muted"> · {ps.length} Pos.</small></td><td /><td />
                          {refHead.map(([rk]) => <Fragment key={rk}><td className="ref" /><td className="gp strong ref">{tr[rk] != null ? fmtNum(tr[rk]!) : ''}</td></Fragment>)}
                          {cells.map((c, i) => <Fragment key={c.offer.id}><td /><td className={`gp strong ${sums[i] > 0 && sums[i] === min ? 'low' : ''}`}>{fmtNum(sums[i])}<Pct v={sums[i]} to={tBase} /></td></Fragment>)}
                        </tr>
                        {isOpen && ps.map((p) => {
                          const st = peerStats(p.oz);
                          const abw = cells.map((c) => c.mengeAbw.find((m) => m.oz === p.oz));
                          const rp = refEp(p.oz);
                          const base = gpOf(p, useBasis === 'schaetz' ? rp.sch : rp.min);
                          return (
                            <tr key={p.oz} className={p.bedarf ? 'bedarf' : ''}>
                              <td className="sticky c0 left">{p.oz}</td>
                              <td className="sticky c1 left" title={p.kurz}><span className="kurz">{p.kurz}</span>{p.bedarf && <small className="muted"> (Bedarf)</small>}</td>
                              <td>
                                <NumInput value={p.menge} decimals={p.menge != null && Number.isInteger(p.menge) ? 0 : 3} className={`sm ${p.menge !== p.mengeOrig ? 'chg' : ''}`} label="Menge" onChange={(v) => up((d) => void (d.lv.find((x) => x.oz === p.oz)!.menge = v))} />
                                {p.menge !== p.mengeOrig && <small className="muted block">LV-Original: {p.mengeOrig}</small>}
                              </td>
                              <td>{p.einheit}</td>
                              {refHead.map(([rk]) => <Fragment key={rk}><td className="ref gp">{rp[rk] != null ? fmtNum(rp[rk]!) : ''}</td><td className="ref gp">{rp[rk] != null ? fmtNum(gpOf(p, rp[rk])!) : ''}</td></Fragment>)}
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
                        {refHead.map(([rk]) => <Fragment key={rk}><td className="ref" /><td className="ref" /></Fragment>)}
                        {cells.map((c) => <Fragment key={c.offer.id}><td /><td className="gp strong">{c.zusatz.length ? fmtNum(zSum(c)) : ''}</td></Fragment>)}
                      </tr>
                      {zList.map((r, i) => (
                        <tr key={i} className="neu">
                          <td className="sticky c0 left">{r.oz}</td>
                          <td className="sticky c1 left" title={r.kurz}><span className="kurz">{r.kurz || '(ohne Text in der Bieterdatei)'}</span> <small className="neu-tag">neu</small></td>
                          <td>{r.menge ?? ''}</td>
                          <td>{r.einheit}</td>
                          {refHead.map(([rk]) => <Fragment key={rk}><td className="ref" /><td className="ref" /></Fragment>)}
                          {cells.map((c) => { const z = r.per.get(c.offer.id); return <Fragment key={c.offer.id}><td className={`gp ${c.excluded ? 'dim' : ''}`}>{z?.ep != null ? fmtNum(z.ep) : z ? '' : '–'}</td><td className={`gp ${c.excluded ? 'dim' : ''}`}>{z ? fmtNum(zusatzWert(z)) : ''}</td></Fragment>; })}
                        </tr>
                      ))}
                    </>
                  )}
                </tbody>
                <tfoot>
                  <FootRow ncol={ncol} hasLv={hasLv} label="Summe netto (ohne Bedarfspositionen)">{hasLv && refHead.map(([rk]) => <td key={rk} colSpan={2} className="gp strong ref">{refTot(rk, (c) => c.sumNet) ?? ''}</td>)}{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1} className="gp strong">{fmtNum(c.sumNet ?? 0)}</td>)}</FootRow>
                  <FootRow ncol={ncol} hasLv={hasLv} label="Nachlass ohne Bedingung">{cells.map((c) => <td key={c.offer.id} colSpan={hasLv ? 2 : 1}>{c.nachlass ? <b>{fmtNum(c.nachlass)} %</b> : <span className="muted">–</span>}</td>)}</FootRow>
                  <tr className="total">
                    <td className={hasLv ? 'sticky c0' : ''} />{hasLv ? <td className="sticky c1 left"><b>Angebotssumme netto</b></td> : <td className="left"><b>Angebotssumme netto</b></td>}{hasLv && <><td /><td /></>}
                    {hasLv && refHead.map(([rk]) => { const n = refTotNum(rk, (c) => c.net); return <td key={rk} colSpan={2} className="ref"><div className="big">{fmtEur(n)}</div><small className="muted">brutto {fmtEur(n == null ? null : round2(n * (1 + s.project.mwst / 100)))}</small></td>; })}
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
              <span><i className="sw neu" /> neue Position (nicht im LV), in der Summe enthalten</span>
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
