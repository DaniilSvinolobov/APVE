import { useRef, useState } from 'react';
import type { LvBefund, State } from '../domain/types';
import { expandZips, type RawFile } from '../import/zip';
import { findLvFiles, isBidFile } from '../import/files';
import { lesePdf, pruefeEigenesLv, refFromDoc, schaetzAusPdf, sortBefunde } from '../import/lvPruefung';
import type { GaebDoc } from '../gaeb/gaeb';
import type { RefPos } from '../gaeb/lvCheck';
import { applyLv, applySchaetz, removeLv, removeSchaetz, vonPdf } from '../import/apply';
import { base } from '../import/zip';
import { pruefeLvDatei } from '../gaeb/lvCheck';
import { schaetzSumme } from '../domain/calc';
import { fmtEur } from '../domain/fmt';
import { Chip, Icon } from '../components/ui';
import { DropZone } from '../components/DropZone';
import { applyKopf, kopfAusDoc, kopfAusText, kopfFehlt, kopfLuecken, kopfMerge, type Kopf } from '../import/kopfdaten';
import { pdfLines } from '../import/pdf';
import { lvAusPdf, lvPdfBefund } from '../import/lvAusPdf';

type Up = (fn: (d: State) => void) => void;

/** Eigenes LV (GAEB 81/82/83) laden – legt Lose, Maßnahme und Auftraggeber an. */
export function LvKarte({ s, up }: { s: State; up: Up }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sRef = useRef(s);
  sRef.current = s;

  const process = async (raw: RawFile[]) => {
    setBusy(true); setMsg(null);
    try {
      const files = await expandZips(raw);
      const lv = findLvFiles(files);
      const { schaetz, schaetzName, pricedSkipped } = lv;
      const sr = sRef.current;
      // nur eine X82 zu einem bereits geladenen LV: Schätzpreise ergänzen, das LV bleibt
      const nurSchaetz = lv.nur82 && sr.lv.length > 0 && !!schaetz;
      const soll = nurSchaetz ? null : lv.soll;
      const sollName = lv.sollName;
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.path));
      const pdfNamen = [...new Set(pdfs.map((f) => base(f.path)))];
      // Referenz für den PDF-Abgleich: das eben gelesene LV, sonst das bereits geladene
      const ref: RefPos[] | null = soll ? refFromDoc(soll) : sr.lv.length ? sr.lv.map((p) => ({ oz: p.oz, menge: p.mengeOrig, einheit: p.einheit })) : null;
      const pdfBefunde: LvBefund[] = [];
      // bepreistes LV-PDF: liefert die LV-Schätzpreise, wenn keine X82 dabei ist (eine X82 hat Vorrang)
      let pdfSchaetz: { doc: GaebDoc; name: string; befund: LvBefund } | null = null;
      // Eckdaten vom Deckblatt der PDF (Vergabenummer, Termine, Planverfasser …); das erste PDF hat Vorrang
      let pdfKopf: Kopf = {};
      if (ref) for (const f of pdfs) {
        const r = await lesePdf(f, ref, true);
        if (r.kopf) pdfKopf = kopfMerge(pdfKopf, r.kopf);
        pdfBefunde.push(...r.befunde.map((b) => ({ ...b, datei: base(f.path) })));
        const sp: ReturnType<typeof schaetzAusPdf> = !schaetz && !pdfSchaetz ? schaetzAusPdf(base(f.path), r.pdf, ref, r.summe) : null;
        if (sp) pdfSchaetz = { doc: sp.doc, name: base(f.path), befund: { ...sp.befund, datei: base(f.path) } };
      }
      // PDF-Preise nur übernehmen, wenn keine Schätzpreise aus einer GAEB-Datei (X82) bestehen bleiben
      const gaebPreise = sr.lvInfo?.schaetz && Object.keys(sr.schaetz ?? {}).length > 0 && !/\.pdf$/i.test(sr.lvInfo.schaetz) && (!soll || sr.lvInfo.schaetz !== sr.lvInfo.lv) ? sr.lvInfo.schaetz : '';
      const ausPdf = !!pdfSchaetz && !gaebPreise;
      // „Stand/Datum“ des PDF ist nur dann das Datum des Kostenvoranschlags, wenn die Schätzpreise aus diesem PDF stammen
      if (!ausPdf) delete pdfKopf.kostenDatum;
      const kopf = kopfMerge(soll ? kopfMerge(kopfAusDoc(soll), schaetz ? kopfAusDoc(schaetz) : {}) : nurSchaetz ? { kostenDatum: kopfAusDoc(schaetz!).kostenDatum } : {}, pdfKopf);
      const vorbelegt = kopfLuecken(sr.project, kopf);
      const fehlt = soll ? kopfFehlt(sr.project, kopf) : [];
      const vorbelegtText = [vorbelegt.length ? `Vorbelegt: ${vorbelegt.join(', ')}` : '', fehlt.length ? `Nicht im LV gefunden (bitte eintragen): ${fehlt.join(', ')}` : ''].filter(Boolean).join(' · ');
      const pdfPreise = (d: State) => {
        if (!pdfSchaetz) return;
        if (ausPdf) { applySchaetz(d, pdfSchaetz.doc, pdfSchaetz.name); d.lvPruef = [...(d.lvPruef ?? []), pdfSchaetz.befund]; }
        else d.lvPruef = [...(d.lvPruef ?? []), { kind: 'info', quelle: 'pdf', datei: pdfSchaetz.name, text: `${pdfSchaetz.name}: Das PDF enthält Preise; als LV-Schätzpreise bleiben die aus ${gaebPreise}.` }];
      };
      if (!soll) {
        if (nurSchaetz || (pdfs.length && ref)) {
          // ergänzen: gleichnamige PDF ersetzen, andere bleiben stehen
          const gaebBefunde: LvBefund[] = nurSchaetz ? pruefeLvDatei(schaetzName, schaetz!).map((b) => ({ ...b, datei: schaetzName })) : [];
          up((d) => {
            if (nurSchaetz) { removeSchaetz(d); applySchaetz(d, schaetz!, schaetzName); }
            d.lvPruef = [...(d.lvPruef ?? []).filter((b) => !pdfNamen.some((n) => vonPdf(b, n))), ...gaebBefunde, ...pdfBefunde];
            if (pdfNamen.length) d.lvInfo = { ...d.lvInfo, pdfs: [...(d.lvInfo.pdfs ?? []).filter((n) => !pdfNamen.includes(n)), ...pdfNamen] };
            pdfPreise(d);
            d.lvPruef = sortBefunde(d.lvPruef);
            applyKopf(d.project, pdfKopf);
          });
          const n = nurSchaetz ? schaetz!.positions.filter((p) => p.ep != null).length : 0;
          setMsg({ ok: true, text: [nurSchaetz ? `LV-Schätzpreise ergänzt: ${n} Positionen (${schaetzName})` : '', ausPdf ? `LV-Schätzpreise aus dem PDF gelesen (${pdfSchaetz!.name})` : '', pdfs.length ? `${pdfs.length} PDF mit dem geladenen LV abgeglichen – Ergebnis siehe „Prüfung des LV“.` : '', vorbelegtText].filter(Boolean).join(' · ') });
        } else if (pdfs.length) {
          // ohne GAEB-Datei: LV (Positionen, Mengen, Titel, ggf. Preise) und Eckdaten direkt aus dem PDF lesen
          let k: Kopf = {};
          let lvPdf: { doc: GaebDoc; name: string } | null = null;
          for (const f of pdfs) {
            try {
              const lines = await pdfLines(f.data);
              k = kopfMerge(k, kopfAusText(lines));
              if (!lvPdf) { const doc = lvAusPdf(lines); if (doc) lvPdf = { doc, name: base(f.path) }; }
            } catch { /* nicht lesbar */ }
          }
          if (lvPdf) {
            const { doc, name } = lvPdf;
            const preise = doc.phase === 82;
            if (!preise) delete k.kostenDatum;
            doc.bezeichnung = k.titel ?? '';
            doc.auftraggeber = k.auftraggeber ?? '';
            doc.datum = k.kostenDatum ?? '';
            const lesen = { ...lvPdfBefund(name, doc), datei: name };
            const befunde = sortBefunde([lesen, ...pruefeLvDatei(name, doc).map((b) => ({ ...b, quelle: 'pdf' as const, datei: name }))]);
            const neu = kopfLuecken(sr.project, k);
            const fehlt = kopfFehlt(sr.project, k);
            up((d) => { applyLv(d, doc, null, { lv: name, schaetz: name }); applyKopf(d.project, k); d.lvPruef = befunde; d.lvInfo = { ...d.lvInfo, pdfs: [] }; });
            setMsg({ ok: true, text: [`LV aus dem PDF geladen: ${doc.positions.length} Positionen (${name})`, preise ? 'LV-Schätzpreise aus dem PDF' : 'ohne Preise', neu.length ? `Vorbelegt: ${neu.join(', ')}` : '', fehlt.length ? `Nicht im LV gefunden (bitte eintragen): ${fehlt.join(', ')}` : '', sr.offers.length ? 'Bereits geladene Angebote werden automatisch neu verglichen.' : ''].filter(Boolean).join(' · ') });
          } else {
            delete k.kostenDatum;
            const neu = kopfLuecken(sr.project, k);
            if (neu.length) up((d) => applyKopf(d.project, k));
            setMsg({ ok: false, text: [neu.length ? `Aus dem PDF vorbelegt: ${neu.join(', ')}.` : '', 'Im PDF wurden keine Positionen mit Mengen erkannt (Scan ohne Text oder unbekanntes Layout) – bitte die GAEB-Datei (X81/X83) laden.'].filter(Boolean).join(' ') });
          }
        } else {
          const bids = pricedSkipped.length > 0 || files.some((f) => isBidFile(f.path));
          setMsg({ ok: false, text: pricedSkipped.length ? `„${pricedSkipped.join('“, „')}“ enthält Bieterpreise und ist damit ein Angebot, kein LV – bitte im Schritt „Unterlagen“ unter „Angebote der Bieter“ ablegen.` : bids ? 'Das sind Angebotsdateien (x84/p84/d84) – bitte im Schritt „Unterlagen“ unter „Angebote der Bieter“ ablegen.' : 'Kein LV erkannt. Erwartet: .x81/.x82/.x83 (GAEB DA XML), .p8x (GAEB 2000) oder .d8x (GAEB 90), optional das LV als PDF.' });
        }
      } else {
        const befunde = sortBefunde([...pruefeEigenesLv(lv), ...pdfBefunde]);
        up((d) => { applyLv(d, soll, schaetz, { lv: sollName, schaetz: schaetzName }); d.lvPruef = befunde; d.lvInfo = { ...d.lvInfo, pdfs: pdfNamen }; pdfPreise(d); d.lvPruef = sortBefunde(d.lvPruef); applyKopf(d.project, pdfKopf); });
        const n = schaetz ? schaetz.positions.filter((p) => p.ep != null).length : 0;
        setMsg({ ok: true, text: [`LV geladen: ${soll.positions.length} Positionen (${sollName})`, n ? `LV-Schätzpreise: ${n} Positionen (${schaetzName})` : ausPdf ? `LV-Schätzpreise aus dem PDF (${pdfSchaetz!.name})` : sr.lvInfo?.schaetz && sr.lvInfo.schaetz !== sr.lvInfo.lv ? `LV-Schätzpreise aus ${sr.lvInfo.schaetz} beibehalten` : 'keine Schätzpreise (GAEB 82 oder bepreistes PDF) gefunden', pdfs.length ? `${pdfs.length} PDF abgeglichen` : '', pricedSkipped.length ? `Übersprungen (enthält Bieterpreise, gehört zu den Angeboten): ${pricedSkipped.join(', ')}` : '', vorbelegtText, sRef.current.offers.length ? 'Bereits geladene Angebote werden automatisch neu verglichen.' : ''].filter(Boolean).join(' · ') });
      }
    } catch (e) {
      setMsg({ ok: false, text: `Fehler beim Einlesen: ${(e as Error).message}` });
    }
    setBusy(false);
  };

  const befunde = s.lvPruef ?? [];
  const hasLv = s.lv.length > 0;
  const hasSchaetz = Object.keys(s.schaetz ?? {}).length > 0;
  const pdfListe = s.lvInfo?.pdfs ?? [];
  const schaetzGesamt = s.lose.reduce((a, l) => a + (schaetzSumme(s, l) ?? 0), 0);

  return (
    <section className="card" id="lv-card">
      <h2>Eigenes LV (Ausschreibung)</h2>
      <p className="lead">GAEB-Datei (X81/X83, X82 mit Schätzpreisen) oder PDF – die Angaben unten werden daraus vorbelegt.</p>
      <DropZone busy={busy} onFiles={process} title="LV hierher ziehen (X81 · X82 · X83 · PDF)" hint="Auch P8x, D8x und ZIP · Daten bleiben im Browser" folder={false} />
      {msg && <p className={msg.ok ? 'okbox' : 'warnbox'}><Icon name={msg.ok ? 'check' : 'alert'} /> {msg.text}</p>}
      <div className="status">
        <Chip kind={hasLv ? 'ok' : 'warn'}>{hasLv ? `LV: ${s.lv.length} Positionen, ${s.lose.length} Los/Lose${s.lvInfo?.lv ? ` (${s.lvInfo.lv})` : ''}` : 'LV fehlt'}</Chip>
        <Chip kind={hasSchaetz ? 'ok' : 'info'}>{hasSchaetz ? `LV-Schätzpreise: ${Object.keys(s.schaetz).length} Positionen · ${fmtEur(schaetzGesamt)} netto` : 'keine LV-Schätzpreise (X82 oder bepreistes PDF)'}</Chip>
        {hasLv && s.lv.some((p) => p.menge !== p.mengeOrig) && <Chip kind="info">{s.lv.filter((p) => p.menge !== p.mengeOrig).length} Menge(n) im LV angepasst</Chip>}
      </div>
      {(hasLv || hasSchaetz || pdfListe.length > 0) && (
        <ul className="filelist">
          {hasLv && <li><Icon name="file" /><span className="fname">{s.lvInfo?.lv || 'LV (Dateiname unbekannt)'}</span><Chip kind="info">{hasSchaetz && s.lvInfo?.schaetz === s.lvInfo?.lv ? 'LV · Positionen, Mengen und Schätzpreise' : 'LV · Positionen und Mengen'}</Chip>
            <button className="icon-btn" title="LV entfernen" onClick={() => { if (confirm('Eigenes LV entfernen? Positionen, LV-Schätzpreise und die Prüfung des LV werden gelöscht; Lose und Angebote bleiben erhalten und werden beim nächsten LV neu zugeordnet.')) { up(removeLv); setMsg(null); } }}><Icon name="trash" /></button></li>}
          {hasSchaetz && !pdfListe.includes(s.lvInfo?.schaetz ?? '') && s.lvInfo?.schaetz !== s.lvInfo?.lv && <li><Icon name="file" /><span className="fname">{s.lvInfo?.schaetz || 'Schätzpreise (Dateiname unbekannt)'}</span><Chip kind="info">LV-Schätzpreise</Chip>
            <button className="icon-btn" title="LV-Schätzpreise entfernen" onClick={() => up(removeSchaetz)}><Icon name="trash" /></button></li>}
          {pdfListe.map((n) => <li key={n}><Icon name="file" /><span className="fname">{n}</span><Chip kind="info">{n === s.lvInfo?.schaetz ? 'LV als PDF · Abgleich und LV-Schätzpreise' : 'LV als PDF · Abgleich'}</Chip>
            <button className="icon-btn" title="PDF entfernen" onClick={() => up((d) => { if (d.lvInfo?.schaetz === n) removeSchaetz(d); d.lvPruef = d.lvPruef?.filter((b) => !vonPdf(b, n)); d.lvInfo = { ...d.lvInfo, pdfs: (d.lvInfo.pdfs ?? []).filter((x) => x !== n) }; })}><Icon name="trash" /></button></li>)}
        </ul>
      )}
      {hasLv && <p className="filehint">Nachladen: X82 = Schätzpreise, PDF = Abgleich, X81/X83 = neues LV.</p>}
      {befunde.length > 0 && (
        <div className="lvpruef">
          <h3>Prüfung des LV</h3>
          {befunde.map((b, i) => <p key={i} className={b.kind === 'info' ? 'infobox' : 'warnbox slim'}><Icon name={b.kind === 'info' ? 'check' : 'alert'} /> {b.text}</p>)}
        </div>
      )}
    </section>
  );
}
