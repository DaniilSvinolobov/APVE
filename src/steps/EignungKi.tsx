import { useEffect, useState } from 'react';
import type { Bew, Eignung, Offer, State } from '../domain/types';
import { fmtDate } from '../domain/fmt';
import { getCode, setCode } from '../ki/kiApply';
import { kiStatus, KiError, type KiStatus } from '../ki/kiPruefung';
import { eignungText, hasEignungConsent, recherchieren, referenzDocs, referenzenAuswerten, setEignungConsent, type EignungArt } from '../ki/kiEignung';
import { Chip, Icon } from '../components/ui';

type Up = (fn: (d: State) => void) => void;

export interface EignungCtx { status: KiStatus | null; consent: Record<EignungArt, boolean>; setConsent: (a: EignungArt, v: boolean) => void }

/** Status der KI auf dieser Installation und die beiden Einwilligungen (Referenzen, Recherche). */
export function useEignung(): EignungCtx {
  const [status, setStatus] = useState<KiStatus | null>(null);
  const [consent, setC] = useState({ referenzen: hasEignungConsent('referenzen'), recherche: hasEignungConsent('recherche') });
  useEffect(() => { kiStatus().then(setStatus); }, []);
  return { status, consent, setConsent: (a, v) => { setEignungConsent(a, v); setC((c) => ({ ...c, [a]: v })); } };
}

/** Einwilligungen für die KI-Eignungsprüfung – einmal oberhalb der Bieterkarten. */
export function EignungEinwilligung({ ctx }: { ctx: EignungCtx }) {
  const [codeVal, setCodeVal] = useState('');
  const [, rerender] = useState(0);
  if (!ctx.status?.enabled) return null;
  const needCode = ctx.status.code && !getCode() && (ctx.consent.referenzen || ctx.consent.recherche);
  return (
    <div className="kibox">
      <b>Eignung mit KI prüfen (optional)</b>
      <p className="muted" style={{ margin: '6px 0 8px' }}>Die KI von NodeArq wertet auf Knopfdruck die Referenzen eines Bieters aus und recherchiert öffentliche Informationen zum Unternehmen. Jede Funktion einzeln aktivieren. Details: <a href="/datenschutz.html" target="_blank" rel="noreferrer">Datenschutzhinweise</a>.</p>
      <label className="mini big consent"><input type="checkbox" checked={ctx.consent.referenzen} onChange={(e) => ctx.setConsent('referenzen', e.target.checked)} /> <span><b>Referenzen auswerten:</b> die KI liest die Referenzunterlagen des Bieters.</span></label>
      <label className="mini big consent"><input type="checkbox" checked={ctx.consent.recherche} onChange={(e) => ctx.setConsent('recherche', e.target.checked)} /> <span><b>Im Internet recherchieren:</b> die KI sucht nur mit Firmenname, Ort und Losbezeichnungen.</span></label>
      {needCode && (
        <div className="keyform">
          <p className="muted">Zugangscode des Betreibers eingeben (einmalig):</p>
          <div className="row"><input type="password" value={codeVal} onChange={(e) => setCodeVal(e.target.value)} autoComplete="off" /><button className="btn" onClick={() => { setCode(codeVal.trim()); setCodeVal(''); rerender((n) => n + 1); }}>OK</button></div>
        </div>
      )}
    </div>
  );
}

const VGL: Record<string, 'ok' | 'info' | 'warn' | 'bad'> = { ja: 'ok', teilweise: 'info', nein: 'bad', unklar: 'warn' };

