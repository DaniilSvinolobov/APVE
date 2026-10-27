import { useState } from 'react';
import type { Anfrage, AnfrageModus, Los, State } from '../domain/types';
import type { Cell } from '../domain/calc';
import { fmtNum, fmtPct } from '../domain/fmt';
import { anfrageBieter, anfrageOf, anfrageText, ausschlussAuto, leereAnfrage, type AnfrageBieter } from '../vermerk/anfrage';
import { FlagList, Icon, Seg } from '../components/ui';
import { downloadText } from '../storage/exportCsv';

type Up = (fn: (d: State) => void) => void;
type SetA = (fn: (a: Anfrage) => void) => void;

const MODI: { value: AnfrageModus; label: string }[] = [
  { value: 'ohne', label: 'Nicht erwähnen' },
  { value: 'nach', label: 'Kalkulation nachfordern' },
  { value: 'aus', label: 'Ausschluss empfehlen' },
];

/** E-Mail an den Auftraggeber: je Bieter Angebotskalkulation zu auffälligen Positionen nachfordern oder Ausschluss vorab empfehlen. */
export function AnfrageKarte({ s, up, los, cells }: { s: State; up: Up; los: Los; cells: Cell[] }) {
  const runden = [...new Set(cells.map((c) => c.offer.runde))].sort();
  const [rundeSel, setRunde] = useState<number | null>(null);
  const [kopiert, setKopiert] = useState(false);
  const runde = rundeSel != null && runden.includes(rundeSel as 1 | 2 | 3) ? rundeSel : runden[0] ?? 1;
  const bieter = anfrageBieter(s, los, cells, runde);
  if (!bieter.length) return null;

  const a = anfrageOf(s, los);
  const p = s.project;
  const mitSchaetz = Object.keys(s.schaetz ?? {}).length > 0;
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
      <h2>Rückfrage an den Auftraggeber</h2>
      <p className="lead">E-Mail während der Prüfung: Angebotskalkulation zu auffälligen Positionen nachfordern oder einen Bieter vorab zum Ausschluss empfehlen. <b>Die Auswahl gilt nur für diese E-Mail</b> – Wertung und Vergabevermerk bleiben unverändert.</p>
      {runden.length > 1 && <div className="anfrage-runde"><Seg small value={runde} onChange={setRunde} options={runden.map((r) => ({ value: r, label: r === runden[0] ? 'Hauptangebote' : `Nachverhandlung ${r - 1}` }))} /></div>}

      <h3 className="anf-h">1 · Bieter</h3>
      <p className="muted anf-sub">Vorgeschlagen sind Positionen, deren Einheitspreis um mehr als {fmtNum(p.abweichung, 0)} % vom Mittel der übrigen Angebote{mitSchaetz ? ' und vom LV-Schätzpreis' : ''} abweicht. Zum Ausschluss empfohlene Bieter zählen dabei nicht mit.</p>
      <div className="stack">
        {bieter.map((b) => <BieterZeile key={b.c.offer.id} b={b} a={a} set={set} mitSchaetz={mitSchaetz} />)}
      </div>

      <h3 className="anf-h">2 · E-Mail</h3>
      <label className="field wide"><span className="field-label">Anrede</span>
        <textarea rows={2} value={a.anrede} onChange={(e) => set((x) => void (x.anrede = e.target.value))} placeholder="Sehr geehrte Damen und Herren," />
      </label>
      <pre className="prev">{text}</pre>
      <div className="row">
        <button className="btn primary" onClick={kopieren}><Icon name={kopiert ? 'check' : 'file'} /> {kopiert ? 'Kopiert' : 'Text kopieren'}</button>
        <a className="btn" href={`mailto:?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`}><Icon name="arrow" /> In E-Mail-Programm öffnen</a>
        <button className="btn" onClick={() => downloadText(`Rueckfrage_${los.nr}.txt`, text)}><Icon name="download" /> Als Textdatei</button>
      </div>
    </section>
  );
}

