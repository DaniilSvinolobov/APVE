import type { HsEintrag, PStatus, State } from '../domain/types';
import { PSTATUS } from '../domain/types';
import { pruefStatus } from '../domain/calc';
import { uid } from '../domain/fmt';
import { Chip, Icon } from '../components/ui';
import { useState } from 'react';
import { getCode, hasConsent, mitStempel, setCode, setConsent } from '../ki/kiApply';
import type { KiStatus } from '../ki/kiPruefung';

type Up = (fn: (d: State) => void) => void;

type KiBefund = NonNullable<State['offers'][number]['kiDocs']>[number];
/** Dokumente, die der Nutzer zuerst ansehen sollte: nicht vollständig ausgefüllt, nicht unterschrieben, unklar oder unsicher. */
const auffaellig = (k: KiBefund) => k.inhalt !== 'ausgefuellt' || k.unterschrift === 'nein' || k.unterschrift === 'unklar' || k.sicherheit === 'niedrig';

/** Prüfung auf Vollständigkeit der abgegebenen Angebotsunterlagen: Unterlagen × Angebote. */
export function Vollstaendigkeit({ s, up, ki, runKi, status }: { s: State; up: Up; ki: { running: boolean; text: string; error: string }; runKi: (ids: string[]) => void; status: KiStatus | null }) {
  const [codeVal, setCodeVal] = useState('');
  const needCode = !!status?.code && !getCode();
  const [consent, setConsentState] = useState(hasConsent());
  // Nach einem abgebrochenen oder teilweise gescheiterten Lauf nur die noch fehlenden Angebote prüfen, nicht wieder alle
  const offen = s.offers.filter((o) => !(o.kiInfo?.s === 'ok' || o.kiDocs)).map((o) => o.id);
  const nurOffene = offen.length > 0 && offen.length < s.offers.length;
  const set = (oi: number, id: string, st: PStatus | '') =>
    up((d) => { const o = d.offers[oi]; if (!o.pruef) o.pruef = {}; if (st) o.pruef[id] = { s: st, d: o.pruef[id]?.d ?? '', k: 'user' }; else delete o.pruef[id]; });
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Prüfung auf Vollständigkeit der Angebotsunterlagen</h2>
          <p className="lead">Anlage zum Vermerk. Erkanntes ist vorbelegt.</p>
        </div>
        <label className="mini big"><input type="checkbox" checked={s.project.vollstaendigkeit} onChange={(e) => up((d) => void (d.project.vollstaendigkeit = e.target.checked))} /> als Anlage drucken</label>
      </div>
      {status?.enabled && !consent ? (
        <div className="kibox">
          <b>Automatische Dokumentprüfung (optional)</b>
          <p className="muted" style={{ margin: '6px 0 10px' }}>
            Wenn Sie die Prüfung aktivieren, werden <b>alle Unterlagen</b> der Angebote (PDFs, Scans und Fotos – auch Meisterbriefe, Referenzen, Versicherungs- und Präqualifikationsnachweise sowie das LV mit Preisen) über den Server dieser Anwendung (Frankfurt) an <b>Claude bei Amazon Bedrock in der EU (Frankfurt)</b> übermittelt und dort mit KI ausgewertet, auch handschriftliche Eintragungen. Große Dateien werden dafür im Browser in Teile zerlegt. Die Dokumente enthalten personenbezogene Daten (z. B. Namen, Unterschriften, Qualifikationsnachweise). Ihre Projektdaten bleiben in Ihrem Browser. Details: <a href="/datenschutz.html" target="_blank" rel="noreferrer">Datenschutzhinweise</a>. Bitte nur aktivieren, wenn dies mit Ihren Vertraulichkeits- und Datenschutzvorgaben vereinbar ist.
          </p>
          <button className="btn primary" onClick={() => { setConsent(true); setConsentState(true); runKi(s.offers.map((o) => o.id)); }}>Verstanden – Prüfung aktivieren</button>
        </div>
      ) : status?.enabled ? (
        <div className="kibox">
          <div className="row">
            <button className="btn primary" disabled={ki.running || needCode} onClick={() => runKi(nurOffene ? offen : s.offers.map((o) => o.id))}>
              <Icon name="sparkle" /> {ki.running ? 'Wird geprüft …' : nurOffene ? `Noch nicht geprüfte Angebote prüfen (${offen.length})` : 'Dokumente automatisch prüfen (Claude)'}
            </button>
            <span className="muted">Läuft beim Einlesen automatisch; unsichere Befunde bleiben offen.</span>
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
        <p className="infobox" style={{ marginBottom: 14 }}><Icon name="alert" /> Vorbelegt anhand der Dateinamen – Inhalt und Unterschrift bitte selbst prüfen.</p>
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
                    <div className="vfirma">{o.nr} · {o.firma}</div>
                    {ps.fehlt.length > 0 ? <Chip kind="bad">{ps.fehlt.length} fehlt</Chip> : ps.nurPdf.length > 0 ? <Chip kind="warn">Preise nur als PDF</Chip> : ps.ungeprueft > 0 ? <Chip kind="warn">{ps.ungeprueft} offen</Chip> : <Chip kind="ok">vollständig</Chip>}
                    {status?.enabled && consent && (o.kiInfo?.s === 'ok' || o.kiDocs
                      ? <div className="muted" style={{ fontSize: 11, marginTop: 4 }} title={o.kiInfo?.t || undefined}>KI geprüft{o.kiInfo?.t ? ' (mit Hinweis)' : ''}</div>
                      : o.kiInfo
                        ? <div style={{ fontSize: 11, marginTop: 4, color: '#b42318' }} title={o.kiInfo.t}>KI: {o.kiInfo.s === 'skip' ? 'übersprungen' : 'Fehler'} – {o.kiInfo.t.slice(0, 80)}</div>
                        : <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>KI: noch nicht geprüft</div>)}
                    {ps.ungeprueft > 0 && <div><button className="link small" title="Alle noch offenen Zeilen dieses Angebots auf „vorhanden“ setzen" onClick={() => up((d) => { const x = d.offers[oi]; if (!x.pruef) x.pruef = {}; d.unterlagen.forEach((u) => { if (!x.pruef[u.id]) x.pruef[u.id] = { s: 'ok', d: '', k: 'user' }; }); })}>offene = vorhanden</button></div>}
                  </th>
                );
              })}
              <th />
            </tr>
          </thead>
          <tbody>
            {s.unterlagen.map((u, ui) => (
              <tr key={u.id}>
                <td className="left"><textarea className="plain wide vlabel" rows={1} value={u.label} onChange={(e) => up((d) => void (d.unterlagen[ui].label = e.target.value))} aria-label="Unterlage / Prüfpunkt" /></td>
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
      {s.offers.some((o) => o.kiDocs?.length) && <KiBefunde s={s} />}
      <button className="btn small" style={{ marginTop: 12 }} onClick={() => up((d) => void d.unterlagen.push({ id: uid(), label: '' }))}><Icon name="plus" /> Zeile hinzufügen</button>
      <p className="tip" style={{ marginTop: 14 }}><b>Gut zu wissen:</b> Fehlende Erklärungen oder Nachweise dürfen nachgefordert werden, bevor ein Angebot ausgeschlossen wird (§ 16a VOB/A). Ausschlüsse tragen Sie je Los im Schritt „Wertung“ ein.</p>
    </section>
  );
}

const byName = (x: KiBefund, y: KiBefund) => x.datei.localeCompare(y.datei, 'de', { numeric: true });
const kurz = (k: KiBefund) => k.datei.split('/').pop() ?? k.datei;
const inhaltChip = (k: KiBefund) => <Chip kind={k.inhalt === 'ausgefuellt' ? 'ok' : k.inhalt === 'leer' ? 'bad' : 'warn'}>{k.inhalt === 'ausgefuellt' ? 'ausgefüllt' : k.inhalt}</Chip>;
const unterschriftChip = (k: KiBefund) => (
  <>
    <Chip kind={k.unterschrift === 'ja' ? 'ok' : k.unterschrift === 'nein' ? 'bad' : k.unterschrift === 'nicht_erforderlich' ? 'info' : 'warn'}>{k.unterschrift === 'ja' ? 'unterschrieben' : k.unterschrift === 'nein' ? 'nicht unterschrieben' : k.unterschrift === 'nicht_erforderlich' ? 'keine Unterschrift nötig' : 'unklar'}</Chip>
    {k.stempel && <div className="muted" style={{ fontSize: 11 }}>mit Firmenstempel</div>}
  </>
);

/**
 * Leere Vorlage, die durch eine ausgefüllte Fassung ersetzt ist: ein Bieter gibt oft das leere Formblatt der Vergabestelle
 * zusätzlich zum ausgefüllten ab. Solche Dateien werden nicht gewertet und nicht als auffällig gezählt.
 * Liefert die Namen der ausgefüllten Dokumente, sonst null (dann bleibt die leere Datei ein echter Befund).
 */
function ersetztDurch(k: KiBefund, docs: KiBefund[]): string[] | null {
  if (!(k.vorlage || k.inhalt === 'leer') || k.unterschrift === 'ja' || !k.zeilen?.length) return null;
  const voll = (x: KiBefund) => x !== k && !x.vorlage && x.inhalt !== 'leer';
  const durch = new Set<string>();
  for (const z of k.zeilen) {
    const andere = docs.filter((x) => voll(x) && x.zeilen?.includes(z));
    if (!andere.length) return null;
    andere.forEach((x) => durch.add(kurz(x)));
  }
  // bevorzugt die Fassung nennen, die alle Prüfpunkte der Vorlage abdeckt (z. B. 213.pdf statt jedes unterschriebenen Dokuments)
  const passend = docs.filter((x) => voll(x) && k.zeilen!.every((z) => x.zeilen?.includes(z))).map(kurz);
  return passend.length ? passend : [...durch];
}

/** Handschrift als Liste; ältere Befunde („S. 1: Ort ‚…'; S. 2: …“) werden in Einträge zerlegt. */
function hsEintraege(h: KiBefund['handschrift']): HsEintrag[] {
  if (!h) return [];
  if (Array.isArray(h)) return h;
  const out: HsEintrag[] = [];
  let seite: number | undefined;
  for (const teil of h.split(/;\s*/)) {
    const m = /^\s*S\.\s*(\d+)\s*:\s*(.*)$/s.exec(teil);
    if (m) seite = Number(m[1]);
    const rest = (m ? m[2] : teil).trim();
    if (!rest) continue;
    const f = /^([^‚'"„]{1,40}?)\s+[‚'"„](.*?)['‘"“]?$/s.exec(rest);
    out.push(f ? { seite, feld: f[1].trim(), wert: f[2].trim() } : { seite, feld: '', wert: rest });
  }
  return out;
}

/** Handschriftliche Eintragungen übersichtlich: je Seite eine Gruppe, je Eintrag Feld und Wert. */
function Handschrift({ h }: { h: KiBefund['handschrift'] }) {
  const es = hsEintraege(h);
  if (!es.length) return null;
  const seiten = [...new Set(es.map((e) => e.seite ?? 0))].sort((a, b) => a - b);
  return (
    <details className="hs">
      <summary>Handschrift anzeigen ({es.length} {es.length === 1 ? 'Eintragung' : 'Eintragungen'})</summary>
      <table className="hstab">
        <colgroup><col className="s" /><col className="f" /><col /></colgroup>
        <tbody>
          {seiten.flatMap((sn) => {
            const auf = es.filter((e) => (e.seite ?? 0) === sn);
            return auf.map((e, i) => (
              <tr key={`${sn}-${i}`} className={i === 0 ? 'neu' : ''}>
                {i === 0 && <th rowSpan={auf.length}>{sn ? `S. ${sn}` : '–'}</th>}
                <td className="feld">{e.feld || '–'}</td>
                <td>{e.wert}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </details>
  );
}

/** Befunde der KI in der Reihenfolge der Prüfpunkte oben, je Angebot. */
function KiBefunde({ s }: { s: State }) {
  const mit = s.offers.filter((o) => o.kiDocs?.length);
  const [sel, setSel] = useState('');
  const o = mit.find((x) => x.id === sel) ?? mit[0];
  if (!o) return null;
  const docs = o.kiDocs!.map(mitStempel);
  const bekannt = new Set(s.unterlagen.map((u) => u.id));
  const ersetzt = new Map(docs.flatMap((k) => { const d = ersetztDurch(k, docs); return d ? [[k, d] as const] : []; }));
  const aktiv = docs.filter((k) => !ersetzt.has(k));
  const rest = aktiv.filter((k) => !k.zeilen?.some((z) => bekannt.has(z))).sort(byName);
  const n = aktiv.filter(auffaellig).length;
  const zeile = (k: KiBefund, key: string, erste?: React.ReactNode) => (
    <tr key={key} className={ersetzt.has(k) ? 'kivorlage' : auffaellig(k) ? 'kiauff' : ''}>
      {erste}
      <td className="name">{kurz(k)}<div className="muted">{k.art}</div></td>
      <td>{inhaltChip(k)}</td>
      <td>{unterschriftChip(k)}</td>
      <td>
        {k.sicherheit === 'niedrig' && <Chip kind="warn">unsicher – bitte prüfen</Chip>}
        {ersetzt.has(k) && <Chip kind="info">leere Vorlage – ersetzt durch {ersetzt.get(k)!.join(', ')}</Chip>}
        {k.bemerkung}
        <Handschrift h={k.handschrift} />
      </td>
    </tr>
  );
  return (
    <details className="det" style={{ marginTop: 14 }} open>
      <summary><b>Befunde je Dokument (Claude)</b></summary>
      <div className="row" style={{ margin: '10px 0' }}>
        {mit.map((x) => <button key={x.id} className={`pill btnpill ${x.id === o.id ? 'on' : ''}`} onClick={() => setSel(x.id)}>Nr. {x.nr} · {x.firma}</button>)}
      </div>
      <div className="kihead"><span className="muted">{aktiv.length} Dokumente{ersetzt.size > 0 && ` (+ ${ersetzt.size} leere ${ersetzt.size === 1 ? 'Vorlage' : 'Vorlagen'})`}</span> {n > 0 ? <Chip kind="warn">{n} auffällig</Chip> : <Chip kind="ok">keine Auffälligkeiten</Chip>}</div>
      <table className="kitab">
        <thead><tr><th>Prüfpunkt</th><th>Dokument</th><th>Inhalt</th><th>Unterschrift</th><th>Hinweis</th></tr></thead>
        <tbody>
          {s.unterlagen.map((u) => {
            const ds = aktiv.filter((k) => k.zeilen?.includes(u.id)).sort(byName);
            if (!ds.length) return <tr key={u.id} className="kileer"><td className="zeile">{u.label}</td><td colSpan={4}>{o.pruef?.[u.id]?.s === 'entf' ? 'entfällt' : 'kein Dokument zugeordnet'}</td></tr>;
            return ds.map((k, i) => zeile(k, `${u.id}-${i}`, i === 0 ? <td className="zeile" rowSpan={ds.length}>{u.label}</td> : undefined));
          })}
          {rest.length > 0 && <tr className="kirest"><th colSpan={5}>Weitere Dokumente ohne Zuordnung zu einem Prüfpunkt</th></tr>}
          {rest.map((k, i) => zeile(k, `rest-${i}`, <td />))}
          {ersetzt.size > 0 && <tr className="kirest"><th colSpan={5}>Leere Vorlagen der Vergabeunterlagen – durch ausgefüllte Fassung ersetzt, nicht gewertet</th></tr>}
          {[...ersetzt.keys()].sort(byName).map((k, i) => zeile(k, `vorl-${i}`, <td />))}
        </tbody>
      </table>
    </details>
  );
}
