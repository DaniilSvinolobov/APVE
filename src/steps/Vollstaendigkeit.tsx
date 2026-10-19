import type { PStatus, State } from '../domain/types';
import { PSTATUS } from '../domain/types';
import { pruefStatus } from '../domain/calc';
import { uid } from '../domain/fmt';
import { Chip, Icon } from '../components/ui';
import { useState } from 'react';
import { getCode, hasConsent, setCode, setConsent } from '../ki/kiApply';
import type { KiStatus } from '../ki/kiPruefung';

type Up = (fn: (d: State) => void) => void;

/** Prüfung auf Vollständigkeit der abgegebenen Angebotsunterlagen: Unterlagen × Angebote. */
export function Vollstaendigkeit({ s, up, ki, runKi, status }: { s: State; up: Up; ki: { running: boolean; text: string; error: string }; runKi: (ids: string[]) => void; status: KiStatus | null }) {
  const [codeVal, setCodeVal] = useState('');
  const needCode = !!status?.code && !getCode();
  const [consent, setConsentState] = useState(hasConsent());
  const set = (oi: number, id: string, st: PStatus | '') =>
    up((d) => { const o = d.offers[oi]; if (!o.pruef) o.pruef = {}; if (st) o.pruef[id] = { s: st, d: o.pruef[id]?.d ?? '', k: 'user' }; else delete o.pruef[id]; });
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Prüfung auf Vollständigkeit der Angebotsunterlagen</h2>
          <p className="lead">Anlage zum Vermerk. Erkanntes ist vorbelegt, den Rest je Zeile auswählen.</p>
        </div>
        <label className="mini big"><input type="checkbox" checked={s.project.vollstaendigkeit} onChange={(e) => up((d) => void (d.project.vollstaendigkeit = e.target.checked))} /> als Anlage drucken</label>
      </div>
      {status?.enabled && !consent ? (
        <div className="kibox">
          <b>Automatische Dokumentprüfung (optional)</b>
          <p className="muted" style={{ margin: '6px 0 10px' }}>
            Wenn Sie die Prüfung aktivieren, werden die <b>Formulare und Erklärungen</b> der Angebote (Angebotsschreiben, Eignungsfragebogen, Nachforderungen, Nachunternehmerverzeichnis) als PDF über den Server dieser Anwendung (Frankfurt) an die <b>Anthropic-API (USA)</b> übermittelt und dort mit KI ausgewertet. Die Dokumente können personenbezogene Daten enthalten (z. B. Namen, Unterschriften). Meisterbriefe, Referenzen, Versicherungs- und Präqualifikationsnachweise werden <b>nicht</b> übermittelt (Referenzen nur über die gesonderte Referenzauswertung in der Wertung). Alles andere bleibt in Ihrem Browser. Details: <a href="/datenschutz.html" target="_blank" rel="noreferrer">Datenschutzhinweise</a>. Bitte nur aktivieren, wenn dies mit Ihren Vertraulichkeits- und Datenschutzvorgaben vereinbar ist.
          </p>
          <button className="btn primary" onClick={() => { setConsent(true); setConsentState(true); runKi(s.offers.map((o) => o.id)); }}>Verstanden – Prüfung aktivieren</button>
        </div>
      ) : status?.enabled ? (
        <div className="kibox">
          <div className="row">
            <button className="btn primary" disabled={ki.running || needCode} onClick={() => runKi(s.offers.map((o) => o.id))}>
              <Icon name="sparkle" /> {ki.running ? 'Wird geprüft …' : 'Dokumente automatisch prüfen (Claude)'}
            </button>
            <span className="muted">Beim Einlesen läuft die Prüfung automatisch: Claude öffnet jedes Formular und beurteilt, ob es ausgefüllt und unterschrieben ist.</span>
            <button className="link danger" onClick={() => { setConsent(false); setConsentState(false); }}>Prüfung deaktivieren</button>
          </div>
          {needCode && (
            <div className="keyform">
              <p className="muted">Zugangscode des Betreibers eingeben (einmalig):</p>
              <div className="row"><input type="password" value={codeVal} onChange={(e) => setCodeVal(e.target.value)} autoComplete="off" /><button className="btn" onClick={() => { setCode(codeVal.trim()); setCodeVal(''); runKi(s.offers.map((o) => o.id)); }}>OK</button></div>
            </div>
          )}
          {ki.running && <p className="infobox"><Icon name="sparkle" /> {ki.text}</p>}
          {ki.error && <p className="warnbox slim"><Icon name="alert" /> {ki.error}</p>}
          {!ki.running && ki.text && <p className="okbox"><Icon name="check" /> {ki.text} Bitte Ergebnisse kurz gegenprüfen – KI-Befunde sind mit „KI“ markiert und bleiben änderbar.</p>}
        </div>
      ) : status && (
        <p className="infobox" style={{ marginBottom: 14 }}><Icon name="alert" /> Die automatische Dokumentprüfung ist auf dieser Installation nicht aktiviert. Die Tabelle wird anhand der Dateinamen vorbelegt; Inhalt und Unterschrift bitte selbst prüfen.</p>
      )}
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
                    {ps.fehlt.length > 0 ? <Chip kind="bad">{ps.fehlt.length} fehlt</Chip> : ps.nurPdf.length > 0 ? <Chip kind="warn">Preise nur als PDF</Chip> : ps.ungeprueft > 0 ? <Chip kind="warn">{ps.ungeprueft} offen</Chip> : <Chip kind="ok">vollständig</Chip>}
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
