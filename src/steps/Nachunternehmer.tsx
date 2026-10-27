import type { Nachunternehmer, Offer, State } from '../domain/types';
import { eignungsNachweis, nuOf } from '../domain/calc';
import { Chip, Icon } from '../components/ui';

type Up = (fn: (d: State) => void) => void;

/**
 * Eignungsnachweis (PQ-Nummer) und Nachunternehmer laut VVB 233/235 eines Angebots – von der KI vorbelegt,
 * hier zu prüfen und zu korrigieren (Handschrift wird nicht immer richtig gelesen). Erscheint im Vermerk unter „Nachweise und Eignungsprüfung“.
 */
export function NuEditor({ s, up, o }: { s: State; up: Up; o: Offer }) {
  const liste = nuOf(s, o);
  const eg = eignungsNachweis(s, o);
  const edit = (fn: (l: Nachunternehmer[]) => void) => up((d) => {
    const x = d.offers.find((y) => y.id === o.id);
    if (!x) return;
    const l = (nuOf(d, x) ?? []).map((n) => ({ ...n })); // dieselbe (zusammengeführte) Liste wie in der Anzeige
    fn(l);
    x.nu = l; x.nuQuelle = 'user';
  });
  const setPq = (v: string) => up((d) => { const x = d.offers.find((y) => y.id === o.id); if (x) { x.pq = v; delete x.pqQuelle; } });
  const ausKi = o.nuQuelle !== 'user' && !!liste?.length;
  return (
    <div className="nubox">
      <div className="grid g2">
        <label className="field"><span className="field-label">Präqualifikation (Nr.)</span>
          <input value={o.pq ?? ''} onChange={(e) => setPq(e.target.value)} placeholder="leer = nicht präqualifiziert" />
          {o.pqQuelle && o.pq?.trim() && <span className="field-hint"><Chip kind="info">KI – bitte prüfen</Chip> gelesen aus „{o.pqQuelle}“</span>}
          <span className="field-hint">{eg === 'pq' ? 'Im Vermerk: „präqualifiziert unter der Nr. …“' : eg === '124' ? 'Im Vermerk: Eignungsnachweis mit Eigenerklärung (VVB 124)' : 'Weder PQ-Nummer noch VVB 124 (vorhanden) – im Vermerk als offen markiert.'}</span>
        </label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <b>Nachunternehmer (VVB 233) / andere Unternehmen (VVB 235)</b>
        {ausKi && <Chip kind="info">KI – bitte prüfen</Chip>}
        {o.nuQuelle === 'user' && <Chip kind="ok">geprüft / bearbeitet</Chip>}
        {liste === undefined && <span className="muted">noch nicht erfasst</span>}
      </div>
      {liste && liste.length > 0 && (
        <table className="matrix nutab">
          <thead><tr><th className="left">OZ / Leistungsbereich</th><th className="left">Teilleistung</th><th className="left">Unternehmen</th><th className="left">Art</th><th /></tr></thead>
          <tbody>
            {liste.map((n, i) => (
              <tr key={i}>
                <td className="left"><input className="plain wide" value={n.oz} onChange={(e) => edit((l) => void (l[i].oz = e.target.value))} aria-label="OZ / Leistungsbereich" /></td>
                <td className="left"><input className="plain wide" value={n.leistung} onChange={(e) => edit((l) => void (l[i].leistung = e.target.value))} aria-label="Teilleistung" /></td>
                <td className="left"><input className="plain wide" value={n.firma} onChange={(e) => edit((l) => void (l[i].firma = e.target.value))} aria-label="Unternehmen" /></td>
                <td className="left">
                  <select value={n.art ?? 'nu'} onChange={(e) => edit((l) => void (l[i].art = e.target.value as Nachunternehmer['art']))} aria-label="Art">
                    <option value="nu">Nachunternehmer (233)</option><option value="beide">Nachunternehmer + Kapazitäten (233/235)</option><option value="kapazitaet">nur Kapazitäten (235)</option>
                  </select>
                </td>
                <td><button className="icon-btn" title="Zeile entfernen" onClick={() => edit((l) => void l.splice(i, 1))}><Icon name="trash" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn small" onClick={() => edit((l) => void l.push({ oz: '', leistung: '', firma: '', art: 'nu' }))}><Icon name="plus" /> Unternehmen</button>
        {liste?.length === 0 ? <span className="muted">Im Vermerk: „Ein Nachunternehmereinsatz ist nicht vorgesehen.“</span>
          : !liste && <button className="link" onClick={() => edit((l) => void l.splice(0))}>Kein Nachunternehmereinsatz</button>}
        {ausKi && <button className="link" onClick={() => edit(() => {})}>Als geprüft markieren</button>}
        {o.nuQuelle === 'user' && (o.kiDocs?.length ?? 0) > 0 && <button className="link" onClick={() => up((d) => { const x = d.offers.find((y) => y.id === o.id); if (x) { delete x.nu; delete x.nuQuelle; } })}>KI-Befund wiederherstellen</button>}
      </div>
    </div>
  );
}
