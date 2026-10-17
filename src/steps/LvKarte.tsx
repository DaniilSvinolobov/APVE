import { useRef, useState } from 'react';
import type { LvBefund, State } from '../domain/types';
import { expandZips, type RawFile } from '../import/zip';
import { findLvFiles, isBidFile } from '../import/files';
import { pruefeEigenesLv, pruefePdf, refFromDoc, sortBefunde } from '../import/lvPruefung';
import type { RefPos } from '../gaeb/lvCheck';
import { applyLv, applySchaetz, removeLv, removeSchaetz, vonPdf } from '../import/apply';
import { base } from '../import/zip';
import { pruefeLvDatei } from '../gaeb/lvCheck';
import { schaetzSumme } from '../domain/calc';
import { fmtEur } from '../domain/fmt';
import { Chip, Icon } from '../components/ui';
import { DropZone } from '../components/DropZone';

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
      if (ref) for (const f of pdfs) pdfBefunde.push(...(await pruefePdf(f, ref, false)).map((b) => ({ ...b, datei: base(f.path) })));
      if (!soll) {
        if (nurSchaetz || (pdfs.length && ref)) {
          // ergänzen: gleichnamige PDF ersetzen, andere bleiben stehen
          const gaebBefunde: LvBefund[] = nurSchaetz ? pruefeLvDatei(schaetzName, schaetz!).map((b) => ({ ...b, datei: schaetzName })) : [];
          up((d) => {
            if (nurSchaetz) { removeSchaetz(d); applySchaetz(d, schaetz!, schaetzName); }
            d.lvPruef = sortBefunde([...(d.lvPruef ?? []).filter((b) => !pdfNamen.some((n) => vonPdf(b, n))), ...gaebBefunde, ...pdfBefunde]);
            if (pdfNamen.length) d.lvInfo = { ...d.lvInfo, pdfs: [...(d.lvInfo.pdfs ?? []).filter((n) => !pdfNamen.includes(n)), ...pdfNamen] };
          });
          const n = nurSchaetz ? schaetz!.positions.filter((p) => p.ep != null).length : 0;
          setMsg({ ok: true, text: [nurSchaetz ? `LV-Schätzpreise ergänzt: ${n} Positionen (${schaetzName})` : '', pdfs.length ? `${pdfs.length} PDF mit dem geladenen LV abgeglichen – Ergebnis siehe „Prüfung des LV“.` : ''].filter(Boolean).join(' · ') });
        } else if (pdfs.length) {
          setMsg({ ok: false, text: 'Ein PDF kann nur gegen ein GAEB-LV geprüft werden – bitte zuerst die GAEB-Datei (X81/X83) laden, gern zusammen mit dem PDF.' });
        } else {
          const bids = pricedSkipped.length > 0 || files.some((f) => isBidFile(f.path));
          setMsg({ ok: false, text: pricedSkipped.length ? `„${pricedSkipped.join('“, „')}“ enthält Bieterpreise und ist damit ein Angebot, kein LV – bitte im Schritt „Unterlagen“ unter „Angebote der Bieter“ ablegen.` : bids ? 'Das sind Angebotsdateien (x84/p84/d84) – bitte im Schritt „Unterlagen“ unter „Angebote der Bieter“ ablegen.' : 'Kein LV erkannt. Erwartet: .x81/.x82/.x83 (GAEB DA XML), .p8x (GAEB 2000) oder .d8x (GAEB 90), optional das LV als PDF.' });
        }
      } else {
        const befunde = sortBefunde([...pruefeEigenesLv(lv), ...pdfBefunde]);
        up((d) => { applyLv(d, soll, schaetz, { lv: sollName, schaetz: schaetzName }); d.lvPruef = befunde; d.lvInfo = { ...d.lvInfo, pdfs: pdfNamen }; });
        const n = schaetz ? schaetz.positions.filter((p) => p.ep != null).length : 0;
        setMsg({ ok: true, text: [`LV geladen: ${soll.positions.length} Positionen (${sollName})`, n ? `LV-Schätzpreise: ${n} Positionen (${schaetzName})` : sr.lvInfo?.schaetz && sr.lvInfo.schaetz !== sr.lvInfo.lv ? `LV-Schätzpreise aus ${sr.lvInfo.schaetz} beibehalten` : 'keine Schätzpreise (GAEB 82) gefunden', pdfs.length ? `${pdfs.length} PDF abgeglichen` : '', pricedSkipped.length ? `Übersprungen (enthält Bieterpreise, gehört zu den Angeboten): ${pricedSkipped.join(', ')}` : '', sRef.current.offers.length ? 'Bereits geladene Angebote werden automatisch neu verglichen.' : ''].filter(Boolean).join(' · ') });
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
      <p className="lead">Ihr Leistungsverzeichnis als GAEB-Datei: <b>X81/X83</b> liefert Positionen und Mengen, <b>X82</b> (Kostenanschlag) die LV-Schätzpreise für den Preisvergleich und den Kostenvoranschlag je Los. Eine oder mehrere Dateien oder eine ZIP – die App erkennt die Rolle selbst. Maßnahme, Auftraggeber und Lose werden daraus vorbelegt. Legen Sie das LV zusätzlich als <b>PDF</b> dazu, wird es mit den GAEB-Daten abgeglichen (Positionen, Mengen) – so fallen Unstimmigkeiten schon vor der Ausschreibung auf.</p>
      <DropZone busy={busy} onFiles={process} title="LV-Dateien hierher ziehen (X81 · X82 · X83)" hint="Auch .p8x (GAEB 2000), .d8x (GAEB 90) und das LV als PDF · Daten verlassen Ihren Browser nicht" folder={false} />
      {msg && <p className={msg.ok ? 'okbox' : 'warnbox'}><Icon name={msg.ok ? 'check' : 'alert'} /> {msg.text}</p>}
      <div className="status">
        <Chip kind={hasLv ? 'ok' : 'warn'}>{hasLv ? `LV: ${s.lv.length} Positionen, ${s.lose.length} Los/Lose${s.lvInfo?.lv ? ` (${s.lvInfo.lv})` : ''}` : 'LV fehlt'}</Chip>
        <Chip kind={hasSchaetz ? 'ok' : 'info'}>{hasSchaetz ? `LV-Schätzpreise: ${Object.keys(s.schaetz).length} Positionen · ${fmtEur(schaetzGesamt)} netto` : 'keine LV-Schätzpreise (X82)'}</Chip>
        {hasLv && s.lv.some((p) => p.menge !== p.mengeOrig) && <Chip kind="info">{s.lv.filter((p) => p.menge !== p.mengeOrig).length} Menge(n) im LV angepasst</Chip>}
      </div>
      {(hasLv || hasSchaetz || pdfListe.length > 0) && (
        <ul className="filelist">
          {hasLv && <li><Icon name="file" /><span className="fname">{s.lvInfo?.lv || 'LV (Dateiname unbekannt)'}</span><Chip kind="info">LV · Positionen und Mengen</Chip>
            <button className="icon-btn" title="LV entfernen" onClick={() => { if (confirm('Eigenes LV entfernen? Positionen, LV-Schätzpreise und die Prüfung des LV werden gelöscht; Lose und Angebote bleiben erhalten und werden beim nächsten LV neu zugeordnet.')) { up(removeLv); setMsg(null); } }}><Icon name="trash" /></button></li>}
          {hasSchaetz && <li><Icon name="file" /><span className="fname">{s.lvInfo?.schaetz || 'Schätzpreise (Dateiname unbekannt)'}</span><Chip kind="info">LV-Schätzpreise</Chip>
            <button className="icon-btn" title="LV-Schätzpreise entfernen" onClick={() => up(removeSchaetz)}><Icon name="trash" /></button></li>}
          {pdfListe.map((n) => <li key={n}><Icon name="file" /><span className="fname">{n}</span><Chip kind="info">LV als PDF · Abgleich</Chip>
            <button className="icon-btn" title="PDF entfernen" onClick={() => up((d) => { d.lvPruef = d.lvPruef?.filter((b) => !vonPdf(b, n)); d.lvInfo = { ...d.lvInfo, pdfs: (d.lvInfo.pdfs ?? []).filter((x) => x !== n) }; })}><Icon name="trash" /></button></li>)}
        </ul>
      )}
      {hasLv && <p className="filehint">Weitere Dateien hinzufügen: oben ablegen. Eine X82 allein ergänzt die Schätzpreise, ein PDF wird zusätzlich abgeglichen, eine neue X81/X83 ersetzt das LV.</p>}
      {befunde.length > 0 && (
        <div className="lvpruef">
          <h3>Prüfung des LV</h3>
          {befunde.map((b, i) => <p key={i} className={b.kind === 'info' ? 'infobox' : 'warnbox slim'}><Icon name={b.kind === 'info' ? 'check' : 'alert'} /> {b.text}</p>)}
        </div>
      )}
    </section>
  );
}
