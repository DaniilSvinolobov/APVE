import { useEffect, useRef, useState } from 'react';
import type { State } from '../domain/types';
import { Vollstaendigkeit } from './Vollstaendigkeit';
import { OfferDateien } from './OfferDateien';
import { expandZips, type RawFile } from '../import/zip';
import { groupBids, groupPdfBids, groupRest, isLvFile, isLvPdf, kategorie } from '../import/files';
import { bieterAusPdf, kopfAusPdf, pruefePdf, refFromDoc, sortBefunde } from '../import/lvPruefung';
import { pdfLines } from '../import/pdf';
import type { GaebDoc } from '../gaeb/gaeb';
import type { ParsedBid } from '../import/analyze';
import { base } from '../import/zip';
import { analyzeGroup } from '../import/analyze';
import { applyOffer, summenCheck } from '../import/apply';
import { pdfSummenCheck } from '../import/pdfSumme';
import { docStore } from '../import/docStore';
import { applyKi, getCode, hasConsent, offerDocs, setCode } from '../ki/kiApply';
import { kiStatus, KiError, pruefeAngebot, type KiStatus } from '../ki/kiPruefung';
import { computeLos, lvFremd, summenFlags } from '../domain/calc';
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
      const withGroup = groups.map((g, i) => ({ g, p: analyzeGroup(g, s.offers.length + i + 1) })).filter((x): x is { g: typeof x.g; p: NonNullable<typeof x.p> } => !!x.p);
      const parsed: ParsedBid[] = withGroup.map((x) => x.p);
      // Ordner ohne Preisdatei, aber mit bepreistem LV als PDF (GAEB-Datei des Bieters ohne Preise)
      const hinweise = new Map<string, string>();
      const covered = withGroup.map((x) => x.g.root);
      const lvRef = s.lv.length ? s.lv.map((p) => ({ oz: p.oz, menge: p.menge, einheit: p.einheit, kurz: p.kurz, bedarf: p.bedarf })) : null;
      for (const pg of groupPdfBids(files, groups)) {
        const r = await bieterAusPdf(pg, lvRef, s.offers.length + parsed.length + 1);
        if (r.parsed) { parsed.push(r.parsed); covered.push(pg.root); }
        else if (r.hinweis) hinweise.set(pg.root, r.hinweis);
      }
      // Ordner ohne lesbare Preise (z. B. GAEB-Datei wird nachgereicht): trotzdem als Angebot anlegen und melden, nie stillschweigend weglassen
      const ohne: string[] = [];
      for (const rg of groupRest(files, covered)) {
        const pdfs = rg.files.filter((f) => /\.pdf$/i.test(f.path) && f.data.length <= 9_000_000 && ['Sonstiges', 'Angebotsschreiben', 'LV (PDF)'].includes(kategorie(f.path)));
        let kopf = { bieter: '', datum: '' };
        for (const f of pdfs.slice(0, 3)) { try { kopf = kopfAusPdf(await pdfLines(f.data)); } catch { /* nicht lesbar */ } if (kopf.bieter) break; }
        const name = rg.root.split('/').pop() || 'lose Dateien';
        const vorher = [...hinweise].filter(([r]) => r === rg.root || r.startsWith(rg.root + '/')).map(([, h]) => h);
        const hinweis = vorher.length
          ? `Keine auswertbaren Preise im Ordner „${name}“: Es liegt keine GAEB-Preisdatei (X84/P84/D84) bei. ${vorher.join(' ')} Danach den Ordner erneut einlesen – das Angebot wird dann ersetzt.`
          : `Keine auswertbaren Preise im Ordner „${name}“: Es liegt keine GAEB-Preisdatei (X84/P84/D84) bei${pdfs.length ? ', und aus den PDF-Dateien konnten keine Preise gelesen werden' : ''}. Das Angebot ist angelegt, wird aber erst gewertet, wenn Preise vorliegen – Preisdatei nachreichen (Ordner erneut einlesen, das Angebot wird dann ersetzt) oder Lose wählen und die Preise im Preisspiegel eintragen.`;
        const doc: GaebDoc = { format: 'X', phase: 84, projekt: '', bezeichnung: '', auftraggeber: '', ...kopf, titles: {}, totals: {}, total: { net: null, gross: null }, positions: [] };
        const p = analyzeGroup({ root: rg.root, files: rg.files, bids: [] }, s.offers.length + parsed.length + 1, undefined, { doc, quelle: '', hinweis, art: 'keine' });
        if (p) { parsed.push(p); ohne.push(p.offer.firma); }
      }
      // LV als PDF im Angebot: mit den Preisen der GAEB-Datei des Bieters abgleichen
      for (const { g, p } of withGroup) {
        const pdfs = g.files.filter((f) => isLvPdf(f.path)).filter((f, i, a) => a.findIndex((x) => base(x.path) === base(f.path) && x.data.length === f.data.length) === i);
        if (!pdfs.length) continue;
        p.offer.lvPdf = [];
        for (const f of pdfs) p.offer.lvPdf.push({ name: base(f.path), befunde: sortBefunde(await pruefePdf(f, refFromDoc(p.doc), true)) });
      }
      // Gegenprobe: Endsumme im PDF des Bieters
      for (const { g, p } of withGroup) { const ck = summenCheck(p.doc); p.offer.check = { ...ck, pdf: await pdfSummenCheck(g.files, ck.gaeb ?? ck.positionen) }; }
      if (!parsed.length) {
        setMsg({ ok: false, text: hinweise.size ? [...hinweise.values()].join(' ') : files.some((f) => isLvFile(f.path)) ? 'Das sind LV-Dateien ohne Preise (x81/x82/x83) – das eigene LV gehört in den Schritt „Vergabe“.' : 'Keine Angebote erkannt (.x84/.p84/.d84, oder .x83/.p83/.d83 mit Preisen). PDF-Dateien allein können nicht ausgewertet werden.' });
      } else {
        parsed.forEach((p) => docStore.set(p.offer.id, p.docs));
        up((d) => parsed.forEach((p) => applyOffer(d, p)));
        setTimeout(() => runKi(parsed.map((p) => p.offer.id)), 50);
        const art = (q: ParsedBid['offer']['preisQuelle']) => (q === 'pdf' ? ' (Preise aus PDF)' : q === 'keine' ? ' (ohne Preise)' : '');
        setMsg({ ok: !ohne.length, text: `${parsed.length} Angebot(e) eingelesen: ${parsed.map((p) => p.offer.firma + art(p.offer.preisQuelle)).join(', ')}${ohne.length ? ` · Achtung: Für ${ohne.join(', ')} liegen keine auswertbaren Preise vor – Hinweise am Angebot beachten.` : ''}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: `Fehler beim Einlesen: ${(e as Error).message}` });
    }
    setBusy(false);
  };

  const hasLv = s.lv.length > 0;
  const lvFremdText = lvFremd(s, s.lose.flatMap((l) => computeLos(s, l)).filter((c) => c.offer.lose.includes(c.los.id)));
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

      {lvFremdText && <p className="warnbox"><Icon name="alert" /> {lvFremdText}</p>}

      {s.offers.map((o, i) => {
        const cells = s.lose.map((l) => computeLos(s, l).find((c) => c.offer.id === o.id)).filter(Boolean);
        return (
          <section className="card offer" key={o.id}>
            <div className="offer-head">
              <input className="nrin" value={o.nr} title="Angebot Nr." aria-label="Angebot Nr." onChange={(e) => setOffer(i, (x) => void (x.nr = Number(e.target.value) || 0))} />
              <div className="grow">
                <input className="firma" value={o.firma} onChange={(e) => setOffer(i, (x) => void (x.firma = e.target.value))} placeholder="Firmenname" />
                <div className="offer-meta">
                  <input className="ort" value={o.ort} style={{ width: `${(o.ort || 'Ort ergänzen').length + 3}ch` }} onChange={(e) => setOffer(i, (x) => void (x.ort = e.target.value))} placeholder="Ort ergänzen" />
                  <span>Angebot vom {fmtDate(o.datum)}</span>
                  <span className="src" title={o.quelle}>{o.quelle}</span>
                </div>
              </div>
              <div className="offer-sum">
                {cells.map((c) => c && o.lose.includes(c.los.id) && (
                  <div key={c.los.id}><small>{c.los.nr} netto{c.nachlass ? ` · −${fmtNum(c.nachlass)} %` : ''}</small><b>{c.net != null ? fmtNum(c.net) + ' €' : '–'}</b></div>
                ))}
              </div>
              <button className="icon-btn" title="Angebot entfernen" onClick={() => up((d) => void d.offers.splice(i, 1))}><Icon name="trash" /></button>
            </div>
            <div className="offer-opts">
              <div>
                <span className="opt-l">Runde</span>
                <Seg small value={o.runde} onChange={(v) => setOffer(i, (x) => void (x.runde = v as 1 | 2 | 3))} options={[{ value: 1, label: 'Hauptangebot' }, { value: 2, label: 'Nachverhandlung' }]} />
              </div>
              <div>
                <span className="opt-l">Lose</span>
                {s.lose.map((l) => (
                  <label key={l.id} className={`pill ${o.lose.includes(l.id) ? 'on' : ''}`}><input type="checkbox" checked={o.lose.includes(l.id)} onChange={(e) => setOffer(i, (x) => void (x.lose = e.target.checked ? [...x.lose, l.id] : x.lose.filter((id) => id !== l.id)))} />{l.nr}</label>
                ))}
              </div>
              <div>
                <span className="opt-l" title="Nachlass ohne Bedingung – wird in die Wertung eingerechnet (Skonto nicht)">Nachlass</span>
                <span className="numwrap sm" style={{ width: 84 }}><input value={o.nachlass ?? ''} placeholder="0,00" onChange={(e) => setOffer(i, (x) => void (x.nachlass = Number(e.target.value.replace(',', '.')) || null))} /><span className="suffix">%</span></span>
                {o.nachlass && s.lose.filter((l) => o.lose.includes(l.id)).length > 1 ? <>
                  <span className="muted">auf</span>
                  {s.lose.filter((l) => o.lose.includes(l.id)).map((l) => (
                    <label key={l.id} className={`pill ${o.nachlassLose.includes(l.id) ? 'on' : ''}`}><input type="checkbox" checked={o.nachlassLose.includes(l.id)} onChange={(e) => setOffer(i, (x) => void (x.nachlassLose = e.target.checked ? [...x.nachlassLose, l.id] : x.nachlassLose.filter((id) => id !== l.id)))} />{l.nr}</label>
                  ))}
                  {!o.nachlassLose.length && <span className="muted">(alle Lose)</span>}
                </> : null}
              </div>
            </div>
            {o.check && (
              <div className="row offer-check">
                <span className="muted">Summe laut Bieterdatei: <b>{fmtNum(o.check.gaeb ?? o.check.positionen)} €</b></span>
                {summenFlags(s, o).map((f, k) => <Chip key={k} kind={f.kind}>{f.text}</Chip>)}
              </div>
            )}
            {o.runde > 1 && o.lose.length > 1 && <p className="infobox"><Icon name="alert" /> Nachverhandlungen betreffen meist nur einzelne Lose – bitte oben die Lose abwählen, die nicht nachverhandelt wurden.</p>}
            {o.warnungen.map((w, k) => <p key={k} className="warnbox slim"><Icon name="alert" /> {w}</p>)}
            {o.nachforderung.length > 0 && <p className="infobox"><Icon name="file" /> Nachgereicht / nachgefordert: {o.nachforderung.join(', ')}</p>}
            {o.textErg.length > 0 && (
              <details className="det"><summary><Chip kind="warn">{o.textErg.length} Bieter-Textergänzung(en)</Chip> – Hinweis: Eigene Texte des Bieters im LV prüfen (können Änderungen der Vergabeunterlagen sein)</summary>
                <ul>{o.textErg.map((t, k) => <li key={k}><b>Pos. {t.oz}:</b> {t.text}</li>)}</ul></details>
            )}
            {o.lvPdf?.map((l, k) => (
              <details className="det" key={k} open={l.befunde.some((b) => b.kind !== 'info')}>
                <summary><Chip kind={l.befunde.some((b) => b.kind !== 'info') ? 'warn' : 'ok'}>LV-PDF {l.befunde.some((b) => b.kind !== 'info') ? 'weicht ab' : 'stimmt überein'}</Chip> – {l.name} mit der GAEB-Preisdatei abgeglichen</summary>
                {l.befunde.map((b, j) => <p key={j} className={b.kind === 'info' ? 'infobox' : 'warnbox slim'}><Icon name={b.kind === 'info' ? 'check' : 'alert'} /> {b.text}</p>)}
              </details>
            ))}
            <OfferDateien o={o} up={up} onAdded={(id) => setTimeout(() => runKi([id]), 50)} />
          </section>
        );
      })}

      {s.offers.length > 0 && <Vollstaendigkeit s={s} up={up} ki={ki} runKi={runKi} status={status} />}
    </div>
  );
}
