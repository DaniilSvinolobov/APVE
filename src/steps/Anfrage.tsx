import { useState } from 'react';
import type { Anfrage, Los, State } from '../domain/types';
import { aufklaerungsPositionen, type Cell } from '../domain/calc';
import { fmtNum, fmtPct } from '../domain/fmt';
import { anfrageCells, anfragePositionen, anfrageOf, anfrageText, ausschlussAuto, leereAnfrage } from '../vermerk/anfrage';
import { Icon, Seg } from '../components/ui';
import { downloadText } from '../storage/exportCsv';

type Up = (fn: (d: State) => void) => void;

/** Text für die E-Mail an den Auftraggeber: Ausschluss vorab empfehlen und Angebotskalkulation zu auffälligen Positionen nachfordern. */
export function AnfrageKarte({ s, up, los, cells }: { s: State; up: Up; los: Los; cells: Cell[] }) {
  const runden = [...new Set(cells.map((c) => c.offer.runde))].sort();
  const [rundeSel, setRunde] = useState<number | null>(null);
  const [kopiert, setKopiert] = useState(false);
  const runde = rundeSel != null && runden.includes(rundeSel as 1 | 2 | 3) ? rundeSel : runden[0] ?? 1;
  const a = anfrageOf(s, los);
  const rc = anfrageCells(cells, runde);
  if (rc.length < 2 && !Object.keys(s.schaetz ?? {}).length) return null;

  const set = (fn: (a: Anfrage) => void) => up((d) => {
    const x: Anfrage = { ...leereAnfrage(), ...(d.anfrage?.[los.id] ?? {}) };
    fn(x);
    d.anfrage = { ...(d.anfrage ?? {}), [los.id]: x };
  });
  const text = anfrageText(s, los, cells, runde);
  const p = s.project;
  const betreff = [p.nummer, p.titel, 'Angebotsprüfung'].filter((x) => x?.trim()).join(' – ');
  const kopieren = async () => {
    try { await navigator.clipboard.writeText(text); setKopiert(true); setTimeout(() => setKopiert(false), 2000); }
    catch { setKopiert(false); alert('Kopieren nicht möglich – bitte den Text in der Vorschau markieren und kopieren.'); }
  };

  return (
    <section className="card">
      <h2>Angebotskalkulation anfordern</h2>
      <p className="lead">E-Mail an den Auftraggeber während der Prüfung. Vorgeschlagen werden Positionen, deren Einheitspreis um mehr als {fmtNum(p.abweichung, 0)} % vom Mittel der übrigen Angebote{Object.keys(s.schaetz ?? {}).length ? ' und vom LV-Schätzpreis' : ''} abweicht. Die Liste ist änderbar.</p>
      {runden.length > 1 && <div className="anfrage-runde"><Seg small value={runde} onChange={setRunde} options={runden.map((r) => ({ value: r, label: r === runden[0] ? 'Hauptangebote' : `Nachverhandlung ${r - 1}` }))} /></div>}
      <label className="field wide"><span className="field-label">Anrede</span>
        <textarea rows={2} value={a.anrede} onChange={(e) => set((x) => void (x.anrede = e.target.value))} placeholder="Sehr geehrte Damen und Herren," />
      </label>
      <div className="stack">
        {rc.map((c) => {
          const aus = c.offer.id in a.ausschluss;
          const pl = anfragePositionen(s, los, cells, c, a);
          const details = new Map(aufklaerungsPositionen(s, los, cells, c, Object.keys(a.ausschluss)).map((x) => [x.oz, x]));
          const toggle = (oz: string) => set((x) => {
            const l = pl.liste.includes(oz) ? pl.liste.filter((o) => o !== oz) : [...pl.liste, oz].sort((m, n) => m.localeCompare(n, 'de', { numeric: true }));
            x.pos = { ...x.pos, [c.offer.id]: l.join(', ') };
          });
          return (
            <div className="bewcard" key={c.offer.id}>
              <h3>Nr. {c.offer.nr} · {c.offer.firma} <span className="muted">({fmtPct(c.dKosten)} zum Kostenvoranschlag, {fmtPct(c.dMin)} zum günstigsten)</span></h3>
              <label className="mini big"><input type="checkbox" checked={aus} onChange={(e) => set((x) => {
                const n = { ...x.ausschluss };
                if (e.target.checked) n[c.offer.id] = ''; else delete n[c.offer.id];
                x.ausschluss = n;
              })} /> Ausschluss von der weiteren Prüfung vorab empfehlen</label>
              {aus ? (
                <label className="field wide"><span className="field-label">Begründung („…, da …“)</span>
                  <textarea rows={2} value={a.ausschluss[c.offer.id]} onChange={(e) => set((x) => void (x.ausschluss = { ...x.ausschluss, [c.offer.id]: e.target.value }))} placeholder={(() => { const v = ausschlussAuto(s, los, cells, c); return v.startsWith('[') ? 'z. B. das Angebot weit über unserem Schätzpreis liegt' : `Leer = automatisch: ${v}`; })()} />
                </label>
              ) : (
                <>
                  <div className="auff">
                    {pl.auto.length ? (
                      <div>{pl.auto.map((oz) => {
                        const d = details.get(oz);
                        const on = pl.liste.includes(oz);
                        return (
                          <button key={oz} type="button" className={`oz pick${on ? '' : ' off'}`} onClick={() => toggle(oz)}
                            title={d ? `${d.kurz}: EP ${fmtNum(d.ep)} €${d.avg != null ? ` · Ø übrige ${fmtNum(d.avg)} €` : ''}${d.schaetz != null ? ` · Schätzpreis ${fmtNum(d.schaetz)} €` : ''} – klicken zum ${on ? 'Entfernen' : 'Aufnehmen'}` : oz}>{oz}</button>
                        );
                      })}</div>
                    ) : <span className="muted">Keine auffälligen Einzelpreise erkannt.</span>}
                  </div>
                  <label className="field wide"><span className="field-label">Positionen in der E-Mail</span>
                    <input value={pl.liste.join(', ')} onChange={(e) => set((x) => void (x.pos = { ...x.pos, [c.offer.id]: e.target.value }))} placeholder="keine – Bieter wird nicht aufgeführt" />
                    {pl.manuell && <span className="field-hint">Von Hand geändert · <button type="button" className="link" onClick={() => set((x) => { const n = { ...x.pos }; delete n[c.offer.id]; x.pos = n; })}>automatisch</button></span>}
                  </label>
                </>
              )}
            </div>
          );
        })}
      </div>
      <h3>Text der E-Mail</h3>
      <pre className="prev">{text}</pre>
      <div className="row">
        <button className="btn" onClick={kopieren}><Icon name="file" /> {kopiert ? 'Kopiert' : 'Text kopieren'}</button>
        <a className="btn" href={`mailto:?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`}><Icon name="arrow" /> In E-Mail-Programm öffnen</a>
        <button className="btn" onClick={() => downloadText(`Angebotskalkulation_${los.nr}.txt`, text)}><Icon name="download" /> Als Textdatei</button>
      </div>
    </section>
  );
}
