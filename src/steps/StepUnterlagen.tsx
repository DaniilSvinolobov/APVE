import { useEffect, useRef, useState } from 'react';
import type { Offer, State } from '../domain/types';
import { Vollstaendigkeit } from './Vollstaendigkeit';
import { OfferDateien } from './OfferDateien';
import { expandZips, type RawFile } from '../import/zip';
import { groupBids, groupPdfBids, groupRest, isLvFile, isLvPdf, kategorie, splitNv, type BidGroup } from '../import/files';
import { bieterAusPdf, kopfAusPdf, pruefePdf, refFromDoc, sortBefunde } from '../import/lvPruefung';
import { pdfLines } from '../import/pdf';
import type { GaebDoc } from '../gaeb/gaeb';
import type { ParsedBid } from '../import/analyze';
import { base } from '../import/zip';
import { analyzeGroup } from '../import/analyze';
import { applyOffer, summenCheck } from '../import/apply';
import { alsNachverhandlung, hauptVon, istHaupt, nachverhandlungen, nvHinweis, setzeBasis } from '../domain/runden';
import { NvAenderung, NvEinlesen, rundeName } from './Nachverhandlung';
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
      let geprueft = 0, gesamt = 0;
      for (const id of offerIds) {
        const o = sRef.current.offers.find((x) => x.id === id);
        if (!o) continue;
        gesamt++;
        const setInfo = (s: 'ok' | 'skip' | 'fehler', t: string) => up((d) => { const x = d.offers.find((y) => y.id === id); if (x) x.kiInfo = { s, t }; });
        const docs = offerDocs(o);
        if (!docs.length) {
          const t = 'Originaldateien nicht mehr verfügbar – bitte den Ordner erneut einlesen.';
          notes.push(`Nr. ${o.nr}: ${t}`); setInfo('skip', t); continue;
        }
        // Ein Fehler bei einem Angebot stoppt die übrigen nicht; nur ein falscher Zugangscode bricht alles ab.
        try {
          const { results, fehler, grund } = await pruefeAngebot(docs, sRef.current.unterlagen, getCode(), (t) => setKi((k) => ({ ...k, text: `Nr. ${o.nr} ${o.firma}: ${t}` })));
          up((d) => applyKi(d, id, results));
          if (fehler.length) notes.push(`Nr. ${o.nr}: Nicht geprüft (bitte manuell ansehen): ${fehler.map((z) => z.split('/').pop()).join(', ')}${grund ? ` – ${grund}` : ''}`);
          const unsicher = results.filter((r) => r.sicherheit === 'niedrig');
          if (unsicher.length) notes.push(`Nr. ${o.nr}: Befund unsicher, bitte selbst prüfen: ${unsicher.map((r) => r.datei.split('/').pop()).join(', ')}`);
          setInfo('ok', fehler.length ? `${fehler.length} Datei(en) nicht geprüft: ${fehler.map((z) => z.split('/').pop()).join(', ')}` : '');
          geprueft++;
        } catch (e) {
          if (e instanceof KiError && e.status === 401) throw e;
          const t = e instanceof Error ? e.message : String(e);
          notes.push(`Nr. ${o.nr}: Prüfung fehlgeschlagen – ${t}`); setInfo('fehler', t);
        }
      }
      setKi({ running: false, text: `Prüfung abgeschlossen: ${geprueft} von ${gesamt} Angebot(en) geprüft.`, error: notes.join(' · ') });
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
      // je Bieterordner: Hauptangebot und Nachverhandlung(en) getrennt einlesen – die Unterlagen des Hauptangebots bleiben unberührt
      const withGroup: { g: BidGroup; p: ParsedBid }[] = [];
      const parsed: ParsedBid[] = [];
      const hauptOhne: BidGroup[] = [];
      const nextNr = () => s.offers.length + parsed.length + 1;
      for (const t of groups.map(splitNv)) {
        let haupt: ParsedBid | null = null;
        if (t.haupt?.bids.length) { haupt = analyzeGroup(t.haupt, nextNr()); if (haupt) { withGroup.push({ g: t.haupt, p: haupt }); parsed.push(haupt); } }
        else if (t.haupt) hauptOhne.push(t.haupt);
        for (const nv of t.nv) {
          const p = nv.bids.length ? analyzeGroup(nv, nextNr())
            : haupt ? analyzeGroup(nv, nextNr(), undefined, { doc: haupt.doc, quelle: '', hinweis: '', art: 'vorrunde' }) : null;
          if (!p) continue;
          if (nv.bids.length) withGroup.push({ g: nv, p });
          parsed.push(p);
        }
      }
      // Ordner ohne Preisdatei, aber mit bepreistem LV als PDF (GAEB-Datei des Bieters ohne Preise)
      const hinweise = new Map<string, string>();
      const covered = withGroup.map((x) => x.g.root);
      const lvRef = s.lv.length ? s.lv.map((p) => ({ oz: p.oz, menge: p.menge, einheit: p.einheit, kurz: p.kurz, bedarf: p.bedarf })) : null;
      for (const pg of groupPdfBids(files, groups)) {
        const r = await bieterAusPdf(pg, lvRef, nextNr());
        if (r.parsed) { parsed.push(r.parsed); covered.push(pg.root); }
        else if (r.hinweis) hinweise.set(pg.root, r.hinweis);
      }
      // Ordner ohne lesbare Preise (z. B. GAEB-Datei wird nachgereicht): trotzdem als Angebot anlegen und melden, nie stillschweigend weglassen
      const ohne: string[] = [];
      for (const rg of [...hauptOhne, ...groupRest(files, covered)]) {
        const pdfs = rg.files.filter((f) => /\.pdf$/i.test(f.path) && f.data.length <= 9_000_000 && ['Sonstiges', 'Angebotsschreiben', 'LV (PDF)'].includes(kategorie(f.path)));
        let kopf = { bieter: '', datum: '' };
        for (const f of pdfs.slice(0, 3)) { try { kopf = kopfAusPdf(await pdfLines(f.data)); } catch { /* nicht lesbar */ } if (kopf.bieter) break; }
        const name = rg.root.split('/').pop() || 'lose Dateien';
        const vorher = [...hinweise].filter(([r]) => r === rg.root || r.startsWith(rg.root + '/')).map(([, h]) => h);
        const hinweis = vorher.length
          ? `Keine auswertbaren Preise im Ordner „${name}“: Es liegt keine GAEB-Preisdatei (X84/P84/D84) bei. ${vorher.join(' ')} Danach den Ordner erneut einlesen – das Angebot wird dann ersetzt.`
          : `Keine auswertbaren Preise im Ordner „${name}“: Es liegt keine GAEB-Preisdatei (X84/P84/D84) bei${pdfs.length ? ', und aus den PDF-Dateien konnten keine Preise gelesen werden' : ''}. Das Angebot ist angelegt, wird aber erst gewertet, wenn Preise vorliegen – Preisdatei nachreichen (Ordner erneut einlesen, das Angebot wird dann ersetzt) oder Lose wählen und die Preise im Preisspiegel eintragen.`;
        const doc: GaebDoc = { format: 'X', phase: 84, projekt: '', bezeichnung: '', auftraggeber: '', ...kopf, titles: {}, totals: {}, total: { net: null, gross: null }, positions: [] };
        const p = analyzeGroup({ root: rg.root, files: rg.files, bids: [] }, nextNr(), undefined, { doc, quelle: '', hinweis, art: 'keine' });
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
        // Hauptangebote zuerst, damit Nachverhandlungen ihr Hauptangebot finden
        up((d) => [...parsed].sort((a, b) => a.offer.runde - b.offer.runde).forEach((p) => applyOffer(d, p)));
        // KI-Prüfung nur für Hauptangebote (Datenminimierung): die Vollständigkeitsprüfung betrifft die Angebotsunterlagen
        setTimeout(() => runKi(parsed.map((p) => p.offer.id).filter((id) => { const o = sRef.current.offers.find((x) => x.id === id); return !!o && istHaupt(o); })), 50);
        const art = (o: ParsedBid['offer']) => (o.runde > 1 ? ' (Nachverhandlung)' : o.preisQuelle === 'pdf' ? ' (Preise aus PDF)' : o.preisQuelle === 'keine' ? ' (ohne Preise)' : '');
        setMsg({ ok: !ohne.length, text: `${parsed.length} Angebot(e) eingelesen: ${parsed.map((p) => p.offer.firma + art(p.offer)).join(', ')}${ohne.length ? ` · Achtung: Für ${ohne.join(', ')} liegen keine auswertbaren Preise vor – Hinweise am Angebot beachten.` : ''}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: `Fehler beim Einlesen: ${(e as Error).message}` });
    }
    setBusy(false);
  };

  const hasLv = s.lv.length > 0;
  const lvFremdText = lvFremd(s, s.lose.flatMap((l) => computeLos(s, l)).filter((c) => c.offer.lose.includes(c.los.id)));
  const setOffer = (id: string, fn: (o: State['offers'][number]) => void) => up((d) => { const x = d.offers.find((y) => y.id === id); if (x) fn(x); });
  const haupt = s.offers.filter(istHaupt);
  const nvText = nvHinweis(s.project.verfahren);

  /** Inhalt einer Angebotskarte; eine Nachverhandlung (`o.basis`) erscheint kompakt innerhalb der Karte ihres Hauptangebots. */
  const angebot = (o: Offer) => {
    const nv = !!o.basis;
    const cells = s.lose.map((l) => computeLos(s, l).find((c) => c.offer.id === o.id)).filter(Boolean);
    return (
      <>
        <div className="offer-head">
          <input className="nrin" value={o.nr} title="Angebot Nr." aria-label="Angebot Nr." onChange={(e) => setOffer(o.id, (x) => void (x.nr = Number(e.target.value) || 0))} />
          <div className="grow">
            {nv
              ? <div className="nv-titel">{rundeName(o.runde)} <span className="muted">zu Angebot Nr. {hauptVon(s, o).nr}</span></div>
              : <input className="firma" value={o.firma} onChange={(e) => setOffer(o.id, (x) => void (x.firma = e.target.value))} placeholder="Firmenname" />}
            <div className="offer-meta">
              {!nv && <input className="ort" value={o.ort} style={{ width: `${(o.ort || 'Ort ergänzen').length + 3}ch` }} onChange={(e) => setOffer(o.id, (x) => void (x.ort = e.target.value))} placeholder="Ort ergänzen" />}
              {nv
                ? <span className="nv-datum">eingereicht am <input type="date" className="pdate" value={o.datum} onChange={(e) => setOffer(o.id, (x) => void (x.datum = e.target.value))} aria-label="Nachverhandlung eingereicht am" /></span>
                : <span>Angebot vom {fmtDate(o.datum)}</span>}
              <span className="src" title={o.quelle}>{o.quelle || (nv ? 'Preise der vorigen Runde' : '')}</span>
              {nv && <button className="link small" title="Verknüpfung lösen: als eigenständiges Hauptangebot führen" onClick={() => up((d) => setzeBasis(d, o.id, null))}>als Hauptangebot führen</button>}
            </div>
          </div>
          <div className="offer-sum">
            {cells.map((c) => c && o.lose.includes(c.los.id) && (
              <div key={c.los.id}><small>{c.los.nr} netto{c.nachlass ? ` · −${fmtNum(c.nachlass)} %` : ''}</small><b>{c.net != null ? fmtNum(c.net) + ' €' : '–'}</b></div>
            ))}
          </div>
          <button className="icon-btn" title={nv ? 'Nachverhandlung entfernen' : nachverhandlungen(s, o).length ? 'Angebot samt Nachverhandlung(en) entfernen' : 'Angebot entfernen'} onClick={() => up((d) => void (d.offers = d.offers.filter((x) => x.id !== o.id && x.basis !== o.id)))}><Icon name="trash" /></button>
        </div>
        <div className="offer-opts">
          {!nv && !nachverhandlungen(s, o).length && (
            <div>
              <span className="opt-l">Runde</span>
              <Seg small value={o.runde > 1 ? 2 : 1} onChange={(v) => up((d) => (v === 1 ? setzeBasis(d, o.id, null) : alsNachverhandlung(d, o.id)))} options={[{ value: 1, label: 'Hauptangebot' }, { value: 2, label: 'Nachverhandlung' }]} />
              {o.runde > 1 && (
                <select className="nv-zu" value="" onChange={(e) => e.target.value && up((d) => setzeBasis(d, o.id, e.target.value))} aria-label="Zugehöriges Hauptangebot">
                  <option value="">zu Angebot … wählen</option>
                  {haupt.filter((h) => h.id !== o.id).map((h) => <option key={h.id} value={h.id}>Nr. {h.nr} · {h.firma}</option>)}
                </select>
              )}
            </div>
          )}
          <div>
            <span className="opt-l">Lose</span>
            {s.lose.map((l) => (
              <label key={l.id} className={`pill ${o.lose.includes(l.id) ? 'on' : ''}`}><input type="checkbox" checked={o.lose.includes(l.id)} onChange={(e) => setOffer(o.id, (x) => void (x.lose = e.target.checked ? [...x.lose, l.id] : x.lose.filter((id) => id !== l.id)))} />{l.nr}</label>
            ))}
          </div>
          <div>
            <span className="opt-l" title="Nachlass ohne Bedingung – wird in die Wertung eingerechnet (Skonto nicht)">Nachlass</span>
            <span className="numwrap sm" style={{ width: 84 }}><input value={o.nachlass ?? ''} placeholder="0,00" onChange={(e) => setOffer(o.id, (x) => void (x.nachlass = Number(e.target.value.replace(',', '.')) || null))} /><span className="suffix">%</span></span>
            {o.nachlass && s.lose.filter((l) => o.lose.includes(l.id)).length > 1 ? <>
              <span className="muted">auf</span>
              {s.lose.filter((l) => o.lose.includes(l.id)).map((l) => (
                <label key={l.id} className={`pill ${o.nachlassLose.includes(l.id) ? 'on' : ''}`}><input type="checkbox" checked={o.nachlassLose.includes(l.id)} onChange={(e) => setOffer(o.id, (x) => void (x.nachlassLose = e.target.checked ? [...x.nachlassLose, l.id] : x.nachlassLose.filter((id) => id !== l.id)))} />{l.nr}</label>
              ))}
              {!o.nachlassLose.length && <span className="muted">(alle Lose)</span>}
            </> : null}
          </div>
          <div>
            <span className="opt-l">Status</span>
            <select value={o.status ?? ''} onChange={(e) => setOffer(o.id, (x) => void (x.status = e.target.value as Offer['status']))} aria-label="Status des Angebots">
              <option value="">in der Wertung</option>
              <option value="formal">bei formaler Prüfung ausgeschlossen</option>
              <option value="zurueck">zurückgezogen</option>
            </select>
            {o.status === 'formal' && <input className="grund" value={o.statusGrund ?? ''} onChange={(e) => setOffer(o.id, (x) => void (x.statusGrund = e.target.value))} placeholder="Grund des Ausschlusses" aria-label="Grund des Ausschlusses" />}
            {!nv && o.runde === 1 && <label className={`pill ${o.nebenangebot ? 'on' : ''}`}><input type="checkbox" checked={!!o.nebenangebot} onChange={(e) => setOffer(o.id, (x) => void (x.nebenangebot = e.target.checked))} />Nebenangebot beigefügt</label>}
          </div>
        </div>
        {(nv || o.check) && (
          <div className="row offer-check">
            {nv && <NvAenderung s={s} o={o} />}
            {o.check && <span className="muted">Summe Bieterdatei: <b>{fmtNum(o.check.gaeb ?? o.check.positionen)} €</b></span>}
            {o.check && summenFlags(s, o).map((f, k) => <Chip key={k} kind={f.kind}>{f.text}</Chip>)}
          </div>
        )}
        {o.runde > 1 && o.lose.length > 1 && <p className="infobox"><Icon name="alert" /> Nicht nachverhandelte Lose bitte abwählen.</p>}
        {o.warnungen.map((w, k) => <p key={k} className="warnbox slim"><Icon name="alert" /> {w}</p>)}
        {o.nachforderung.length > 0 && <p className="infobox"><Icon name="file" /> Nachgereicht / nachgefordert: {o.nachforderung.join(', ')}</p>}
        {o.textErg.length > 0 && (
          <details className="det"><summary><Chip kind="warn">{o.textErg.length} Textergänzung(en) des Bieters</Chip> – auf Änderungen der Vergabeunterlagen prüfen</summary>
            <ul>{o.textErg.map((t, k) => <li key={k}><b>Pos. {t.oz}:</b> {t.text}</li>)}</ul></details>
        )}
        {o.lvPdf?.map((l, k) => (
          <details className="det" key={k} open={l.befunde.some((b) => b.kind !== 'info')}>
            <summary><Chip kind={l.befunde.some((b) => b.kind !== 'info') ? 'warn' : 'ok'}>LV-PDF {l.befunde.some((b) => b.kind !== 'info') ? 'weicht ab' : 'stimmt überein'}</Chip> – {l.name}</summary>
            {l.befunde.map((b, j) => <p key={j} className={b.kind === 'info' ? 'infobox' : 'warnbox slim'}><Icon name={b.kind === 'info' ? 'check' : 'alert'} /> {b.text}</p>)}
          </details>
        ))}
        <OfferDateien o={o} up={up} onAdded={(id) => { if (!nv) setTimeout(() => runKi([id]), 50); }} />
      </>
    );
  };

  return (
    <div className="stack">
      {!hasLv && <p className="infobox"><Icon name="alert" /> Eigenes LV fehlt – bitte im Schritt „Vergabe“ laden. Sonst wird es aus der ersten Bieterdatei abgeleitet.</p>}

      <section className="card" id="bieter-card">
        <h2>Angebote der Bieter</h2>
        <p className="lead">Ordner oder ZIP-Dateien, so wie sie ankommen – auch mehrere Bieter auf einmal.</p>
        <DropZone busy={busy} onFiles={processBids} title="Ordner oder ZIP-Dateien der Bieter hierher ziehen" hint="Daten verlassen Ihren Browser nicht" folder />
        {msg && <p className={msg.ok ? 'okbox' : 'warnbox'}><Icon name={msg.ok ? 'check' : 'alert'} /> {msg.text}</p>}
        <div className="status"><Chip kind={s.offers.length ? 'ok' : 'info'}>{s.offers.length} Angebot(e) geladen</Chip></div>
      </section>

      {lvFremdText && <p className="warnbox"><Icon name="alert" /> {lvFremdText}</p>}

      {haupt.map((o) => {
        const nvs = nachverhandlungen(s, o);
        return (
          <section className="card offer" key={o.id}>
            {angebot(o)}
            {nvs.length > 0 && nvText && <p className="warnbox slim"><Icon name="alert" /> {nvText}</p>}
            {nvs.map((n) => <div className="nv-block" key={n.id}>{angebot(n)}</div>)}
            <NvEinlesen s={s} o={o} up={up} />
          </section>
        );
      })}

      {s.offers.length > 0 && <Vollstaendigkeit s={s} up={up} ki={ki} runKi={runKi} status={status} />}
    </div>
  );
}
