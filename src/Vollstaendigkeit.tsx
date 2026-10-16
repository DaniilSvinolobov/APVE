import type { PStatus, State } from './types';
import { PSTATUS } from './types';
import { pruefStatus } from './calc';
import { uid } from './fmt';
import { Chip, Icon } from './ui';
import { useState } from 'react';
import { getKey, offerDocs, setKey } from './kiApply';

type Up = (fn: (d: State) => void) => void;

/** Prüfung auf Vollständigkeit der abgegebenen Angebotsunterlagen: Unterlagen × Angebote. */
export function Vollstaendigkeit({ s, up, ki, runKi }: { s: State; up: Up; ki: { running: boolean; text: string; error: string }; runKi: (ids: string[]) => void }) {
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyVal, setKeyVal] = useState('');
  const hasKey = !!getKey();
  void offerDocs;
  const set = (oi: number, id: string, st: PStatus | '') =>
    up((d) => { const o = d.offers[oi]; if (!o.pruef) o.pruef = {}; if (st) o.pruef[id] = { s: st, d: o.pruef[id]?.d ?? '', k: 'user' }; else delete o.pruef[id]; });
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Prüfung auf Vollständigkeit der Angebotsunterlagen</h2>
          <p className="lead">Wird als Anlage im Vergabevermerk gedruckt. Was in den Ordnern erkannt wurde, ist vorbelegt (z. B. Formular 221 aus „Nachforderung“); alles andere bitte je Zeile auswählen. Zeilen lassen sich umbenennen, löschen und ergänzen.</p>
        </div>
        <label className="mini big"><input type="checkbox" checked={s.project.vollstaendigkeit} onChange={(e) => up((d) => void (d.project.vollstaendigkeit = e.target.checked))} /> als Anlage drucken</label>
      </div>
      <div className="kibox">
        <div className="row">
          <button className="btn primary" disabled={ki.running} onClick={() => (hasKey ? runKi(s.offers.map((o) => o.id)) : setKeyOpen(true))}>
            <Icon name="sparkle" /> {ki.running ? 'Wird geprüft …' : 'Dokumente automatisch prüfen (Claude)'}
          </button>
          {hasKey && <button className="link" onClick={() => setKeyOpen((v) => !v)}>API-Key ändern</button>}
          <span className="muted">Claude öffnet jedes PDF/Scan und beurteilt: ausgefüllt? unterschrieben? Das Ergebnis trägt sich in die Tabelle ein (mit Begründung als Tooltip).</span>
        </div>
        {keyOpen && (
          <div className="keyform">
            <p className="muted">Die Dokumente werden zur Prüfung an die Anthropic-API gesendet. Der Key wird nur in Ihrem Browser gespeichert (nicht in Datensicherungen). Key erstellen unter console.anthropic.com → API Keys.</p>
            <div className="row"><input type="password" placeholder="sk-ant-…" value={keyVal} onChange={(e) => setKeyVal(e.target.value)} autoComplete="off" /><button className="btn" onClick={() => { setKey(keyVal.trim()); setKeyOpen(false); setKeyVal(''); if (keyVal.trim()) runKi(s.offers.map((o) => o.id)); }}>Speichern & prüfen</button>{hasKey && <button className="link danger" onClick={() => { setKey(''); setKeyOpen(false); }}>Key löschen</button>}</div>
          </div>
        )}
        {ki.running && <p className="infobox"><Icon name="sparkle" /> {ki.text}</p>}
        {ki.error && <p className="warnbox slim"><Icon name="alert" /> {ki.error}</p>}
        {!ki.running && ki.text && !ki.error && <p className="okbox"><Icon name="check" /> {ki.text} Bitte Ergebnisse kurz gegenprüfen – KI-Befunde sind mit „KI“ markiert und bleiben änderbar.</p>}
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
                      <button className="link" onClick={() => up((d) => { const x = d.offers[oi]; if (!x.pruef) x.pruef = {}; d.unterlagen.forEach((u) => { if (!x.pruef[u.id]) x.pruef[u.id] = { s: 'ok', d: '', k: 'user' }; }); })}>Rest = vorhanden</button>
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
                    <td key={o.id} title={p?.n}>
                      {p?.k === 'ki' && <span className="kitag" title={p.n}>KI</span>}
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
      {s.offers.some((o) => o.kiDocs?.length) && (
        <details className="det" style={{ marginTop: 14 }}>
          <summary><b>Befunde je Dokument (Claude)</b></summary>
          {s.offers.filter((o) => o.kiDocs?.length).map((o) => (
            <div key={o.id} className="kidocs"><b>Nr. {o.nr} · {o.firma}</b>
              <ul>{o.kiDocs!.map((k, i) => <li key={i}><span className="muted">{k.datei.split('/').pop()}</span> – {k.art}: <Chip kind={k.inhalt === 'ausgefuellt' ? 'ok' : k.inhalt === 'leer' ? 'bad' : 'warn'}>{k.inhalt === 'ausgefuellt' ? 'ausgefüllt' : k.inhalt}</Chip> <Chip kind={k.unterschrift === 'ja' || k.unterschrift === 'nicht_erforderlich' ? 'ok' : k.unterschrift === 'nein' ? 'bad' : 'warn'}>{k.unterschrift === 'ja' ? 'unterschrieben' : k.unterschrift === 'nein' ? 'nicht unterschrieben' : k.unterschrift === 'nicht_erforderlich' ? 'ohne Unterschrift' : 'Unterschrift unklar'}</Chip> {k.bemerkung}</li>)}</ul>
            </div>
          ))}
        </details>
      )}
      <button className="btn small" style={{ marginTop: 12 }} onClick={() => up((d) => void d.unterlagen.push({ id: uid(), label: '' }))}><Icon name="plus" /> Zeile hinzufügen</button>
      <p className="tip" style={{ marginTop: 14 }}><b>Gut zu wissen:</b> Fehlende Erklärungen oder Nachweise dürfen nachgefordert werden, bevor ein Angebot ausgeschlossen wird (§ 16a VOB/A). Ausschlüsse tragen Sie je Los im Schritt „Wertung“ ein.</p>
    </section>
  );
}