/** Referenzauswertung und Recherche für einen Bieter, mit Übernahme in „Qualifikation / Referenzen“. */
export function EignungKi({ s, up, o, b, setBew, ctx }: { s: State; up: Up; o: Offer; b: Bew; setBew: (patch: Partial<Bew>) => void; ctx: EignungCtx }) {
  const [busy, setBusy] = useState<EignungArt | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!ctx.status?.enabled || !(ctx.consent.referenzen || ctx.consent.recherche)) return null;
  const e = o.eignung;
  const docs = referenzDocs(o);
  const blocked = ctx.status.code && !getCode();

  // Ergebnis automatisch in „Qualifikation / Referenzen“ eintragen – solange das Feld leer ist oder nur den bisherigen KI-Text enthält
  const vorbelegen = (neu: Eignung) => {
    const cur = b.qualifikation.trim();
    if (!cur || cur === eignungText(o.eignung)) setBew({ qualifikation: eignungText(neu) });
  };
  const run = async (art: EignungArt) => {
    setBusy(art); setMsg(null);
    try {
      if (art === 'referenzen') {
        const { ergebnis, ausgelassen, grund } = await referenzenAuswerten(s, o, getCode());
        up((d) => { const x = d.offers.find((y) => y.id === o.id); if (x) x.eignung = { ...x.eignung, referenzen: ergebnis }; });
        vorbelegen({ ...o.eignung, referenzen: ergebnis });
        setMsg({ ok: !ausgelassen.length, text: `${ergebnis.liste.length} Referenz(en) ausgewertet.${ausgelassen.length ? ` Nicht ausgewertet, bitte manuell prüfen: ${ausgelassen.join(', ')}${grund ? ` (${grund})` : ''}.` : ''}` });
      } else {
        const r = await recherchieren(s, o, getCode());
        up((d) => { const x = d.offers.find((y) => y.id === o.id); if (x) x.eignung = { ...x.eignung, recherche: r }; });
        vorbelegen({ ...o.eignung, recherche: r });
        setMsg({ ok: true, text: `Recherche abgeschlossen (${r.quellen.length} Quelle(n)).` });
      }
    } catch (err) {
      if (err instanceof KiError && err.status === 401) setCode('');
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Fehler bei der KI-Prüfung.' });
    } finally { setBusy(null); }
  };
  const text = eignungText(e);

  return (
    <div className="eignung">
      <div className="row">
        {ctx.consent.referenzen && (
          <button className="btn" disabled={!!busy || blocked || !docs.length} onClick={() => run('referenzen')} title={docs.length ? docs.map((d) => d.name).join('\n') : 'Keine Referenzunterlagen im Arbeitsspeicher – Angebotsordner in Schritt 2 (erneut) laden.'}>
            <Icon name="sparkle" /> {busy === 'referenzen' ? 'Wird ausgewertet …' : `Referenzen auswerten (${docs.length} Datei${docs.length === 1 ? '' : 'en'})`}
          </button>
        )}
        {ctx.consent.recherche && (
          <button className="btn" disabled={!!busy || blocked || !o.firma.trim()} onClick={() => run('recherche')}>
            <Icon name="sparkle" /> {busy === 'recherche' ? 'Recherche läuft …' : 'Im Internet recherchieren'}
          </button>
        )}
        {text && <button className="btn primary" disabled={b.qualifikation.includes(text)} onClick={() => setBew({ qualifikation: b.qualifikation.trim() ? `${b.qualifikation.trim()}\n${text}` : text })}><Icon name="arrow" /> In „Qualifikation / Referenzen“ übernehmen</button>}
      </div>
      {ctx.consent.referenzen && !docs.length && <p className="muted small">Keine Referenzunterlagen im Arbeitsspeicher. Dateien mit „Referenz“ im Namen (oder von der KI-Dokumentprüfung als Referenz erkannte) werden ausgewertet – nach einem Neuladen der Seite den Angebotsordner in Schritt 2 erneut laden.</p>}
      {msg && <p className={msg.ok ? 'okbox slim' : 'warnbox slim'}><Icon name={msg.ok ? 'check' : 'alert'} /> {msg.text}</p>}

      {e?.referenzen && (
        <details className="det" open>
          <summary><Chip kind="info">KI</Chip> Referenzen laut Unterlagen ({e.referenzen.liste.length}) · Stand {fmtDate(e.referenzen.stand.slice(0, 10))}</summary>
          {e.referenzen.liste.length > 0 && (
            <div className="scroll">
              <table className="matrix reftab">
                <thead><tr><th className="left">Projekt</th><th className="left">Auftraggeber / Ort</th><th className="left">Zeitraum</th><th className="left">Summe</th><th className="left">Vergleichbar</th></tr></thead>
                <tbody>{e.referenzen.liste.map((r, i) => (
                  <tr key={i}>
                    <td className="left"><b>{r.projekt || '–'}</b><small className="muted block">{r.leistungen}</small></td>
                    <td className="left">{[r.auftraggeber, r.ort].filter(Boolean).join(', ') || '–'}</td>
                    <td className="left">{r.zeitraum || '–'}</td>
                    <td className="left">{r.auftragssumme || '–'}</td>
                    <td className="left"><Chip kind={VGL[r.vergleichbar] ?? 'info'}>{r.vergleichbar}</Chip><small className="muted block">{r.begruendung}</small></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {e.referenzen.hinweise.length > 0 && <ul className="hinweise">{e.referenzen.hinweise.map((h, i) => <li key={i}>{h}</li>)}</ul>}
          {e.referenzen.fazit && <p className="prev">{e.referenzen.fazit}</p>}
        </details>
      )}
      {e?.recherche && (
        <details className="det" open>
          <summary><Chip kind="info">KI</Chip> Öffentlich zugängliche Informationen · Stand {fmtDate(e.recherche.stand.slice(0, 10))}</summary>
          {e.recherche.profil ? <Profil p={e.recherche.profil} /> : <p className="prev">{e.recherche.text || 'Keine Angaben gefunden.'}</p>}
          {e.recherche.quellen.length > 0 && <p className="muted quellen">Quellen: {quellenNachSeite(e.recherche.quellen).map((q, i) => <a key={i} href={q.url} target="_blank" rel="noreferrer noopener" title={q.titel}>{q.host}</a>)}</p>}
        </details>
      )}
      {(e?.referenzen || e?.recherche) && <p className="muted small">KI-Ergebnisse vor der Übernahme prüfen; sie ersetzen keine eigene Eignungsprüfung.</p>}
    </div>
  );
}

/** Recherche in Abschnitten: Kurzfassung, Eckdaten, Leistungen, Referenzen, Einschätzung, offene Punkte. */
function Profil({ p }: { p: NonNullable<NonNullable<Eignung['recherche']>['profil']> }) {
  return (
    <div className="profil">
      <p className="prev">{p.vermerk}</p>
      {p.fakten.length > 0 && <dl className="fakten">{p.fakten.map((f, i) => <div key={i}><dt>{f.k}</dt><dd>{f.v}</dd></div>)}</dl>}
      {p.leistungen.length > 0 && <div className="pblock"><b>Leistungen</b><div className="chips">{p.leistungen.map((l, i) => <Chip key={i} kind="info">{l}</Chip>)}</div></div>}
      {p.referenzen.length > 0 && <div className="pblock"><b>Referenzen (öffentlich dargestellt)</b><ul className="hinweise">{p.referenzen.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
      {p.vergleichbarkeit && <div className="pblock"><b>Vergleichbarkeit mit den Losen</b><p>{p.vergleichbarkeit}</p></div>}
      {p.offen.length > 0 && <div className="pblock"><b>Nicht gefunden / im Verfahren nachweisen</b><ul className="hinweise">{p.offen.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
    </div>
  );
}

/** Je Internetseite nur eine Quelle, angezeigt mit dem Seitennamen statt langer Titel. */
function quellenNachSeite(qs: { url: string; titel: string }[]) {
  const out = new Map<string, { url: string; titel: string; host: string }>();
  for (const q of qs) {
    let host = q.url;
    try { host = new URL(q.url).hostname.replace(/^www\./, ''); } catch { /* ungültige URL: so anzeigen */ }
    if (!out.has(host)) out.set(host, { ...q, host });
  }
  return [...out.values()];
}
