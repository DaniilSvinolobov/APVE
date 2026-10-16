import { useEffect, useRef, useState } from 'react';
import type { State } from '../domain/types';
import { Vollstaendigkeit } from './Vollstaendigkeit';
import { expandZips, type RawFile } from '../import/zip';
import { groupBids, isLvFile } from '../import/files';
import { analyzeGroup } from '../import/analyze';
import { applyOffer } from '../import/apply';
import { docStore } from '../import/docStore';
import { applyKi, getCode, hasConsent, offerDocs, setCode } from '../ki/kiApply';
import { kiStatus, KiError, pruefeAngebot, type KiStatus } from '../ki/kiPruefung';
import { computeLos } from '../domain/calc';
import { fmtDate, fmtNum } from '../domain/fmt';
import { DropZone } from '../components/DropZone';
import { Chip, Icon, Seg } from '../components/ui';

type Up = (fn: (d: State) => void) => void;

export function StepUnterlagen({ s, up }: { s: State; up: Up }) {
  const [busy, setBusy] = useState(false);
  const [ki, setKi] = useState<{ running: boolean; text: string; error: string }>({ running: false, text: '', error: '' });
  const sRef = useRef(s);
  sRef.current = s;

  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [status, setStatus] = useState<KiStatus | null>(null);
  useEffect(() => { kiStatus().then(setStatus); }, []);
  const statusRef = useRef(status);
  statusRef.current = status;

  /** Dokumente der Angebote mit Claude prüfen (Eintragung in die Vollständigkeitstabelle). */
  const runKi = async (offerIds: string[]) => {
    const st = statusRef.current;
    if (!st?.enabled || !hasConsent()) return;
    if (st.code && !getCode()) { setKi({ running: false, text: '', error: 'Bitte den Zugangscode eingeben.' }); return; }
    setKi({ running: true, text: 'Dokumente werden geprüft …', error: '' });
    try {
      const notes: string[] = [];
      for (const id of offerIds) {
        const o = sRef.current.offers.find((x) => x.id === id);
        if (!o) continue;
        const docs = offerDocs(o);
        if (!docs.length) { notes.push(`Nr. ${o.nr}: Originaldateien nicht mehr verfügbar – bitte den Ordner erneut einlesen.`); continue; }
        const { results, zuGross } = await pruefeAngebot(docs, sRef.current.unterlagen, getCode(), (t) => setKi((k) => ({ ...k, text: `Nr. ${o.nr} ${o.firma}: ${t}` })));
        up((d) => applyKi(d, id, results));
        if (zuGross.length) notes.push(`Nr. ${o.nr}: zu groß für die automatische Prüfung (bitte manuell ansehen): ${zuGross.map((z) => z.split('/').pop()).join(', ')}`);
      }
      setKi({ running: false, text: 'Prüfung abgeschlossen.', error: notes.join(' · ') });
    } catch (e) {
      if (e instanceof KiError && e.status === 401) setCode('');
      setKi({ running: false, text: '', error: e instanceof Error ? e.message : String(e) });
    }
  };

  /** Feld 2: Angebote der Bieter (GAEB 84 samt Nachweisen) laden. */
  const processBids = async (raw: RawFile[]) => {
    setBusy(true); setMsg(null);
    try {
      const files = await expandZips(raw);
      const groups = groupBids(files);
      const parsed = groups.map((g, i) => analyzeGroup(g, s.offers.length + i + 1)).filter((x): x is NonNullable<typeof x> => !!x);
      if (!parsed.length) {
        setMsg({ ok: false, text: files.some((f) => isLvFile(f.path)) ? 'Das sind LV-Dateien ohne Preise (x81/x82/x83) – das eigene LV gehört in den Schritt „Vergabe“.' : 'Keine Angebote erkannt (.x84/.p84/.d84, oder .x83/.p83/.d83 mit Preisen). PDF-Dateien allein können nicht ausgewertet werden.' });
      } else {
        parsed.forEach((p) => docStore.set(p.offer.id, p.docs));
        up((d) => parsed.forEach((p) => applyOffer(d, p)));
        setTimeout(() => runKi(parsed.map((p) => p.offer.id)), 50);
        setMsg({ ok: true, text: `${parsed.length} Angebot(e) eingelesen: ${parsed.map((p) => p.offer.firma).join(', ')}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: `Fehler beim Einlesen: ${(e as Error).message}` });
    }
    setBusy(false);
  };

  const hasLv = s.lv.length > 0;
  const setOffer = (i: number, fn: (o: State['offers'][number]) => void) => up((d) => fn(d.offers[i]));

  return (
    <div className="stack">
      {!hasLv && <p className="infobox"><Icon name="alert" /> Das eigene LV fehlt noch – bitte im Schritt „Vergabe“ laden. Ohne LV wird es aus der ersten Bieterdatei abgeleitet (ohne Texte und Mengen der Ausschreibung).</p>}

      <section className="card" id="bieter-card">
        <h2>Angebote der Bieter</h2>
        <p className="lead">Angebotsordner oder ZIP-Dateien der Bieter, so unsortiert wie sie ankommen (GAEB X84/P84/D84 samt Nachweisen). Mehrere Bieter gleichzeitig möglich, verschachtelte ZIPs werden entpackt.{!hasLv && ' Das eigene LV wird im Schritt „Vergabe“ geladen.'}</p>
        <DropZone busy={busy} onFiles={processBids} title="Ordner oder ZIP-Dateien der Bieter hierher ziehen" hint="Daten verlassen Ihren Browser nicht" folder />
        {msg && <p className={msg.ok ? 'okbox' : 'warnbox'}><Icon name={msg.ok ? 'check' : 'alert'} /> {msg.text}</p>}
        <div className="status"><Chip kind={s.offers.length ? 'ok' : 'info'}>{s.offers.length} Angebot(e) geladen</Chip></div>
      </section>

      {s.offers.map((o, i) => {
        const cells = s.lose.map((l) => computeLos(s, l).find((c) => c.offer.id === o.id)).filter(Boolean);
        const kats = Object.entries(o.dateien.reduce<Record<string, number>>((a, d) => ({ ...a, [d.kat]: (a[d.kat] ?? 0) + 1 }), {}));
        return (
          <section className="card offer" key={o.id}>
            <div className="offer-head">
              <label className="nrbox">Angebot Nr.<input value={o.nr} onChange={(e) => setOffer(i, (x) => void (x.nr = Number(e.target.value) || 0))} /></label>
              <div className="grow">
                <input className="firma" value={o.firma} onChange={(e) => setOffer(i, (x) => void (x.firma = e.target.value))} placeholder="Firmenname" />
                <div className="row sub"><input className="ort" value={o.ort} onChange={(e) => setOffer(i, (x) => void (x.ort = e.target.value))} placeholder="Ort" /><span className="muted">Angebot vom {fmtDate(o.datum)} · Quelle: {o.quelle}</span></div>
              </div>
              <button className="icon-btn" title="Angebot entfernen" onClick={() => up((d) => void d.offers.splice(i, 1))}><Icon name="trash" /></button>
            </div>
            <div className="offer-grid">
              <div>
                <span className="field-label">Runde</span>
                <Seg small value={o.runde} onChange={(v) => setOffer(i, (x) => void (x.runde = v as 1 | 2 | 3))} options={[{ value: 1, label: 'Hauptangebot' }, { value: 2, label: 'Nachverhandlung' }]} />
              </div>
              <div>
                <span className="field-label">Angebot gilt für</span>
                <div className="row">{s.lose.map((l) => (
                  <label key={l.id} className={`pill ${o.lose.includes(l.id) ? 'on' : ''}`}><input type="checkbox" checked={o.lose.includes(l.id)} onChange={(e) => setOffer(i, (x) => void (x.lose = e.target.checked ? [...x.lose, l.id] : x.lose.filter((id) => id !== l.id)))} />{l.nr}</label>
                ))}</div>
              </div>
              <div>
                <span className="field-label">Nachlass ohne Bedingung</span>
                <div className="row">
                  <span className="numwrap sm" style={{ width: 90 }}><input value={o.nachlass ?? ''} placeholder="0,00" onChange={(e) => setOffer(i, (x) => void (x.nachlass = Number(e.target.value.replace(',', '.')) || null))} /><span className="suffix">%</span></span>
                  {o.nachlass ? <span className="muted">auf {o.nachlassLose.length ? o.nachlassLose.map((id) => s.lose.find((l) => l.id === id)?.nr).join('+') : 'alle Lose'}</span> : null}
                  {o.nachlass ? s.lose.filter((l) => o.lose.includes(l.id)).map((l) => (
                    <label key={l.id} className={`pill ${o.nachlassLose.includes(l.id) ? 'on' : ''}`}><input type="checkbox" checked={o.nachlassLose.includes(l.id)} onChange={(e) => setOffer(i, (x) => void (x.nachlassLose = e.target.checked ? [...x.nachlassLose, l.id] : x.nachlassLose.filter((id) => id !== l.id)))} />{l.nr}</label>
                  )) : null}
                </div>
              </div>
            </div>
            <div className="cellsum">
              {cells.map((c) => c && (
                <div key={c.los.id} className={o.lose.includes(c.los.id) ? '' : 'dim'}><small>{c.los.nr}</small><b>{c.net != null && o.lose.includes(c.los.id) ? fmtNum(c.net) + ' €' : '–'}</b><small>netto{c.nachlass ? ` (−${fmtNum(c.nachlass)} %)` : ''}</small></div>
              ))}
            </div>
            {o.runde > 1 && o.lose.length > 1 && <p className="infobox"><Icon name="alert" /> Nachverhandlungen betreffen meist nur einzelne Lose – bitte oben die Lose abwählen, die nicht nachverhandelt wurden.</p>}
            {o.warnungen.map((w, k) => <p key={k} className="warnbox slim"><Icon name="alert" /> {w}</p>)}
            {o.nachforderung.length > 0 && <p className="infobox"><Icon name="file" /> Nachgereicht / nachgefordert: {o.nachforderung.join(', ')}</p>}
            {o.textErg.length > 0 && (
              <details className="det"><summary><Chip kind="warn">{o.textErg.length} Bieter-Textergänzung(en)</Chip> – Hinweis: Eigene Texte des Bieters im LV prüfen (können Änderungen der Vergabeunterlagen sein)</summary>
                <ul>{o.textErg.map((t, k) => <li key={k}><b>Pos. {t.oz}:</b> {t.text}</li>)}</ul></details>
            )}
            <div className="files">{kats.map(([k, n]) => <Chip key={k} kind="info">{k}{n > 1 ? ` ×${n}` : ''}</Chip>)}</div>
          </section>
        );
      })}

      {s.offers.length > 0 && <Vollstaendigkeit s={s} up={up} ki={ki} runKi={runKi} status={status} />}
    </div>
  );
}