function BieterZeile({ b, a, set, mitSchaetz }: { b: AnfrageBieter; a: Anfrage; set: SetA; mitSchaetz: boolean }) {
  const [neu, setNeu] = useState('');
  const { c } = b;
  const id = c.offer.id;
  const setListe = (l: string[]) => set((x) => void (x.pos = { ...x.pos, [id]: l.join(', ') }));
  const toggle = (oz: string) => setListe(b.liste.includes(oz) ? b.liste.filter((o) => o !== oz) : [...b.liste, oz]);
  const byOz = new Map(b.vergleich.map((v) => [v.oz, v]));
  const zeilen = [...new Set([...b.auto, ...b.liste])].sort((m, n) => m.localeCompare(n, 'de', { numeric: true }));
  const hinzu = () => {
    const oz = neu.trim();
    if (oz && !b.liste.includes(oz)) setListe([...b.liste, oz]);
    setNeu('');
  };
  const auto = ausschlussAuto(b);

  return (
    <div className={`anf-bieter ${b.modus}`}>
      <div className="anf-kopf">
        <div>
          <b>Nr. {c.offer.nr} · {c.offer.firma}</b>
          <small className="muted block">{fmtPct(c.dKosten)} zum Kostenvoranschlag · {fmtPct(c.dMin)} zum günstigsten · {b.auto.length ? `${b.auto.length} auffällige Position${b.auto.length > 1 ? 'en' : ''}` : 'keine auffälligen Positionen'}</small>
        </div>
        <Seg small value={b.modus} onChange={(m) => set((x) => void (x.modus = { ...x.modus, [id]: m }))} options={MODI} />
      </div>

      {b.modus === 'nach' && (
        <div className="anf-body">
          {zeilen.length > 0 && (
            <div className="scroll">
              <table className="anf-tab">
                <thead><tr><th /><th className="left">Pos.</th><th className="left">Kurztext</th><th className="r">EP Bieter</th><th className="r">Ø übrige</th>{mitSchaetz && <th className="r">Schätzpreis</th>}</tr></thead>
                <tbody>
                  {zeilen.map((oz) => {
                    const v = byOz.get(oz);
                    const on = b.liste.includes(oz);
                    const pct = (ref: number | null) => (v && ref ? <small className="muted block">{fmtPct((v.ep / ref - 1) * 100, 0)}</small> : null);
                    return (
                      <tr key={oz} className={on ? '' : 'off'} onClick={() => toggle(oz)}>
                        <td><input type="checkbox" checked={on} readOnly aria-label={`Pos. ${oz} in die E-Mail`} /></td>
                        <td className="left nowrap">{oz}</td>
                        <td className="left">{v?.kurz ?? <span className="muted">nicht im LV dieses Loses</span>}</td>
                        <td className="r">{v ? `${fmtNum(v.ep)} €` : '–'}</td>
                        <td className="r">{v?.avg != null ? <>{fmtNum(v.avg)} €{pct(v.avg)}</> : '–'}</td>
                        {mitSchaetz && <td className="r">{v?.schaetz != null ? <>{fmtNum(v.schaetz)} €{pct(v.schaetz)}</> : '–'}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="row anf-add">
            <input list={`oz-${id}`} value={neu} onChange={(e) => setNeu(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && hinzu()} placeholder="Pos. hinzufügen, z. B. 01.2" aria-label="Position hinzufügen" />
            <datalist id={`oz-${id}`}>{b.vergleich.filter((v) => !zeilen.includes(v.oz)).map((v) => <option key={v.oz} value={v.oz}>{v.kurz}</option>)}</datalist>
            <button className="btn small" onClick={hinzu} disabled={!neu.trim()}>Hinzufügen</button>
            {b.manuell && <button className="link" onClick={() => set((x) => { const n = { ...x.pos }; delete n[id]; x.pos = n; })}>Vorschlag wiederherstellen</button>}
          </div>
          {!b.liste.length && <FlagList items={[{ kind: 'warn', text: 'Keine Position gewählt – der Bieter erscheint nicht in der E-Mail.' }]} />}
        </div>
      )}

      {b.modus === 'aus' && (
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
