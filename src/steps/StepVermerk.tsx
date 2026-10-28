import { useMemo, useState } from 'react';
import type { State } from '../domain/types';
import { buildVermerk, anlagenList, budgetAusKosten, footerText, nichtGewertetAuto, type Block } from '../vermerk/vermerk';
import { computeLos, engereWahl, getBew, nuOf, pruefStatus } from '../domain/calc';
import { istHaupt, nvHinweis } from '../domain/runden';
import { uid } from '../domain/fmt';
import { downloadJson } from '../storage/exportCsv';
import { Icon } from '../components/ui';
import { useGeo } from '../geo/entfernung';
import { VollstaendigkeitPdfButton } from './Vollstaendigkeit';

type Up = (fn: (d: State) => void) => void;

function Editable({ id, text, edited, onChange, onReset }: { id: string; text: string; edited: boolean; onChange: (t: string) => void; onReset: () => void }) {
  const [edit, setEdit] = useState(false);
  const keep = /:\s*$/.test(text) ? ' keep' : '';
  if (id.startsWith('_')) return <p className={`ptext${keep}`}>{text}</p>;
  return edit ? (
    <textarea
      className="ptext-edit" autoFocus value={text} rows={Math.max(2, text.split('\n').length + 1)}
      onChange={(e) => onChange(e.target.value)} onBlur={() => setEdit(false)}
    />
  ) : (
    <div className={`ptext editable${keep} ${edited ? 'edited' : ''}`} onClick={() => setEdit(true)} title="Klicken zum Bearbeiten">
      {text.split('\n').map((l, i) => <div key={i}>{l || ' '}</div>)}
      {edited && <button className="reset no-print" onClick={(e) => { e.stopPropagation(); onReset(); }}><Icon name="undo" /> automatisch</button>}
    </div>
  );
}

const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

export function StepVermerk({ s, up }: { s: State; up: Up }) {
  const geo = useGeo(); // Entfernungen im Text, sobald die PLZ-Tabelle geladen ist
  const blocks = useMemo(() => buildVermerk(s), [s, geo]);
  const anl = anlagenList(s);
  const p = s.project;

  const open: string[] = [];
  if (!p.titel) open.push('Bezeichnung der Maßnahme fehlt');
  if (!p.nummer) open.push('Vergabenummer fehlt (Schritt Vergabe)');
  if (!p.datum) open.push('Datum des Vermerks fehlt');
  if (!p.unterzeichner) open.push('Unterzeichner fehlt');
  if (!p.eroeffnung) open.push('Eröffnungstermin fehlt');
  for (const l of s.lose) {
    const cells = computeLos(s, l);
    for (const c of cells) {
      if (getBew(s, c.offer.id, l.id).ausschluss === 'fehlender Eignungsnachweise') open.push(`${l.nr}, Nr. ${c.offer.nr}: Ausschlussgrund bitte konkretisieren`);
      if (c.flags.some((f) => f.text.includes('Aufklärung prüfen'))) open.push(`${l.nr}, Nr. ${c.offer.nr}: Preisaufklärung offen`);
      if (c.mengeAbw.length) open.push(`${l.nr}, Nr. ${c.offer.nr}: Menge weicht vom LV ab (Preisspiegel prüfen)`);
      if (c.rechenDiff != null && Math.abs(c.rechenDiff) > 0.01 && !c.mengeAbw.length) open.push(`${l.nr}, Nr. ${c.offer.nr}: Rechenabweichung`);
    }
  }
  for (const o of s.offers.filter((x) => !x.status && istHaupt(x))) {
    const ps = pruefStatus(s, o);
    if (ps.fehlt.length) open.push(`Nr. ${o.nr}: Unterlagen fehlen (${ps.fehlt.join(', ')}) – nachfordern oder Ausschluss prüfen`);
    else if (ps.ungeprueft) open.push(`Nr. ${o.nr}: Vollständigkeitsprüfung unvollständig (${ps.ungeprueft} Zeile(n) offen)`);
  }
  for (const l of s.lose.filter((x) => x.imVermerk)) {
    const rs = s.offers.filter((o) => o.lose.includes(l.id)).map((o) => o.runde);
    if (rs.length && Math.max(...rs) > Math.min(...rs) && !s.nvGrund?.[l.id]?.trim()) open.push(`${l.nr}: Anlass der Nachverhandlung fehlt (Schritt Wertung)`);
  }
  for (const o of s.offers) if (o.status === 'formal' && !o.statusGrund?.trim()) open.push(`Nr. ${o.nr}: Grund des formalen Ausschlusses fehlt (Schritt Unterlagen)`);
  for (const o of s.offers) if (o.runde > 1 && !o.basis) open.push(`Nr. ${o.nr}: Nachverhandlung keinem Hauptangebot zugeordnet (Schritt Unterlagen)`);
  if (s.offers.some((o) => o.runde > 1) && nvHinweis(s.project.verfahren)) open.push(`Nachverhandlung: ${nvHinweis(s.project.verfahren)}`);
  if (!p.budgetBrutto && budgetAusKosten(s) == null) open.push('Gesamtbudget für Abschnitt 6 fehlt');
  for (const l of s.lose.filter((x) => x.imVermerk)) {
    const ew = engereWahl(s, computeLos(s, l));
    for (const c of ew.ranked.filter((x) => !ew.take.includes(x)))
      if (!getBew(s, c.offer.id, l.id).nichtGewertet.trim() && !nichtGewertetAuto(s, c, ew.take)) open.push(`${l.nr}, Nr. ${c.offer.nr}: Grund angeben, warum das Angebot nicht weiter gewertet wird (Schritt Wertung)`);
  }
  const einzeln = new Map(s.lose.filter((l) => l.imVermerk).flatMap((l) => engereWahl(s, computeLos(s, l)).take.map((c) => [c.offer.id, c.offer] as const)));
  for (const o of einzeln.values()) {
    const nu = nuOf(s, o);
    if (!nu) open.push(`Nr. ${o.nr}: Nachunternehmer (VVB 233) nicht erfasst (Schritt Wertung)`);
    else if (nu.length && o.nuQuelle !== 'user') open.push(`Nr. ${o.nr}: Nachunternehmer laut KI prüfen (Schritt Wertung)`);
  }

  const pageCss = `@page { size: A4; margin: 36.5mm 20mm 24mm 20mm;
    ${s.logo ? `@top-right { content: url("${esc(s.logo)}"); vertical-align: top; margin-top: 8mm; }` : ''}
    @bottom-left { content: "${esc(footerText(s))}"; font: 300 8pt \"Segoe UI\", \"Helvetica Neue\", Inter, Arial, sans-serif; color: #555; width: 80%; vertical-align: bottom; }
    @bottom-right { content: "Seite " counter(page) " von " counter(pages); font: 300 8pt \"Segoe UI\", \"Helvetica Neue\", Inter, Arial, sans-serif; color: #555; width: 20%; vertical-align: bottom; } }`;

  return (
    <div className="stack">
      <style>{pageCss}</style>
      <section className="card no-print">
        <div className="card-head">
          <div><h2>Vergabevermerk</h2><p className="lead">Aus Ihren Daten erzeugt. Text anklicken zum Ändern, „automatisch“ setzt ihn zurück.</p></div>
          <div className="row">
            <button className="btn" onClick={() => downloadJson(`Vergabe_${p.nummer || 'Sicherung'}.json`, s)}><Icon name="download" /> Datensicherung</button>
            <button className="btn primary" onClick={() => window.print()}><Icon name="print" /> Als PDF drucken</button>
          </div>
        </div>
        {open.length > 0 ? (
          <div className="checklist"><b>Vor der Freigabe klären ({open.length}):</b><ul>{[...new Set(open)].map((t, i) => <li key={i}>{t}</li>)}</ul></div>
        ) : <p className="okbox"><Icon name="check" /> Keine offenen Punkte erkannt.</p>}
        <details className="det" style={{ marginTop: 14 }}>
          <summary><b>Anlagen bearbeiten</b> ({anl.length})</summary>
          <div className="anlist">
            {anl.map((a, i) => (
              <div className="row" key={a.key}>
                <span className="anr">{i + 1}</span>
                <input value={a.titel} onChange={(e) => up((d) => { if (a.custom) { const x = d.anlagen.find((z) => z.id === a.key); if (x) x.titel = e.target.value; } else d.texte[`anlage:${a.key}`] = e.target.value; })} />
                {a.key === 'vollstaendigkeit' && <VollstaendigkeitPdfButton s={s} small />}
                {a.custom && <button className="icon-btn" onClick={() => up((d) => void (d.anlagen = d.anlagen.filter((z) => z.id !== a.key)))}><Icon name="trash" /></button>}
              </div>
            ))}
            <button className="btn small" onClick={() => up((d) => void d.anlagen.push({ id: uid(), key: 'frei', titel: '' }))}><Icon name="plus" /> Anlage</button>
          </div>
        </details>
      </section>

      <article className="paper">
        {s.logo && <img className="paper-logo" src={s.logo} alt="" />}
        <hr className="paper-rule" />
        {blocks.map((b, i) => <BlockView key={i} b={b} s={s} up={up} />)}
      </article>
    </div>
  );
}

