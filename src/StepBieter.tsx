import type { State } from './types';
import { FORMAL_CHECKS } from './types';
import { newBidder } from './demo';
import { Icon, Chip } from './ui';

export function StepBieter({ s, up }: { s: State; up: (fn: (d: State) => void) => void }) {
  const n = s.bidders.length;
  const addBidder = () =>
    up((d) => {
      d.bidders.push(newBidder(''));
    });
  const remove = (id: string) =>
    up((d) => {
      d.bidders = d.bidders.filter((b) => b.id !== id);
      for (const k in d.prices) delete d.prices[k][id];
      for (const k in d.scores) delete d.scores[k][id];
    });
  return (
    <div className="stack">
      <section className="card">
        <div className="card-head">
          <div>
            <h2>Bieter & Formalprüfung</h2>
            <p className="lead">Namen eintragen, dann je Bieter abhaken, was vorliegt. Fehlt etwas Zwingendes, Bieter unten ausschließen und begründen.</p>
          </div>
          <button className="btn" onClick={addBidder}><Icon name="plus" /> Bieter hinzufügen</button>
        </div>
        <div className="scroll">
          <table className="matrix" style={{ minWidth: 260 + n * 190 }}>
            <thead>
              <tr>
                <th className="left">Prüfpunkt</th>
                {s.bidders.map((b, i) => (
                  <th key={b.id}>
                    <div className="bname">
                      <input
                        value={b.name}
                        placeholder={`Bieter ${i + 1}`}
                        onChange={(e) => up((d) => void (d.bidders[i].name = e.target.value))}
                      />
                      {n > 1 && (
                        <button className="icon-btn" title="Bieter entfernen" onClick={() => remove(b.id)}>
                          <Icon name="trash" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FORMAL_CHECKS.map((c) => (
                <tr key={c.id}>
                  <td className="left">
                    <b>{c.label}</b>
                    <small className="muted block">{c.hint}</small>
                  </td>
                  {s.bidders.map((b, i) => (
                    <td key={b.id} className={b.excluded ? 'dim' : ''}>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={!!b.checks[c.id]}
                          onChange={(e) => up((d) => void (d.bidders[i].checks[c.id] = e.target.checked))}
                        />
                        <span />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="sumrow">
                <td className="left"><b>Ergebnis</b></td>
                {s.bidders.map((b, i) => {
                  const ok = FORMAL_CHECKS.every((c) => b.checks[c.id]);
                  return (
                    <td key={b.id}>
                      {b.excluded ? <Chip kind="bad">Ausgeschlossen</Chip> : ok ? <Chip kind="ok">Formal in Ordnung</Chip> : <Chip kind="warn">Mängel / offen</Chip>}
                      {!ok && !b.excluded && (
                        <button className="link" onClick={() => up((d) => FORMAL_CHECKS.forEach((c) => (d.bidders[i].checks[c.id] = true)))}>
                          alle bestätigen
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <td className="left">
                  <b>Vom Verfahren ausschließen</b>
                  <small className="muted block">z. B. nach erfolgloser Nachforderung (§ 16a VOB/A)</small>
                </td>
                {s.bidders.map((b, i) => (
                  <td key={b.id} className="top">
                    <label className="toggle">
                      <input type="checkbox" checked={b.excluded} onChange={(e) => up((d) => void (d.bidders[i].excluded = e.target.checked))} />
                      <span />
                    </label>
                    {b.excluded && (
                      <textarea
                        rows={3}
                        placeholder="Begründung (Pflicht für den Vergabevermerk)"
                        value={b.exclusionReason}
                        onChange={(e) => up((d) => void (d.bidders[i].exclusionReason = e.target.value))}
                      />
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <p className="tip"><b>Gut zu wissen:</b> Fehlende Erklärungen oder Nachweise dürfen nachgefordert werden, bevor ein Angebot ausgeschlossen wird. Die Prüfung sollte dokumentiert und – wo möglich – von Personen ohne Vergabeentscheidung durchgeführt werden.</p>
    </div>
  );
}
