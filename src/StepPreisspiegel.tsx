import { Fragment, useState, type ClipboardEvent } from 'react';
import type { State } from './types';
import { computeAll, lineTotal, lowestEp, outlier } from './calc';
import { FORMAL_CHECKS } from './types';
import { fmtEur, fmtNum, parseNum, uid } from './fmt';
import { Icon, NumInput, Chip } from './ui';

type Up = (fn: (d: State) => void) => void;

export function StepPreisspiegel({ s, up }: { s: State; up: Up }) {
  const lv = s.project.mode === 'lv';
  const [importing, setImporting] = useState(false);
  const results = computeAll(s, FORMAL_CHECKS.map((c) => c.id));
  const nb = s.bidders.length;
  const cols = lv ? 2 : 1;
  const posIds = s.positions.map((p) => p.id);

  const addPos = () =>
    up((d) => {
      const last = d.positions[d.positions.length - 1];
      d.positions.push({ id: uid(), nr: nextNr(last?.nr), text: '', menge: null, einheit: 'm²', bedarf: false });
    });

  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement;
    const r0 = Number(t.dataset.r);
    const c0 = Number(t.dataset.c);
    if (Number.isNaN(r0) || Number.isNaN(c0)) return;
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return; // einzelne Zelle: normales Einfügen
    e.preventDefault();
    const rows = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n').map((r) => r.split('\t'));
    up((d) => {
      rows.forEach((row, i) => {
        const pid = posIds[r0 + i];
        if (!pid) return;
        row.forEach((cell, j) => {
          const b = d.bidders[c0 + j];
          if (b) (d.prices[pid] ??= {})[b.id] = parseNum(cell);
        });
      });
    });
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Preisspiegel</h2>
            <p className="lead">
              {lv
                ? 'Einheitspreise (EP) je Bieter eintragen. Tipp: Aus Excel kopierte Spalten lassen sich direkt in eine EP-Zelle einfügen (Strg+V).'
                : 'Angebotssumme (netto) je Bieter eintragen.'}
            </p>
          </div>
          {lv && (
            <div className="row">
              <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" /> LV aus Excel einfügen</button>
              <button className="btn" onClick={addPos}><Icon name="plus" /> Position</button>
            </div>
          )}
        </div>

        <div className="scroll" onPaste={onPaste}>
          <table className="preis" style={{ minWidth: (lv ? 520 : 300) + nb * (lv ? 230 : 190) }}>
            <thead>
              <tr>
                {lv && <><th className="sticky c0 left">Pos.</th><th className="sticky c1 left">Leistung</th><th>Menge</th><th>Einh.</th></>}
                {!lv && <th className="left">Position</th>}
                {s.bidders.map((b) => (
                  <th key={b.id} colSpan={cols} className={`bh ${b.excluded ? 'dim' : ''}`}>
                    {b.name || 'Bieter'}
                    {b.excluded && <small className="muted block">ausgeschlossen</small>}
                  </th>
                ))}
              </tr>
              {lv && (
                <tr className="sub">
                  <th className="sticky c0" /><th className="sticky c1" /><th /><th />
                  {s.bidders.map((b) => (
                    <Fragment key={b.id}><th>EP €</th><th>GP €</th></Fragment>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {lv && s.positions.length === 0 && (
                <tr><td colSpan={4 + nb * 2} className="empty">
                  Noch keine Positionen. Fügen Sie das Leistungsverzeichnis aus Excel ein oder legen Sie Positionen manuell an.
                </td></tr>
              )}
              {lv && s.positions.map((p, r) => {
                const low = lowestEp(s, p.id);
                return (
                  <tr key={p.id} className={p.bedarf ? 'bedarf' : ''}>
                    <td className="sticky c0 left"><input className="plain nr" value={p.nr} onChange={(e) => up((d) => void (d.positions[r].nr = e.target.value))} /></td>
                    <td className="sticky c1 left">
                      <input className="plain" value={p.text} placeholder="Leistungsbeschreibung" onChange={(e) => up((d) => void (d.positions[r].text = e.target.value))} />
                      <div className="pos-tools">
                        <label className="mini"><input type="checkbox" checked={p.bedarf} onChange={(e) => up((d) => void (d.positions[r].bedarf = e.target.checked))} /> Bedarfsposition</label>
                        <button className="link danger" onClick={() => up((d) => { d.positions.splice(r, 1); delete d.prices[p.id]; })}>entfernen</button>
                      </div>
                    </td>
                    <td><NumInput value={p.menge} onChange={(v) => up((d) => void (d.positions[r].menge = v))} className="sm" label="Menge" /></td>
                    <td><input className="plain unit" value={p.einheit} onChange={(e) => up((d) => void (d.positions[r].einheit = e.target.value))} /></td>
                    {s.bidders.map((b, c) => {
                      const ep = s.prices[p.id]?.[b.id] ?? null;
                      const gp = lineTotal(p.menge, ep);
                      const cls = [b.excluded ? 'dim' : '', ep != null && low != null && ep === low && !b.excluded ? 'low' : '', outlier(s, p.id, b.id) ? 'out' : ''].join(' ');
                      return (
                        <Fragment key={b.id}>
                          <td className={cls}>
                            <NumInput
                              value={ep}
                              data={{ r, c }}
                              label={`EP ${p.nr} ${b.name}`}
                              onChange={(v) => up((d) => void ((d.prices[p.id] ??= {})[b.id] = v))}
                              className="sm"
                            />
                          </td>
                          <td className={`gp ${cls}`}>{gp == null ? '' : fmtNum(gp)}</td>
                        </Fragment>
                      );
                    })}
                  </tr>
                );
              })}

              {!lv && (
                <tr>
                  <td className="left"><b>Angebotssumme (netto)</b></td>
                  {s.bidders.map((b, c) => (
                    <td key={b.id} className={b.excluded ? 'dim' : ''}>
                      <NumInput value={b.summe} onChange={(v) => up((d) => void (d.bidders[c].summe = v))} suffix="€" label={`Summe ${b.name}`} />
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
            <tfoot>
              {lv && (
                <tr className="sumrow">
                  <td className="sticky c0" /><td className="sticky c1 left"><b>Summe netto (ohne Bedarfspositionen)</b></td><td /><td />
                  {results.map((r) => (<Fragment key={r.bidder.id}><td /><td className={`gp strong ${r.bidder.excluded ? 'dim' : ''}`}>{fmtNum(r.brutto ?? 0)}</td></Fragment>))}
                </tr>
              )}
              <FootRow label="Nachlass ohne Bedingung" lv={lv} results={results}
                render={(r, c) => <NumInput value={r.bidder.nachlass} onChange={(v) => up((d) => void (d.bidders[c].nachlass = v))} suffix="%" className="sm" label="Nachlass" />} />
              <FootRow label="Skonto (nur Info – wird nicht gewertet)" lv={lv} results={results}
                render={(r, c) => <NumInput value={r.bidder.skonto} onChange={(v) => up((d) => void (d.bidders[c].skonto = v))} suffix="%" className="sm" label="Skonto" />} />
              {lv && (
                <FootRow label="Angebotssumme laut Bieter (zur Rechenprüfung)" lv={lv} results={results}
                  render={(r, c) => (
                    <>
                      <NumInput value={r.bidder.summeBieter} onChange={(v) => up((d) => void (d.bidders[c].summeBieter = v))} suffix="€" label="Summe laut Bieter" />
                      {r.rechnerDiff != null && Math.abs(r.rechnerDiff) > 0.01 && <Chip kind="warn">Δ {fmtNum(r.rechnerDiff)} €</Chip>}
                    </>
                  )} />
              )}
              <tr className="total">
                <td className={lv ? 'sticky c0' : ''} />{lv && <td className="sticky c1 left"><b>Angebotssumme netto</b></td>}{lv && <><td /><td /></>}
                {!lv && <td className="left"><b>Angebotssumme netto (nach Nachlass)</b></td>}
                {results.map((r) => (
                  <td key={r.bidder.id} colSpan={cols} className={r.bidder.excluded ? 'dim' : ''}>
                    <div className="big">{fmtEur(r.net)}</div>
                    <small className="muted">brutto {fmtEur(r.gross)}</small>
                    {r.rank && <div><Chip kind={r.rank === 1 ? 'ok' : 'info'}>Rang {r.rank}</Chip></div>}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="legend">
          <span><i className="sw low" /> günstigster EP der Position</span>
          <span><i className="sw out" /> Ausreißer (&gt; 50 % vom Median) – bitte prüfen</span>
          <span><i className="sw bed" /> Bedarfsposition (nicht in Summe)</span>
        </div>
      </section>
      {importing && <ImportDialog onClose={() => setImporting(false)} up={up} />}
    </div>
  );
}

function FootRow({ label, lv, results, render }: { label: string; lv: boolean; results: ReturnType<typeof computeAll>; render: (r: ReturnType<typeof computeAll>[number], c: number) => React.ReactNode }) {
  return (
    <tr className="footrow">
      {lv ? <><td className="sticky c0" /><td className="sticky c1 left">{label}</td><td /><td /></> : <td className="left">{label}</td>}
      {results.map((r, c) => (
        <td key={r.bidder.id} colSpan={lv ? 2 : 1} className={r.bidder.excluded ? 'dim' : ''}>{render(r, c)}</td>
      ))}
    </tr>
  );
}

function nextNr(prev?: string) {
  if (!prev) return '01.01';
  const m = prev.match(/^(.*?)(\d+)$/);
  return m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0') : '';
}

function ImportDialog({ onClose, up }: { onClose: () => void; up: Up }) {
  const [txt, setTxt] = useState('');
  const rows = txt.replace(/\r/g, '').split('\n').filter((r) => r.trim()).map((r) => r.split('\t'));
  const apply = () => {
    up((d) => {
      for (const r of rows) {
        // Spalten: Pos | Text | Menge | Einheit  (Kopfzeile wird erkannt und übersprungen)
        const menge = parseNum(r[2] ?? '');
        if (r.length >= 3 && menge == null && /pos|menge|text/i.test(r.join(' '))) continue;
        d.positions.push({ id: uid(), nr: r[0] ?? '', text: r[1] ?? '', menge, einheit: r[3] ?? '', bedarf: /bedarf|eventual/i.test(r[1] ?? '') });
      }
    });
    onClose();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Leistungsverzeichnis aus Excel einfügen</h2>
        <p className="lead">Kopieren Sie in Excel die Spalten <b>Pos. | Leistungstext | Menge | Einheit</b> und fügen Sie sie hier ein.</p>
        <textarea autoFocus rows={9} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="01.01	Metallständerwand W112	640	m²" />
        <div className="row end">
          <span className="muted">{rows.length} Zeilen erkannt</span>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" disabled={!rows.length} onClick={apply}>Übernehmen</button>
        </div>
      </div>
    </div>
  );
}
