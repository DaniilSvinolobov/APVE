import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { Bew, State } from '../domain/types';
import { computeLos, emptyBew, engereWahl, getBew, mindestEuro, positionsVergleich, titelVergleich, zuschlagCell, bewKey, type AufklPos, type Cell, type RefQuelle, type TitelVergleich } from '../domain/calc';
import { fmtEur, fmtNum, fmtPct } from '../domain/fmt';
import { bewText, nichtGewertetAuto, nichtGewertetText } from '../vermerk/vermerk';
import { Chip, FlagList, Icon, NumInput, Tabs } from '../components/ui';
import { entfernung, KM_HINWEIS, useGeo } from '../geo/entfernung';
import { EignungEinwilligung, EignungKi, useEignung } from './EignungKi';
import { NuEditor } from './Nachunternehmer';
import { AnfrageKarte } from './Anfrage';
import { leereAnfrage } from '../vermerk/anfrage';

type Up = (fn: (d: State) => void) => void;

export function StepWertung({ s, up }: { s: State; up: Up }) {
  const [losId, setLosId] = useState(s.lose[0]?.id ?? '');
  useGeo();
  const eig = useEignung();
  const [anfrageOffen, setAnfrageOffen] = useState<Record<string, boolean>>({});
  const los = s.lose.find((l) => l.id === losId) ?? s.lose[0];
  const cells = useMemo(() => (los ? computeLos(s, los) : []), [s, los]);
  if (!los) return <section className="card"><h2>Wertung</h2><p className="muted">Bitte zuerst Lose anlegen bzw. das LV laden.</p></section>;

  const setBew = (offerId: string, patch: Partial<Bew>) => up((d) => void (d.bew[bewKey(offerId, los.id)] = { ...emptyBew(), ...(d.bew[bewKey(offerId, los.id)] ?? {}), ...patch }));
  const runden = [...new Set(cells.map((c) => c.offer.runde))].sort();
  const win = zuschlagCell(s, los, cells);
  const eligible = cells.filter((c) => c.eligible);
  const finalR = win?.offer.runde;

  const detail: Cell[] = [];
  const hrl = cells.length ? Math.min(...cells.map((c) => c.offer.runde)) : 1;
  const ew = engereWahl(s, cells);
  const first = ew.take;
  detail.push(...first, ...cells.filter((c) => c.offer.runde > hrl && c.rankAll).sort((a, b) => a.offer.runde - b.offer.runde || a.rankAll! - b.rankAll!));
  // Engere Wahl per Haken in der Rangtabelle (nur erste Runde, mehr als ein Angebot)
  const mitEw = ew.ranked.length > 1;
  const setEw = (id: string, on: boolean) => up((d) => {
    const ids = ew.take.map((x) => x.offer.id).filter((x) => x !== id);
    if (on) ids.push(id);
    d.engere = { ...(d.engere ?? {}), [los.id]: ids };
  });
  const raus = ew.ranked.filter((c) => !ew.take.includes(c));

  return (
    <div className="stack">
      <section className="card">
        <h2>Wertung</h2>
        <p className="lead">Je Los: <b>1</b> Rangfolge prüfen · <b>2</b> Vergabevorschlag bestätigen · <b>3</b> Begründung für den Vermerk ergänzen.</p>
        <Tabs value={los.id} onChange={setLosId} items={s.lose.map((l) => ({ value: l.id, label: l.nr, sub: l.name }))} />
      </section>

      {cells.length === 0 && <section className="card"><p className="muted">Für {los.nr} liegen keine Angebote vor (Schritt 2 → „Angebot gilt für“).</p></section>}

      {runden.map((r) => {
        const rc = cells.filter((c) => c.offer.runde === r);
        const ewHier = mitEw && r === hrl;
        const ncol = ewHier ? 9 : 8;
        return (
          <section className="card" key={r}>
            <h2><span className="stepno">1</span>Rangfolge {los.nr} · {r === hrl ? (r === 1 ? 'Hauptangebote' : 'Angebote') : 'Nachverhandlung'}</h2>
            {r !== hrl && (
              <label className="field wide nvgrund"><span className="field-label">Anlass der Nachverhandlung</span>
                <textarea rows={2} value={s.nvGrund?.[los.id] ?? ''} onChange={(e) => up((d) => void (d.nvGrund = { ...(d.nvGrund ?? {}), [los.id]: e.target.value }))} placeholder="z. B. Missverständnisse bei Positionen, falsche Menge im LV …" />
              </label>
            )}
            {ewHier && <p className="lead">Haken bei <b>Engere Wahl</b>: Angebot wird im Vermerk einzeln begründet, für die übrigen steht dort ein kurzer Satz. {ew.manuell ? <button className="link" onClick={() => up((d) => { const e = { ...(d.engere ?? {}) }; delete e[los.id]; d.engere = e; })}>Vorbelegung wiederherstellen</button> : `Vorbelegt: die ${Math.max(1, s.project.engereWahl)} günstigsten.`}</p>}
            <div className="scroll">
              <table className="matrix rank">
                <thead><tr>{ewHier && <th>Engere Wahl</th>}<th>Rang</th><th>Nr.</th><th className="left">Bieter</th><th className="r">Netto</th><th className="r">Brutto</th><th className="r">zum günstigsten</th><th className="r">zum Kostenvoranschlag</th><th className="left">Hinweise</th></tr></thead>
                <tbody>
                  {rc.map((c) => {
                    const b = getBew(s, c.offer.id, los.id);
                    const needsAufk = c.flags.some((f) => f.text.includes('Aufklärung')) || b.aufklaerung !== '';
                    const isWin = win?.offer.id === c.offer.id;
                    const inEw = ew.ranked.includes(c);
                    const ewOn = ew.take.includes(c);
                    return (
                      <Fragment key={c.offer.id}>
                        <tr className={c.excluded ? 'dim' : isWin ? 'first' : ''}>
                          {ewHier && <td>{inEw && <input type="checkbox" checked={ewOn} disabled={ewOn && ew.take.length === 1} onChange={(e) => setEw(c.offer.id, e.target.checked)} aria-label={`Nr. ${c.offer.nr} in die engere Wahl`} />}</td>}
                          <td>{c.rankAll ? <span className={`rankbadge ${isWin ? 'one' : ''}`}>{c.rankAll}</span> : '–'}</td>
                          <td>{c.offer.nr}</td>
                          <td className="left"><b>{c.offer.firma}</b><small className="muted block">{c.offer.ort}{(() => { const e = entfernung(s, c.offer); return e ? ` · ca. ${e.km} km zur Baustelle` : ''; })()}</small></td>
                          <td className="r">{fmtEur(c.net)}{c.nachlass ? <small className="muted block">nach {fmtNum(c.nachlass)} % Nachlass</small> : null}</td>
                          <td className="r">{fmtEur(c.gross)}</td>
                          <td className="r">{c.rankAll ? fmtPct(c.dMin) : '–'}</td>
                          <td className="r">{fmtPct(c.dKosten)}</td>
                          <td className="left flags">
                            <FlagList items={c.flags.length === 0 && c.eligible ? [{ kind: 'ok', text: 'Keine Auffälligkeiten' }] : c.flags} />
                            <div className="row acts">
                              <label className="mini"><input type="checkbox" checked={!!b.ausschluss} onChange={(e) => setBew(c.offer.id, { ausschluss: e.target.checked ? 'fehlender Eignungsnachweise' : '' })} /> ausschließen</label>
                              {needsAufk && (
                                <select value={b.aufklaerung} onChange={(e) => setBew(c.offer.id, { aufklaerung: e.target.value as Bew['aufklaerung'] })} aria-label="Preisaufklärung">
                                  <option value="">Preisaufklärung: offen</option><option value="angemessen">Preis aufgeklärt – angemessen</option><option value="unangemessen">Preis unangemessen – nicht werten</option>
                                </select>
                              )}
                            </div>
                          </td>
                        </tr>
                        {ewHier && inEw && !ewOn && (
                          <tr><td colSpan={ncol} className="reason">
                            <span>Grund</span>
                            <input value={b.nichtGewertet} onChange={(e) => setBew(c.offer.id, { nichtGewertet: e.target.value })} placeholder={nichtGewertetAuto(s, c, ew.take) ? 'leer lassen = Text aus den Preisen (siehe unten)' : 'Grund angeben – das Angebot ist günstiger als ein gewähltes'} />
                            <small className="muted block ewvorschau">Im Vermerk: {nichtGewertetText(s, c, ew.take)}</small>
                          </td></tr>
                        )}
                        {b.ausschluss && (
                          <tr><td colSpan={ncol} className="reason"><span>Aufgrund</span><input value={b.ausschluss} onChange={(e) => setBew(c.offer.id, { ausschluss: e.target.value })} placeholder="… fehlender Referenzen in vergleichbaren Leistungen wurde das Angebot ausgeschlossen" /></td></tr>
                        )}
                        {b.aufklaerung && (
                          <tr><td colSpan={ncol} className="reason"><span>Aufklärung</span><input value={b.aufklaerungNotiz} onChange={(e) => setBew(c.offer.id, { aufklaerungNotiz: e.target.value })} placeholder="Begründung des Bieters / Ergebnis kurz festhalten" /></td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {ewHier && raus.length > 0 && (
              <label className="field wide"><span className="field-label">Festlegung zur engeren Wahl (optional, steht vor den Sätzen im Vermerk)</span>
                <textarea rows={2} value={s.engereNotiz?.[los.id] ?? ''} onChange={(e) => up((d) => void (d.engereNotiz = { ...(d.engereNotiz ?? {}), [los.id]: e.target.value }))} placeholder="z. B. In Abstimmung mit der Vergabestelle wurde die Prüfung auf die drei günstigsten Bieter beschränkt." />
              </label>
            )}
            {ewHier && win && win.offer.runde === hrl && !ew.take.includes(win) && <FlagList items={[{ kind: 'warn', text: `Der vorgeschlagene Zuschlagsempfänger ${win.offer.firma} ist nicht in der engeren Wahl – im Vermerk fehlt dann die Begründung.` }]} />}
          </section>
        );
      })}

      {win && (
        <section className="card winner">
          <div className="trophy"><Icon name="check" /></div>
          <div className="winner-main">
            <small>2 · Vergabevorschlag {los.nr}{finalR && finalR > 1 ? ' · nach Nachverhandlung' : ''}</small>
            <h3>{win.offer.firma}</h3>
            <div className="winner-nums"><b>{fmtEur(win.net)}</b> netto · {fmtEur(win.gross)} brutto{win.dKosten != null && ` · ${fmtPct(win.dKosten)} zum Kostenvoranschlag`}</div>
          </div>
          <label className="field"><span className="field-label">Abweichend vergeben an</span>
            <select value={s.zuschlag[los.id] ?? ''} onChange={(e) => up((d) => void (d.zuschlag[los.id] = e.target.value))}>
              <option value="">Automatisch (günstigstes wertbares Angebot)</option>
              {eligible.map((c) => <option key={c.offer.id} value={c.offer.id}>Nr. {c.offer.nr} · {c.offer.firma} ({c.offer.runde === 1 ? 'Haupt' : 'NV'})</option>)}
            </select>
          </label>
        </section>
      )}

      {detail.length > 0 && (
        <section className="card">
          <h2><span className="stepno">3</span>Begründung im Vermerk</h2>
          <p className="lead">Der Text entsteht automatisch. Je Bieter aufklappen und nur ergänzen, was nur Sie wissen.</p>
          <EignungEinwilligung ctx={eig} />
          {detail.map((c) => {
            const b = getBew(s, c.offer.id, los.id);
            const min = mindestEuro(cells, c.offer.runde);
            const tAuff = titelVergleich(s, los, cells, c, min).filter((t) => t.status === 'auffaellig');
            const pAuff = positionsVergleich(s, los, cells, c, min).filter((v) => v.status === 'auffaellig');
            const nv = c.offer.runde > hrl;
            const e = entfernung(s, c.offer);
            return (
              <BewKarte key={c.offer.id} offen={c.offer.id === win?.offer.id}
                titel={<>{nv ? 'Nachverhandlung · ' : `Rang ${c.rankAll} · `}Nr. {c.offer.nr} · {c.offer.firma}</>}
                info={<>
                  {c.offer.id === win?.offer.id && <Chip kind="ok" title="Wirtschaftlichstes Angebot – wird zur Vergabe vorgeschlagen">Vergabevorschlag</Chip>}
                  {!nv && tAuff.length + pAuff.length > 0 && <Chip kind="warn" title="Titel bzw. Einheitspreise weichen deutlich vom LV-Schätzpreis bzw. vom günstigsten Angebot ab – Details nach dem Aufklappen">{tAuff.length ? `${tAuff.length} Titel auffällig` : `${pAuff.length} Pos. auffällig`}</Chip>}
                </>}>
                {!nv && (
                  <AuffTitel titel={tAuff} pos={pAuff} einzeln={cells.filter((x) => x.offer.runde === c.offer.runde).length < 2}
                    zurRueckfrage={() => {
                      up((d) => { const x = { ...leereAnfrage(), ...(d.anfrage?.[los.id] ?? {}) }; d.anfrage = { ...(d.anfrage ?? {}), [los.id]: { ...x, modus: { ...x.modus, [c.offer.id]: 'nach' } } }; });
                      setAnfrageOffen((o) => ({ ...o, [los.id]: true }));
                      setTimeout(() => document.getElementById(`anf-${c.offer.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                    }} />
                )}
                <div className="grid g2">
                  {!nv && <div className="wide"><EignungKi s={s} up={up} o={c.offer} b={b} setBew={(patch) => setBew(c.offer.id, patch)} ctx={eig} /></div>}
                  {!nv && <div className="wide"><NuEditor s={s} up={up} o={c.offer} /></div>}
                  {!nv && <label className="field wide"><span className="field-label">Qualifikation / Referenzen</span><textarea rows={2} value={b.qualifikation} onChange={(e) => setBew(c.offer.id, { qualifikation: e.target.value })} placeholder="Die Qualifikation des Bieters ist bekannt, die Fachfirma hat bereits vergleichbare Leistungen erbracht …" /></label>}
                  {!nv && (
                    <label className="field"><span className="field-label">Entfernung zur Baustelle</span>
                      <NumInput value={b.km ?? e?.km ?? null} decimals={0} suffix="km" className={b.km == null && e ? 'berechnet' : ''} onChange={(v) => setBew(c.offer.id, { km: v })} label="Entfernung zur Baustelle" />
                      <span className="field-hint">
                        {b.km != null ? (b.km > 0 ? 'Von Hand eingetragen – leeren für Schätzung' : '0 km: kein Satz im Vermerk')
                          : e ? <span title={`${e.von} → ${e.nach}`}>Geschätzt (Straße), Luftlinie {e.luft} km{e.km >= KM_HINWEIS ? '' : ` · im Vermerk erst ab ${KM_HINWEIS} km`}</span>
                          : !s.project.baustelle?.trim() ? 'Baustelle in Schritt 1 angeben' : 'Firmenort nicht gefunden – PLZ in Schritt 2 ergänzen'}
                      </span>
                    </label>
                  )}
                  {!nv && <label className="field"><span className="field-label">&nbsp;</span><span className="mini big chkfield"><input type="checkbox" checked={b.auskoemm} onChange={(e) => setBew(c.offer.id, { auskoemm: e.target.checked })} /> Auskömmlichkeitserklärung empfohlen</span></label>}
                  {!nv && <label className="field wide"><span className="field-label">Erläuterung der niedrigen Preise (optional)</span><textarea rows={2} value={b.erlaeuterung} onChange={(e) => setBew(c.offer.id, { erlaeuterung: e.target.value })} placeholder="z. B. Pflanzenlieferungen (Baumschul-Rabatte), Synergieeffekte durch benachbarte Baustelle …" /></label>}
                  <label className="field wide"><span className="field-label">Zusätzliche Anmerkung (optional)</span><textarea rows={2} value={b.zusatz} onChange={(e) => setBew(c.offer.id, { zusatz: e.target.value })} /></label>
                </div>
                <details className="det"><summary>Text im Vergabevermerk (Vorschau)</summary><pre className="prev">{bewText(s, los, cells, c, nv)}</pre></details>
              </BewKarte>
            );
          })}
        </section>
      )}

      {cells.length > 0 && <AnfrageKarte s={s} up={up} los={los} cells={cells} offen={anfrageOffen[los.id] ?? !!s.anfrage?.[los.id]} setOffen={(v) => setAnfrageOffen((o) => ({ ...o, [los.id]: v }))} />}
    </div>
  );
}

/** Begründung je Bieter, aufklappbar; der Vergabevorschlag ist anfangs offen. */
const bezug = (q: RefQuelle | null) => (q === 'schaetz' ? 'LV-Schätzpreis' : 'günstigstem Angebot');

/** Preisauffälligkeiten eines Bieters kompakt: nur die auffälligen Titel (Richtung über Pfeil und Vorzeichen, eine Warnfarbe wie im Preisspiegel);
 *  die einzelnen Positionen werden in der Rückfrage gezeigt und ausgewählt. */
function AuffTitel({ titel, pos, einzeln, zurRueckfrage }: { titel: TitelVergleich[]; pos: AufklPos[]; einzeln: boolean; zurRueckfrage: () => void }) {
  const quellen = new Set([...titel, ...pos].map((x) => x.refQuelle));
  const ggue = quellen.size > 1 ? 'LV-Schätzpreis bzw. günstigstem Angebot' : bezug([...quellen][0] ?? null);
  const teurer = pos.filter((v) => v.delta > 0).length;
  if (!titel.length && !pos.length) return <p className="muted auff-leer">Keine auffälligen Titel oder Einheitspreise{einzeln ? ' (nur ein Angebot in dieser Runde, kein LV-Schätzpreis)' : ''}.</p>;
  return (
    <div className="auff">
      <div className="auff-zeile">
        <span className="auff-l">Auffällige Titel<small>ggü. {ggue}</small></span>
        <span className="auff-w">
          {titel.length ? titel.map((t) => (
            <span key={t.oz} className="tmark" title={`${t.name}: ${fmtEur(t.sum)} netto · ${bezug(t.refQuelle)} ${fmtEur(t.ref)}`}>
              <b>{t.oz}</b> <span className="tname">{t.name}</span> <b className="tpct">{t.pct! > 0 ? '↑ +' : '↓ −'}{fmtNum(Math.abs(t.pct!), 0)} %</b>
            </span>
          )) : <span className="muted">keine</span>}
        </span>
      </div>
      {pos.length > 0 && (
        <div className="auff-zeile">
          <span className="auff-l">Positionen</span>
          <span className="auff-w">
            <span>{pos.length} auffällig <span className="muted">({[teurer && `${teurer} teurer`, pos.length - teurer && `${pos.length - teurer} günstiger`].filter(Boolean).join(', ')})</span></span>
            <button type="button" className="btn small" onClick={zurRueckfrage}><Icon name="arrow" /> In Rückfrage prüfen</button>
          </span>
        </div>
      )}
    </div>
  );
}

function BewKarte({ titel, info, offen, children }: { titel: ReactNode; info: ReactNode; offen: boolean; children: ReactNode }) {
  const [auf, setAuf] = useState(offen);
  return (
    <div className={`bewcard ${auf ? 'auf' : ''}`}>
      <button type="button" className="bewkopf" aria-expanded={auf} onClick={() => setAuf(!auf)}>
        <Icon name={auf ? 'down' : 'right'} />
        <h3>{titel}</h3>
        <span className="bewinfo">{info}</span>
      </button>
      {auf && <div className="bewinhalt">{children}</div>}
    </div>
  );
}
