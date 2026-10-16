import type { State } from './types';
import { FORMAL_CHECKS } from './types';
import { computeAll } from './calc';
import { fmtEur, fmtNum, fmtPct, uid } from './fmt';
import { Chip, Icon, NumInput } from './ui';

export function StepWertung({ s, up }: { s: State; up: (fn: (d: State) => void) => void }) {
  const res = computeAll(s, FORMAL_CHECKS.map((c) => c.id));
  const multi = s.project.kriterienModus === 'mehrere';
  const wKrit = s.criteria.reduce((a, c) => a + (c.weight || 0), 0);
  const wPreis = 100 - wKrit;
  const ranked = [...res].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const flagged = res.filter((r) => !r.bidder.excluded && (r.bidder.aufklaerung !== '' || r.flags.some((f) => f.text.includes('Aufklärung nötig'))));

  return (
    <div className="stack">
      {multi && (
        <section className="card">
          <div className="card-head">
            <div>
              <h2>Zuschlagskriterien & Gewichtung</h2>
              <p className="lead">Preis erhält den Rest auf 100 %. Bewertung der Bieter je Kriterium mit 0–10 Punkten.</p>
            </div>
            <button className="btn" onClick={() => up((d) => d.criteria.push({ id: uid(), name: '', weight: 5 }))}><Icon name="plus" /> Kriterium</button>
          </div>
          <div className="scroll">
            <table className="matrix">
              <thead>
                <tr>
                  <th className="left">Kriterium</th><th>Gewicht</th>
                  {res.filter((r) => r.eligible).map((r) => <th key={r.bidder.id}>{r.bidder.name || 'Bieter'}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="left"><b>Preis</b><small className="muted block">Punkte = günstigster Preis ÷ Preis × 100</small></td>
                  <td><b className={wPreis < 0 ? 'neg' : ''}>{fmtNum(wPreis, 0)} %</b></td>
                  {res.filter((r) => r.eligible).map((r) => <td key={r.bidder.id}>{fmtNum(r.preisPunkte ?? 0, 1)}</td>)}
                  <td />
                </tr>
                {s.criteria.map((c, i) => (
                  <tr key={c.id}>
                    <td className="left"><input className="plain" value={c.name} placeholder="Kriterium" onChange={(e) => up((d) => void (d.criteria[i].name = e.target.value))} /></td>
                    <td><NumInput value={c.weight} decimals={0} suffix="%" className="sm" onChange={(v) => up((d) => void (d.criteria[i].weight = v ?? 0))} /></td>
                    {res.filter((r) => r.eligible).map((r) => (
                      <td key={r.bidder.id}>
                        <NumInput value={s.scores[c.id]?.[r.bidder.id] ?? null} decimals={0} placeholder="0–10" className="sm"
                          onChange={(v) => up((d) => void ((d.scores[c.id] ??= {})[r.bidder.id] = v == null ? null : Math.max(0, Math.min(10, v))))} />
                      </td>
                    ))}
                    <td><button className="icon-btn" onClick={() => up((d) => void d.criteria.splice(i, 1))}><Icon name="trash" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {wPreis < 0 && <p className="warnbox"><Icon name="alert" /> Die Gewichte der Kriterien ergeben mehr als 100 %.</p>}
        </section>
      )}

      <section className="card">
        <h2>Wertungsübersicht</h2>
        <p className="lead">Alle Bieter im Vergleich – sortiert nach {multi ? 'Gesamtpunkten' : 'Preis'}.</p>
        <div className="scroll">
          <table className="matrix rank">
            <thead>
              <tr>
                <th>Rang</th><th className="left">Bieter</th><th className="r">Angebot netto</th>
                <th className="r">zur Kostenschätzung</th><th className="r">zum günstigsten</th>{multi && <th className="r">Punkte</th>}
                <th className="left">Prüfhinweise</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.bidder.id} className={r.bidder.excluded ? 'dim' : r.rank === 1 ? 'first' : ''}>
                  <td>{r.rank ? <span className={`rankbadge ${r.rank === 1 ? 'one' : ''}`}>{r.rank}</span> : '–'}</td>
                  <td className="left"><b>{r.bidder.name || 'Bieter'}</b></td>
                  <td className="r">{fmtEur(r.net)}</td>
                  <td className="r">{fmtPct(r.dKosten)}</td>
                  <td className="r">{r.rank ? fmtPct(r.dMin) : '–'}</td>
                  {multi && <td className="r"><b>{r.total == null ? '–' : fmtNum(r.total, 1)}</b></td>}
                  <td className="left flags">
                    {r.flags.length === 0 && r.eligible && <Chip kind="ok">Keine Auffälligkeiten</Chip>}
                    {r.flags.map((f, i) => <Chip key={i} kind={f.kind}>{f.text}</Chip>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {flagged.length > 0 && (
        <section className="card attention">
          <h2><Icon name="alert" /> Preisaufklärung erforderlich</h2>
          <p className="lead">
            Bei auffallend niedrigen Preisen muss der Preis aufgeklärt werden (schriftliche Anfrage beim Bieter; nur zum Angebotsinhalt, keine Verhandlung). Wird der Preis nicht plausibel erklärt, ist das Angebot auszuschließen. Tragen Sie hier das Ergebnis ein.
          </p>
          {flagged.map((r) => {
            const i = s.bidders.findIndex((b) => b.id === r.bidder.id);
            return (
              <div className="aufk" key={r.bidder.id}>
                <b>{r.bidder.name}</b>
                <div className="seg small">
                  {([['', 'Offen'], ['angemessen', 'Angemessen'], ['unangemessen', 'Unangemessen – nicht werten']] as const).map(([v, l]) => (
                    <button key={v} className={s.bidders[i].aufklaerung === v ? 'on' : ''} onClick={() => up((d) => void (d.bidders[i].aufklaerung = v))}>{l}</button>
                  ))}
                </div>
                <input value={s.bidders[i].aufklaerungNotiz} placeholder="Begründung des Bieters / Ergebnis kurz festhalten" onChange={(e) => up((d) => void (d.bidders[i].aufklaerungNotiz = e.target.value))} />
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
