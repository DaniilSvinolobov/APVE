import type { PStatus, State } from './types';
import { PSTATUS } from './types';
import { pruefStatus } from './calc';
import { uid } from './fmt';
import { Chip, Icon } from './ui';

type Up = (fn: (d: State) => void) => void;

/** Prüfung auf Vollständigkeit der abgegebenen Angebotsunterlagen: Unterlagen × Angebote. */
export function Vollstaendigkeit({ s, up }: { s: State; up: Up }) {
  const set = (oi: number, id: string, st: PStatus | '') =>
    up((d) => { const o = d.offers[oi]; if (!o.pruef) o.pruef = {}; if (st) o.pruef[id] = { s: st, d: o.pruef[id]?.d ?? '' }; else delete o.pruef[id]; });
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Prüfung auf Vollständigkeit der Angebotsunterlagen</h2>
          <p className="lead">Wird als Anlage im Vergabevermerk gedruckt. Was in den Ordnern erkannt wurde, ist vorbelegt (z. B. Formular 221 aus „Nachforderung“); alles andere bitte je Zeile auswählen. Zeilen lassen sich umbenennen, löschen und ergänzen.</p>
        </div>
        <label className="mini big"><input type="checkbox" checked={s.project.vollstaendigkeit} onChange={(e) => up((d) => void (d.project.vollstaendigkeit = e.target.checked))} /> als Anlage drucken</label>
      </div>
      <div className="scroll">
        <table className="matrix vtab" style={{ minWidth: 340 + s.offers.length * 190 }}>
          <thead>
            <tr>
              <th className="left">Unterlage / Prüfpunkt</th>
              {s.offers.map((o, oi) => {
                const ps = pruefStatus(s, o);
                return (
                  <th key={o.id}>
                    {o.nr}_{o.firma}
                    <div className="row" style={{ justifyContent: 'center', marginTop: 4 }}>
                      <button className="link" onClick={() => up((d) => { const x = d.offers[oi]; if (!x.pruef) x.pruef = {}; d.unterlagen.forEach((u) => { if (!x.pruef[u.id]) x.pruef[u.id] = { s: 'ok', d: '' }; }); })}>Rest = vorhanden</button>
                    </div>
                    {ps.fehlt.length > 0 ? <Chip kind="bad">{ps.fehlt.length} fehlt</Chip> : ps.ungeprueft > 0 ? <Chip kind="warn">{ps.ungeprueft} offen</Chip> : <Chip kind="ok">vollständig</Chip>}
                  </th>
                );
              })}
              <th />
            </tr>
          </thead>
          <tbody>
            {s.unterlagen.map((u, ui) => (
              <tr key={u.id}>
                <td className="left"><input className="plain wide" value={u.label} onChange={(e) => up((d) => void (d.unterlagen[ui].label = e.target.value))} /></td>
                {s.offers.map((o, oi) => {
                  const p = o.pruef?.[u.id];
                  return (
                    <td key={o.id}>
                      <select className={`pst ${p?.s ?? ''}`} value={p?.s ?? ''} onChange={(e) => set(oi, u.id, e.target.value as PStatus | '')} aria-label={`${u.label} – Nr. ${o.nr}`}>
                        <option value="">– offen –</option>
                        {PSTATUS.map((x) => <option key={x.v} value={x.v}>{x.v === 'ok' ? '✓ ' : ''}{x.label}</option>)}
                      </select>
                      {p?.s === 'nach' && <input type="date" className="pdate" value={p.d} onChange={(e) => up((d) => void (d.offers[oi].pruef[u.id].d = e.target.value))} aria-label="Nachgereicht am" />}
                    </td>
                  );
                })}
                <td><button className="icon-btn" title="Zeile entfernen" onClick={() => up((d) => { d.unterlagen.splice(ui, 1); d.offers.forEach((o) => { if (o.pruef) delete o.pruef[u.id]; }); })}><Icon name="trash" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn small" style={{ marginTop: 12 }} onClick={() => up((d) => void d.unterlagen.push({ id: uid(), label: '' }))}><Icon name="plus" /> Zeile hinzufügen</button>
      <p className="tip" style={{ marginTop: 14 }}><b>Gut zu wissen:</b> Fehlende Erklärungen oder Nachweise dürfen nachgefordert werden, bevor ein Angebot ausgeschlossen wird (§ 16a VOB/A). Ausschlüsse tragen Sie je Los im Schritt „Wertung“ ein.</p>
    </section>
  );
}
