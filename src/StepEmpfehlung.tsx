import { useEffect, useMemo } from 'react';
import type { State } from './types';
import { FORMAL_CHECKS } from './types';
import { computeAll, type BidderResult } from './calc';
import { fmtDate, fmtEur, fmtNum, fmtPct } from './fmt';
import { Icon } from './ui';
import { exportJson, exportPreisspiegel } from './exportDoc';

export function buildText(s: State, res: BidderResult[], winner: BidderResult | undefined): string {
  if (!winner) return '';
  const elig = res.filter((r) => r.eligible).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const multi = s.project.kriterienModus === 'mehrere';
  const second = elig.find((r) => r !== winner);
  const parts: string[] = [];
  parts.push(`Es wird empfohlen, den Zuschlag auf das Angebot der Firma ${winner.bidder.name} zu erteilen (Angebotssumme ${fmtEur(winner.net)} netto, ${fmtEur(winner.gross)} brutto).`);
  parts.push(
    `Das Angebot wurde formal, rechnerisch, technisch und wirtschaftlich geprüft und belegt ${winner.rank === 1 ? 'den ersten Rang' : `Rang ${winner.rank}`} von ${elig.length} gewerteten Angeboten${multi ? ` (${fmtNum(winner.total ?? 0, 1)} Punkte, Preis und weitere Zuschlagskriterien gewichtet)` : ' nach dem Preis'}.`,
  );
  if (second && winner.net != null && second.net != null)
    parts.push(`Der Abstand zum nächstplatzierten Angebot (${second.bidder.name}, ${fmtEur(second.net)}) beträgt ${fmtEur(second.net - winner.net)} bzw. ${fmtNum((second.net / winner.net - 1) * 100, 1)} %.`);
  if (winner.dKosten != null) parts.push(`Gegenüber der Kostenschätzung (${fmtEur(s.project.kostenschaetzung)} netto) liegt das Angebot ${fmtNum(Math.abs(winner.dKosten), 1)} % ${winner.dKosten <= 0 ? 'darunter' : 'darüber'}.`);
  if (winner.bidder.aufklaerung === 'angemessen') parts.push(`Der auffallend niedrige Angebotspreis wurde aufgeklärt und als angemessen bewertet${winner.bidder.aufklaerungNotiz ? ` (${winner.bidder.aufklaerungNotiz})` : ''}.`);
  const excl = res.filter((r) => r.bidder.excluded);
  if (excl.length) parts.push(`Vom Verfahren ausgeschlossen: ${excl.map((r) => `${r.bidder.name} (${(r.bidder.exclusionReason || 'Begründung fehlt').trim().replace(/\.$/, '')})`).join('; ')}.`);
  const uang = res.filter((r) => r.bidder.aufklaerung === 'unangemessen' && !r.bidder.excluded);
  if (uang.length) parts.push(`Nicht gewertet wegen unangemessenen Preises nach erfolgter Aufklärung: ${uang.map((r) => r.bidder.name).join(', ')}.`);
  return parts.join(' ');
}

