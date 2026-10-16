import { Fragment, useMemo, useState } from 'react';
import type { Bew, State } from '../domain/types';
import { auffaelligkeiten, computeLos, emptyBew, getBew, zuschlagCell, bewKey, type Cell } from '../domain/calc';
import { fmtEur, fmtNum, fmtPct } from '../domain/fmt';
import { bewText } from '../vermerk/vermerk';
import { Chip, Icon, NumInput, Tabs } from '../components/ui';

type Up = (fn: (d: State) => void) => void;

export function StepWertung({ s, up }: { s: State; up: Up }) {
  const [losId, setLosId] = useState(s.lose[0]?.id ?? '');
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
  const first = cells.filter((c) => c.offer.runde === hrl && c.rankAll).sort((a, b) => a.rankAll! - b.rankAll!).slice(0, Math.max(1, s.project.engereWahl));
  detail.push(...first, ...cells.filter((c) => c.offer.runde > hrl && c.rankAll).sort((a, b) => a.offer.runde - b.offer.runde || a.rankAll! - b.rankAll!));

  return (
    <div className="stack">
      <section className="card">
        <h2>Wertung</h2>
        <p className="lead">Rangfolge je Los, Ausschlüsse, Preisaufklärung und die Angaben für die Begründung im Vergabevermerk.</p>
        <Tabs value={los.id} onChange={setLosId} items={s.lose.map((l) => ({ value: l.id, label: l.nr, sub: l.name }))} />
      </section>

      {cells.length === 0 && <section className="card"><p className="muted">Für {los.nr} liegen keine Angebote vor (Schritt 2 → „Angebot gilt für“).</p></section>}

      {runden.map((r) => {
        const rc = cells.filter((c) => c.offer.runde === r);
        return (
          <section className="card" key={r}>
            <h2>{los.nr} · {r === hrl ? (r === 1 ? 'Hauptangebote' : 'Angebote') : 'Nachverhandlung'}</h2>
            <div className="scroll">
              <table className="matrix rank">
                <thead><tr><th>Rang</th><th>Nr.</th><th className="left">Bieter</th><th className="r">Netto</th><th className="r">Brutto</th><th className="r">zum günstigsten</th><th className="r">zum Kostenvoranschlag</th><th className="left">Prüfhinweise & Aktionen</th></tr></thead>
                <tbody>
                  {rc.map((c) => {
                    const b = getBew(s, c.offer.id, los.id);
                    const needsAufk = c.flags.some((f) => f.text.includes('Aufklärung')) || b.aufklaerung !== '';
                    const isWin = win?.offer.id === c.offer.id;
                    return (
                      <Fragment key={c.offer.id}>
                        <tr className={c.excluded ? 'dim' : isWin ? 'first' : ''}>
                          <td>{c.rankAll ? <span className={`rankbadge ${isWin ? 'one' : ''}`}>{c.rankAll}</span> : '–'}</td>
                          <td>{c.offer.nr}</td>
                          <td className="left"><b>{c.offer.firma}</b><small className="muted block">{c.offer.ort}</small></td>
                          <td className="r">{fmtEur(c.net)}{c.nachlass ? <small className="muted block">nach {fmtNum(c.nachlass)} % Nachlass</small> : null}</td>
                          <td className="r">{fmtEur(c.gross)}</td>
                          <td className="r">{c.rankAll ? fmtPct(c.dMin) : '–'}</td>
                          <td className="r">{fmtPct(c.dKosten)}</td>
                          <td className="left flags">
                            {c.flags.length === 0 && c.eligible && <Chip kind="ok">Keine Auffälligkeiten</Chip>}
                            {c.flags.map((f, i) => <Chip key={i} kind={f.kind}>{f.text}</Chip>)}
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
                        {b.ausschluss && (
                          <tr><td colSpan={8} className="reason"><span>Aufgrund</span><input value={b.ausschluss} onChange={(e) => setBew(c.offer.id, { ausschluss: e.target.value })} placeholder="… fehlender Referenzen in vergleichbaren Leistungen wurde das Angebot ausgeschlossen" /></td></tr>
                        )}
                        {b.aufklaerung && (
                          <tr><td colSpan={8} className="reason"><span>Aufklärung</span><input value={b.aufklaerungNotiz} onChange={(e) => setBew(c.offer.id, { aufklaerungNotiz: e.target.value })} placeholder="Begründung des Bieters / Ergebnis kurz festhalten" /></td></tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {win && (
        <section className="card winner">
          <div className="trophy"><Icon name="check" /></div>
          <div className="winner-main">
            <small>Vergabevorschlag {los.nr}{finalR && finalR > 1 ? ' · nach Nachverhandlung' : ''}</small>
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
          <h2>Angaben für die Begründung im Vermerk</h2>
          <p className="lead">Der Text wird automatisch aus Preisspiegel und diesen Angaben erzeugt (Auffälligkeiten, Rang, Summe). Ergänzen Sie nur, was nur Sie wissen.</p>
          {detail.map((c) => {
            const b = getBew(s, c.offer.id, los.id);
            const a = auffaelligkeiten(s, los, cells, c);
            const nv = c.offer.runde > hrl;
            return (
              <div className="bewcard" key={c.offer.id}>
                <h3>{nv ? 'Nachverhandlung · ' : `Rang ${c.rankAll} · `}Nr. {c.offer.nr} · {c.offer.firma}</h3>
                {!nv && (
                  <div className="auff">
                    {a.guenstig.length > 0 && <div><Chip kind="info">überdurchschnittlich günstig</Chip> {a.guenstig.slice(0, 5).map((x) => <span key={x.oz} className="oz" title={`${x.kurz}: EP ${fmtNum(x.ep)} € (Ø übrige ${fmtNum(x.avg)} €)`}>{x.oz}</span>)}</div>}
                    {a.hoch.length > 0 && <div><Chip kind="warn">überdurchschnittlich hochpreisig</Chip> {a.hoch.slice(0, 3).map((x) => <span key={x.oz} className="oz" title={`${x.kurz}: EP ${fmtNum(x.ep)} € (Ø übrige ${fmtNum(x.avg)} €)`}>{x.oz}</span>)}</div>}
                    {a.titel.length > 0 && <div><Chip kind="info">Titel mit niedrigem Preisniveau</Chip> {a.titel.slice(0, 4).map((x) => <span key={x.oz} className="oz" title={x.name}>{x.oz}</span>)}</div>}
                    {a.guenstig.length + a.hoch.length + a.titel.length === 0 && <span className="muted">Keine Preisauffälligkeiten gegenüber den übrigen Angeboten erkannt{cells.filter((x) => x.offer.runde === c.offer.runde).length < 2 ? ' (nur ein Angebot in dieser Runde)' : ''}.</span>}
                  </div>
                )}
                <div className="grid g2">
                  {!nv && <label className="field wide"><span className="field-label">Qualifikation / Referenzen des Bieters</span><textarea rows={2} value={b.qualifikation} onChange={(e) => setBew(c.offer.id, { qualifikation: e.target.value })} placeholder="Die Qualifikation des Bieters ist bekannt, die Fachfirma hat bereits vergleichbare Leistungen erbracht …" /></label>}
                  {!nv && <label className="field"><span className="field-label">Entfernung zur Baustelle</span><NumInput value={b.km} decimals={0} suffix="km" onChange={(v) => setBew(c.offer.id, { km: v })} /></label>}
                  {!nv && <label className="field"><span className="field-label">&nbsp;</span><span className="mini big"><input type="checkbox" checked={b.auskoemm} onChange={(e) => setBew(c.offer.id, { auskoemm: e.target.checked })} /> Auskömmlichkeitserklärung empfohlen</span></label>}
                  {!nv && <label className="field wide"><span className="field-label">Erläuterung der niedrigen Preise (optional)</span><textarea rows={2} value={b.erlaeuterung} onChange={(e) => setBew(c.offer.id, { erlaeuterung: e.target.value })} placeholder="z. B. Pflanzenlieferungen (Baumschul-Rabatte), Synergieeffekte durch benachbarte Baustelle …" /></label>}
                  <label className="field wide"><span className="field-label">Zusätzliche Anmerkung (optional)</span><textarea rows={2} value={b.zusatz} onChange={(e) => setBew(c.offer.id, { zusatz: e.target.value })} /></label>
                </div>
                <details className="det"><summary>Vorschau des erzeugten Textes</summary><pre className="prev">{bewText(s, los, cells, c, nv)}</pre></details>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
