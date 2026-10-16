import { useEffect, useRef, useState } from 'react';
import type { State } from './types';
import { Vollstaendigkeit } from './Vollstaendigkeit';
import { analyzeGroup, applyLv, applyOffer, docStore, expandZips, findLv, groupBids, type RawFile } from './importer';
import { applyKi, getCode, offerDocs, setCode } from './kiApply';
import { kiStatus, KiError, pruefeAngebot, type KiStatus } from './kiPruefung';
import { computeLos } from './calc';
import { fmtDate, fmtNum } from './fmt';
import { Chip, Icon, Seg } from './ui';

type Up = (fn: (d: State) => void) => void;

async function readEntry(entry: FileSystemEntry, path: string, out: RawFile[]) {
  if (entry.isFile) {
    const f: File = await new Promise((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ path: path + f.name, data: new Uint8Array(await f.arrayBuffer()) });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const e of batch) await readEntry(e, `${path}${entry.name}/`, out);
    } while (batch.length);
  }
}

async function collect(dt: DataTransfer): Promise<RawFile[]> {
  const out: RawFile[] = [];
  const entries = Array.from(dt.items).map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (entries.length) { for (const e of entries) await readEntry(e, '', out); return out; }
  for (const f of Array.from(dt.files)) out.push({ path: f.name, data: new Uint8Array(await f.arrayBuffer()) });
  return out;
}
async function fromInput(list: FileList): Promise<RawFile[]> {
  const out: RawFile[] = [];
  for (const f of Array.from(list)) out.push({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) });
  return out;
}

export function StepUnterlagen({ s, up }: { s: State; up: Up }) {
  const [busy, setBusy] = useState(false);
  const [ki, setKi] = useState<{ running: boolean; text: string; error: string }>({ running: false, text: '', error: '' });
  const sRef = useRef(s);
  sRef.current = s;

  const [drag, setDrag] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<KiStatus | null>(null);
  useEffect(() => { kiStatus().then(setStatus); }, []);
  const statusRef = useRef(status);
  statusRef.current = status;

  /** Dokumente der Angebote mit Claude prüfen (Eintragung in die Vollständigkeitstabelle). */
  const runKi = async (offerIds: string[]) => {
    const st = statusRef.current;
    if (!st?.enabled) return;
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

  const process = async (raw: RawFile[]) => {
    setBusy(true); setMsg(null);
    try {
      const files = await expandZips(raw);
      const lv = findLv(files);
      const groups = groupBids(files);
      const parsed = groups.map((g, i) => analyzeGroup(g, s.offers.length + i + 1)).filter((x): x is NonNullable<typeof x> => !!x);
      if (!lv && !parsed.length) {
        setMsg({ ok: false, text: 'Keine GAEB-Dateien erkannt (.x83/.p83/.d83 für das LV, .x84/.p84/.d84 für Angebote). PDF-Dateien allein können nicht ausgewertet werden.' });
      } else {
        parsed.forEach((p) => docStore.set(p.offer.id, p.docs));
        up((d) => { if (lv) applyLv(d, lv); parsed.forEach((p) => applyOffer(d, p)); });
        if (parsed.length) { setTimeout(() => runKi(parsed.map((p) => p.offer.id)), 50); }
        setMsg({ ok: true, text: [lv ? `LV geladen: ${lv.positions.length} Positionen` : '', parsed.length ? `${parsed.length} Angebot(e) eingelesen: ${parsed.map((p) => p.offer.firma).join(', ')}` : ''].filter(Boolean).join(' · ') });
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
      <section className="card">
        <h2>Unterlagen einlesen</h2>
        <p className="lead">Ziehen Sie alles in dieses Feld – das Ausschreibungs-LV (GAEB X83/P83/D83) und die Angebotsordner oder ZIP-Dateien der Bieter, so unsortiert wie sie ankommen. Die App erkennt LV, Preisdateien und Nachweise selbst.</p>
        <div
          className={`drop ${drag ? 'over' : ''} ${busy ? 'busy' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={async (e) => { e.preventDefault(); setDrag(false); process(await collect(e.dataTransfer)); }}
        >
          <Icon name="upload" />
          <b>{busy ? 'Wird eingelesen …' : 'Ordner, ZIP-Dateien oder GAEB-Dateien hierher ziehen'}</b>
          <span className="muted">Mehrere Bieter gleichzeitig möglich · verschachtelte ZIPs werden entpackt · Daten verlassen Ihren Browser nicht</span>
          <div className="row">
            <button className="btn" onClick={() => folderRef.current?.click()}><Icon name="folder" /> Ordner wählen</button>
            <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="file" /> Dateien / ZIP wählen</button>
          </div>
          <input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: '' } as object)} onChange={async (e) => e.target.files && process(await fromInput(e.target.files))} />
          <input ref={fileRef} type="file" hidden multiple onChange={async (e) => e.target.files && process(await fromInput(e.target.files))} />
        </div>
        {msg && <p className={msg.ok ? 'okbox' : 'warnbox'}><Icon name={msg.ok ? 'check' : 'alert'} /> {msg.text}</p>}
        <div className="status">
          <Chip kind={hasLv ? 'ok' : 'warn'}>{hasLv ? `Soll-LV: ${s.lv.length} Positionen, ${s.lose.length} Los/Lose` : 'Soll-LV fehlt – bitte X83/P83/D83 laden'}</Chip>
          <Chip kind={s.offers.length ? 'ok' : 'info'}>{s.offers.length} Angebot(e) geladen</Chip>
          {hasLv && s.lv.some((p) => p.menge !== p.mengeOrig) && <Chip kind="info">{s.lv.filter((p) => p.menge !== p.mengeOrig).length} Menge(n) im LV angepasst</Chip>}
        </div>
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