export function StepEmpfehlung({ s, up }: { s: State; up: (fn: (d: State) => void) => void }) {
  const res = useMemo(() => computeAll(s, FORMAL_CHECKS.map((c) => c.id)), [s]);
  const elig = res.filter((r) => r.eligible).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const auto = elig[0];
  const winner = (s.empfehlungBieter && elig.find((r) => r.bidder.id === s.empfehlungBieter)) || auto;
  const overridden = winner && auto && winner !== auto;
  const text = buildText(s, res, winner);
  useEffect(() => {
    if (!s.begruendungManuell && s.begruendung !== text) up((d) => void (d.begruendung = text));
  }, [text, s.begruendungManuell, s.begruendung, up]);

  const open = res.flatMap((r) => (r.eligible && r.bidder.id === winner?.bidder.id ? r.flags.filter((f) => f.kind === 'warn' && !f.text.startsWith('Formalprüfung')) : []));
  const noFormalExclusion = res.filter((r) => !r.bidder.excluded && !r.formalOk);
  const missingReason = res.filter((r) => r.bidder.excluded && !r.bidder.exclusionReason.trim());
  const p = s.project;

  return (
    <div className="stack">
      <section className="card no-print">
        <div className="card-head">
          <div><h2>Vergabeempfehlung</h2><p className="lead">Vorschlag aus der Wertung – Begründung bei Bedarf anpassen, dann als Vergabevermerk drucken oder als PDF speichern.</p></div>
          <div className="row">
            <button className="btn" onClick={() => exportPreisspiegel(s)}><Icon name="download" /> Excel (CSV)</button>
            <button className="btn" onClick={() => exportJson(s)}><Icon name="download" /> Datensicherung</button>
            <button className="btn primary" onClick={() => window.print()}><Icon name="print" /> Drucken / PDF</button>
          </div>
        </div>

        {!winner ? (
          <p className="warnbox"><Icon name="alert" /> Noch kein wertbares Angebot. Bitte Preise vollständig erfassen (Schritt 3).</p>
        ) : (
          <div className="winner">
            <div className="trophy"><Icon name="check" /></div>
            <div className="winner-main">
              <small>{overridden ? 'Abweichende Empfehlung' : 'Empfehlung: Zuschlag an'}</small>
              <h3>{winner.bidder.name}</h3>
              <div className="winner-nums"><b>{fmtEur(winner.net)}</b> netto · {fmtEur(winner.gross)} brutto · Rang {winner.rank}</div>
            </div>
            <label className="field"><span className="field-label">Empfehlung ändern</span>
              <select value={s.empfehlungBieter || ''} onChange={(e) => up((d) => void (d.empfehlungBieter = e.target.value))}>
                <option value="">Automatisch (Rang 1)</option>
                {elig.map((r) => <option key={r.bidder.id} value={r.bidder.id}>Rang {r.rank}: {r.bidder.name}</option>)}
              </select>
            </label>
          </div>
        )}
        {overridden && <p className="warnbox"><Icon name="alert" /> Sie weichen vom bestplatzierten Angebot ab. Das muss im Vergabevermerk nachvollziehbar begründet werden.</p>}
        {(open.length > 0 || noFormalExclusion.length > 0 || missingReason.length > 0) && (
          <div className="checklist">
            <b>Vor der Freigabe klären:</b>
            <ul>
              {open.map((f, i) => <li key={i}>{f.text}</li>)}
              {noFormalExclusion.map((r) => <li key={r.bidder.id}>{r.bidder.name}: Formalprüfung nicht vollständig bestätigt</li>)}
              {missingReason.map((r) => <li key={r.bidder.id}>{r.bidder.name}: Ausschlussbegründung fehlt</li>)}
            </ul>
          </div>
        )}
        <label className="field wide" style={{ marginTop: 18 }}>
          <span className="field-label">Begründung {s.begruendungManuell && <button className="link" onClick={() => up((d) => { d.begruendungManuell = false; })}>automatisch neu erzeugen</button>}</span>
          <textarea rows={7} value={s.begruendung} onChange={(e) => up((d) => { d.begruendung = e.target.value; d.begruendungManuell = true; })} />
        </label>
        <div className="grid" style={{ marginTop: 14 }}>
          <label className="field"><span className="field-label">Fachlich geprüft durch</span><input value={s.freigabe.pruefer} onChange={(e) => up((d) => void (d.freigabe.pruefer = e.target.value))} /></label>
          <label className="field"><span className="field-label">Freigabe durch</span><input value={s.freigabe.freigeber} onChange={(e) => up((d) => void (d.freigabe.freigeber = e.target.value))} /></label>
          <label className="field"><span className="field-label">Datum</span><input type="date" value={s.freigabe.datum} onChange={(e) => up((d) => void (d.freigabe.datum = e.target.value))} /></label>
        </div>
      </section>

      <article className="paper" id="vermerk">
        <header>
          <small>Vergabevermerk / Vergabeempfehlung</small>
          <h1>{p.titel || 'Maßnahme'}</h1>
          <dl className="meta">
            <div><dt>Vergabe-Nr.</dt><dd>{p.nummer || '–'}</dd></div>
            <div><dt>Gewerk</dt><dd>{p.gewerk || '–'}</dd></div>
            <div><dt>Auftraggeber</dt><dd>{p.auftraggeber || '–'}</dd></div>
            <div><dt>Verfahren</dt><dd>{p.verfahren} · {p.vergabeart}</dd></div>
            <div><dt>Submission</dt><dd>{fmtDate(p.submission)}</dd></div>
            <div><dt>Kostenschätzung netto</dt><dd>{fmtEur(p.kostenschaetzung)}</dd></div>
          </dl>
        </header>

        <h2>1. Prüfung und Wertung der Angebote</h2>
        <table className="doc">
          <thead>
            <tr><th>Rang</th><th>Bieter</th><th className="r">Netto</th><th className="r">Brutto</th><th className="r">zur Kostenschätzung</th><th>Formalprüfung</th></tr>
          </thead>
          <tbody>
            {[...res].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((r) => (
              <tr key={r.bidder.id} className={r.bidder.id === winner?.bidder.id ? 'hl' : ''}>
                <td>{r.rank ?? '–'}</td>
                <td>{r.bidder.name}</td>
                <td className="r">{fmtEur(r.net)}</td>
                <td className="r">{fmtEur(r.gross)}</td>
                <td className="r">{fmtPct(r.dKosten)}</td>
                <td>{r.bidder.excluded ? 'ausgeschlossen' : r.formalOk ? 'ohne Beanstandung' : 'Mängel offen'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small">Alle Beträge in Euro. Skonto wurde nicht in die Wertung einbezogen; Nachlässe ohne Bedingung sind im Angebotspreis berücksichtigt.</p>

        <h2>2. Vergabeempfehlung</h2>
        {winner && <p className="rec">Zuschlag an: <b>{winner.bidder.name}</b> – {fmtEur(winner.net)} netto / {fmtEur(winner.gross)} brutto</p>}
        <h2>3. Begründung</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{s.begruendung || '–'}</p>

        <div className="sign">
          <div><span>{p.sachbearbeiter || ' '}</span><small>Aufgestellt (Bearbeiter/in), Datum</small></div>
          <div><span>{s.freigabe.pruefer || ' '}</span><small>Fachlich geprüft</small></div>
          <div><span>{s.freigabe.freigeber || ' '}{s.freigabe.datum ? ` · ${fmtDate(s.freigabe.datum)}` : ''}</span><small>Freigabe / Zuschlagserteilung</small></div>
        </div>
      </article>
    </div>
  );
}