function BlockView({ b, s, up }: { b: Block; s: State; up: Up }) {
  switch (b.t) {
    case 'meta':
      return (
        <div className="v-meta">
          {b.lines.map((l, i) => (l.k !== undefined ? <div className="row2" key={i}><span>{l.k}</span><span>{l.v}</span></div> : <div key={i} className="full">{l.v}</div>))}
        </div>
      );
    case 'h':
      return <h4 className={`v-h l${b.lvl}`}>{b.n && <span className="n">{b.n}</span>}{b.text}</h4>;
    case 'p':
      return <Editable id={b.id} text={b.text} edited={s.texte[b.id] !== undefined} onChange={(t) => up((d) => void (d.texte[b.id] = t))} onReset={() => up((d) => void delete d.texte[b.id])} />;
    case 'kv':
      return (
        <div className={`v-kv ${b.ra ? 'ra' : ''}`}>
          {b.rows.map((r, i) => <div key={i} className={r.bold ? 'b' : ''}><span>{r.k}</span><span>{r.v}</span></div>)}
        </div>
      );
    case 'tab':
      return (
        <table className="v-tab">
          <colgroup>{b.cols.map((c, i) => <col key={i} style={{ width: `${c.w}%` }} />)}</colgroup>
          <thead><tr>{b.cols.map((c, i) => <th key={i} className={c.a ?? ''}>{c.h.split('\n').map((x, k) => <div key={k}>{x}</div>)}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i} className={b.hl?.includes(i) ? 'hl' : ''}>{r.map((v, k) => <td key={k} className={b.cols[k].a ?? ''}>{v.split('\n').map((x, j) => <div key={j}>{x}</div>)}</td>)}</tr>)}</tbody>
        </table>
      );
    case 'sign':
      return <div className="v-sign"><div>{b.lines[0]}</div><div className="line" /><div>{b.lines.slice(1).filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}</div></div>;
    case 'anlagen':
      return <div className="v-anl"><div>Anlagen:</div>{b.items.map((x, i) => <div key={i}>{x}</div>)}</div>;
    case 'gap':
      return <div className="v-gap" />;
  }
}
