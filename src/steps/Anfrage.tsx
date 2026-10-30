import { Fragment, useState } from 'react';
import type { Anfrage, AnfrageModus, Los, State } from '../domain/types';
import type { AufklPos, Cell } from '../domain/calc';
import { fmtEur, fmtNum, fmtPct, round2 } from '../domain/fmt';
import { anfrageBieter, anfrageOf, anfrageText, ausschlussAuto, leereAnfrage, type AnfrageBieter } from '../vermerk/anfrage';
import { getBew, mindestEuro, titelKey } from '../domain/calc';
import { FlagList, Icon, Seg } from '../components/ui';
import { downloadText } from '../storage/exportCsv';

type Up = (fn: (d: State) => void) => void;
type SetA = (fn: (a: Anfrage) => void) => void;

const ROLLE: Record<AnfrageBieter['rolle'], string> = {
  engere: 'Engere Wahl · Kalkulation nachfordern',
  raus: 'Nicht in der engeren Wahl · Ausschluss empfehlen',
  ausgeschlossen: 'Ausgeschlossen · Ausschluss empfehlen',
};

export const ozSort = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });
const eur0 = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), 0)} €`;

/** E-Mail an den Auftraggeber: je Bieter Angebotskalkulation zu auffälligen Positionen nachfordern oder Ausschluss vorab empfehlen. */
export function AnfrageKarte({ s, up, los, cells, offen, setOffen }: { s: State; up: Up; los: Los; cells: Cell[]; offen: boolean; setOffen: (v: boolean) => void }) {
  const runden = [...new Set(cells.map((c) => c.offer.runde))].sort();
  const [rundeSel, setRunde] = useState<number | null>(null);
  const [kopiert, setKopiert] = useState(false);
  const runde = rundeSel != null && runden.includes(rundeSel as 1 | 2 | 3) ? rundeSel : runden[0] ?? 1;
  const bieter = anfrageBieter(s, los, cells, runde);
  if (!bieter.length) return null;

  const a = anfrageOf(s, los);
  const p = s.project;
  const mitSchaetz = Object.keys(s.schaetz ?? {}).length > 0;
  const minEuro = mindestEuro(cells, runde);
  const set: SetA = (fn) => up((d) => {
    const x: Anfrage = { ...leereAnfrage(), ...(d.anfrage?.[los.id] ?? {}) };
    fn(x);
    d.anfrage = { ...(d.anfrage ?? {}), [los.id]: x };
  });
  const text = anfrageText(s, los, cells, runde);
  const betreff = [p.nummer, p.titel, 'Angebotsprüfung'].filter((x) => x?.trim()).join(' – ');
  const kopieren = async () => {
    try { await navigator.clipboard.writeText(text); setKopiert(true); setTimeout(() => setKopiert(false), 2000); }
    catch { alert('Kopieren nicht möglich – bitte den Text in der Vorschau markieren und kopieren.'); }
  };

  return (
    <section className="card anfrage">
      <div className="card-head">
        <div>
          <h2>Rückfrage an den Auftraggeber <span className="muted">(optional)</span></h2>
          <p className="lead">E-Mail, um Angebotskalkulationen zu auffälligen Positionen nachzufordern oder einen Ausschluss zu empfehlen. Die Rangfolge ändert sich dadurch nicht.</p>
        </div>
        <button className="btn" onClick={() => setOffen(!offen)}>{offen ? 'Einklappen' : 'E-Mail erstellen'}</button>
      </div>
      {offen && <>
      {runden.length > 1 && <div className="anfrage-runde"><Seg small value={runde} onChange={setRunde} options={runden.map((r) => ({ value: r, label: r === runden[0] ? 'Hauptangebote' : `Nachverhandlung ${r - 1}` }))} /></div>}

      <h3 className="anf-h">Bieter und Positionen</h3>
      <p className="muted small">Richtet sich nach der Rangfolge oben: <b>Engere Wahl</b> → Kalkulation zu auffälligen Positionen nachfordern (Einheitspreis mehr als {fmtNum(p.abweichung, 0)} % neben {mitSchaetz ? 'unserem LV-Schätzpreis, ohne Schätzpreis dem günstigsten Angebot' : 'dem günstigsten Angebot'}, Auswirkung ab {fmtNum(minEuro, 0)} €). <b>Nicht in der engeren Wahl</b> oder <b>ausgeschlossen</b> → Ausschluss empfehlen. Ändern über die Haken in der Rangfolge.</p>

      <div className="stack">
        {bieter.map((b) => <BieterZeile key={b.c.offer.id} s={s} b={b} a={a} set={set} titles={s.titles} minEuro={minEuro} wertung={getBew(s, b.c.offer.id, los.id).ausschluss.trim()} />)}
      </div>

      <h3 className="anf-h">E-Mail-Text</h3>
      <label className="field wide"><span className="field-label">Anrede</span>
        <textarea rows={2} value={a.anrede} onChange={(e) => set((x) => void (x.anrede = e.target.value))} placeholder="Sehr geehrte Damen und Herren," />
      </label>
      <pre className="prev">{text}</pre>
      <div className="row">
        <button className="btn primary" onClick={kopieren}><Icon name={kopiert ? 'check' : 'file'} /> {kopiert ? 'Kopiert' : 'Text kopieren'}</button>
        <a className="btn" href={`mailto:?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`}><Icon name="arrow" /> In E-Mail-Programm öffnen</a>
        <button className="btn" onClick={() => downloadText(`Rueckfrage_${los.nr}.txt`, text)}><Icon name="download" /> Als Textdatei</button>
      </div>
      </>}
    </section>
  );
}

function BieterZeile({ s, b, a, set, titles, minEuro, wertung }: { s: State; b: AnfrageBieter; a: Anfrage; set: SetA; titles: Record<string, string>; minEuro: number; wertung: string }) {
  const [neu, setNeu] = useState('');
  const { c } = b;
  const id = c.offer.id;
  const setListe = (l: string[]) => set((x) => void (x.pos = { ...x.pos, [id]: [...new Set(l)].sort(ozSort).join(', ') }));
  const toggle = (oz: string) => setListe(b.liste.includes(oz) ? b.liste.filter((o) => o !== oz) : [...b.liste, oz]);
  const toggleAlle = (ozs: string[], an: boolean) => setListe(an ? [...b.liste, ...ozs] : b.liste.filter((o) => !ozs.includes(o)));
  const byOz = new Map(b.vergleich.map((v) => [v.oz, v]));
  // Hauptliste: Vorschläge und von Hand gewählte, in LV-Reihenfolge (Ordnungszahl); darunter abweichende Positionen mit geringer Auswirkung
  const nachOz = (x: AufklPos, y: AufklPos) => ozSort(x.oz, y.oz);
  const haupt = b.vergleich.filter((v) => v.status === 'auffaellig' || b.liste.includes(v.oz)).sort(nachOz);
  const fremd = b.liste.filter((oz) => !byOz.has(oz));
  const gering = b.vergleich.filter((v) => v.status === 'gering' && !b.liste.includes(v.oz)).sort(nachOz);
  const gewaehlt = b.vergleich.filter((v) => b.liste.includes(v.oz));
  const summe = round2(gewaehlt.reduce((acc, v) => acc + v.delta, 0));
  const hinzu = () => {
    const oz = neu.trim();
    if (oz) setListe([...b.liste, oz]);
    setNeu('');
  };
  const auto = ausschlussAuto(s, b);
  const setModus = (m: AnfrageModus) => set((x) => void (x.modus = { ...x.modus, [id]: m }));
  const kopf = (
    <tr><th /><th className="left">Pos.</th><th className="left">Kurztext</th><th className="r">Menge</th><th className="r">EP Bieter</th><th className="r">GP Bieter</th><th className="r">Vergleichs-EP</th><th className="r">Auswirkung</th></tr>
  );
  const zeile = (v: AufklPos) => {
    const on = b.liste.includes(v.oz);
    return (
      <tr key={v.oz} className={on ? '' : 'off'} onClick={() => toggle(v.oz)}>
        <td><input type="checkbox" checked={on} readOnly aria-label={`Pos. ${v.oz} in die E-Mail`} /></td>
        <td className="left nowrap">{v.oz}</td>
        <td className="left">{v.kurz}</td>
        <td className="r nowrap">{fmtNum(v.menge, v.menge % 1 ? 2 : 0)} {v.einheit}</td>
        <td className="r nowrap">{fmtEur(v.ep)}</td>
        <td className="r nowrap">{fmtEur(v.gp)}</td>
        <td className="r nowrap">{v.ref != null ? <>{fmtEur(v.ref)}<small className="muted block">{fmtPct(v.pct, 0)} · {v.refQuelle === 'schaetz' ? 'LV-Schätzpreis' : 'günstigster'}</small></> : '–'}</td>
        <td className={`r nowrap anf-delta ${v.delta > 0 ? 'hoch' : 'tief'}`}>{eur0(v.delta)}</td>
      </tr>
    );
  };

  /** Positionen je Titel mit Kopfzeile; der Haken im Kopf wählt alle Positionen des Titels ab bzw. zu. */
  const gruppen = (vs: AufklPos[]) => {
    const g = new Map<string, AufklPos[]>();
    for (const v of vs) g.set(titelKey(v.oz), [...(g.get(titelKey(v.oz)) ?? []), v]);
    return [...g].map(([tk, ps]) => {
      const ozs = ps.map((v) => v.oz);
      const alle = ozs.every((o) => b.liste.includes(o));
      return (
        <Fragment key={tk}>
          <tr className="anf-titel" onClick={() => toggleAlle(ozs, !alle)}>
            <td><input type="checkbox" checked={alle} ref={(el) => { if (el) el.indeterminate = !alle && ozs.some((o) => b.liste.includes(o)); }} readOnly aria-label={`Titel ${tk} in die E-Mail`} /></td>
            <td className="left nowrap">{tk}</td><td className="left" colSpan={6}>{titles[tk] || `Titel ${tk}`} <small className="muted">· {ps.length} Pos.</small></td>
          </tr>
          {ps.map(zeile)}
        </Fragment>
      );
    });
  };

  return (
    <div className={`anf-bieter ${b.modus}`} id={`anf-${id}`}>
      <div className="anf-kopf">
        <label className="mini big">
          <input type="checkbox" checked={b.modus !== 'ohne'} onChange={(e) => setModus(e.target.checked ? (b.rolle === 'engere' ? 'nach' : 'aus') : 'ohne')} aria-label={`Nr. ${c.offer.nr} in die E-Mail`} />
          <span><b>Nr. {c.offer.nr} · {c.offer.firma}</b>
          <small className="muted block">{fmtEur(c.sumNet)} netto · {fmtPct(c.dKosten)} zum Kostenvoranschlag · {fmtPct(c.dMin)} zum günstigsten · {b.auto.length ? `${b.auto.length} auffällige Position${b.auto.length > 1 ? 'en' : ''}` : 'keine auffälligen Positionen'}</small></span>
        </label>
        <span className="muted small">{b.modus !== 'ohne' ? ROLLE[b.rolle] : b.rolle === 'engere' && !b.auto.length ? 'Engere Wahl · nichts nachzufordern' : 'nicht in der E-Mail'}</span>
      </div>

      {b.modus === 'nach' && (
        <div className="anf-body">
          {haupt.length + fremd.length > 0 && (
            <div className="scroll">
              <table className="anf-tab">
                <thead>{kopf}</thead>
                <tbody>
                  {gruppen(haupt)}
                  {fremd.map((oz) => (
                    <tr key={oz} onClick={() => toggle(oz)}><td><input type="checkbox" checked readOnly aria-label={`Pos. ${oz} in die E-Mail`} /></td><td className="left nowrap">{oz}</td><td className="left muted" colSpan={6}>nicht im LV dieses Loses</td></tr>
                  ))}
                </tbody>
                {gewaehlt.length > 0 && (
                  <tfoot><tr><td /><td className="left" colSpan={6}>{gewaehlt.length} Position{gewaehlt.length > 1 ? 'en' : ''} in der E-Mail · zusammen {c.sumNet ? `${fmtNum(Math.abs(summe) / c.sumNet * 100, 1)} % der Angebotssumme` : ''}</td><td className={`r nowrap anf-delta ${summe > 0 ? 'hoch' : 'tief'}`}>{eur0(summe)}</td></tr></tfoot>
                )}
              </table>
            </div>
          )}
          {gering.length > 0 && (
            <details className="det">
              <summary>{gering.length} weitere Position{gering.length > 1 ? 'en' : ''} mit deutlicher Abweichung, aber Auswirkung unter {fmtNum(minEuro, 0)} €</summary>
              <div className="scroll"><table className="anf-tab"><thead>{kopf}</thead><tbody>{gruppen(gering)}</tbody></table></div>
            </details>
          )}
          <div className="row anf-add">
            <input list={`oz-${id}`} value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && hinzu()} placeholder="Pos. hinzufügen, z. B. 01.2" aria-label="Position hinzufügen" />
            <datalist id={`oz-${id}`}>{b.vergleich.filter((v) => !b.liste.includes(v.oz)).map((v) => <option key={v.oz} value={v.oz}>{v.kurz}</option>)}</datalist>
            <button className="btn small" onClick={hinzu} disabled={!neu.trim()}>Hinzufügen</button>
            {b.manuell && <button className="link" onClick={() => set((x) => { const n = { ...x.pos }; delete n[id]; x.pos = n; })}>Vorschlag wiederherstellen</button>}
          </div>
          {!b.liste.length && <FlagList items={[{ kind: 'warn', text: 'Keine Position gewählt – der Bieter erscheint nicht in der E-Mail.' }]} />}
        </div>
      )}

      {b.modus === 'aus' && wertung && <p className="muted small anf-body">Grund aus der Wertung: „… aufgrund {wertung.replace(/\.$/, '')} von der weiteren Angebotsprüfung auszuschließen.“</p>}
      {b.modus === 'aus' && !wertung && (
        <div className="anf-body">
          <label className="field wide"><span className="field-label">Begründung („… auszuschließen, da …“)</span>
            <textarea rows={2} value={a.grund[id] ?? ''} onChange={(e) => set((x) => void (x.grund = { ...x.grund, [id]: e.target.value }))} placeholder={auto ? `Leer = automatisch: ${auto}` : 'z. B. das Angebot weit über unserem Schätzpreis liegt'} />
          </label>
          {!auto && !(a.grund[id] ?? '').trim() && <FlagList items={[{ kind: 'warn', text: 'Bitte Begründung angeben.' }]} />}
        </div>
      )}
    </div>
  );
}
