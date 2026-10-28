import type { State } from '../domain/types';
import { VERFAHREN, VERFAHREN_GRUPPEN, VERFAHREN_PRIVAT, verfahrenName } from '../domain/types';
import { kostenOf } from '../domain/calc';
import { uid } from '../domain/fmt';
import { Field, Icon, NumInput } from '../components/ui';
import { LvKarte } from './LvKarte';
import { findeOrt, useGeo } from '../geo/entfernung';

type Up = (fn: (d: State) => void) => void;

export function StepVergabe({ s, up }: { s: State; up: Up }) {
  const p = s.project;
  useGeo();
  const bs = findeOrt(p.baustelle);
  const set = <K extends keyof State['project']>(k: K, v: State['project'][K]) => up((d) => void (d.project[k] = v));
  const onLogo = (f?: File) => {
    if (!f) return;
    // Logo auf druckgerechte Größe (ca. 55 × 25 mm) verkleinern, damit es im PDF-Briefkopf passt
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 210 / img.width, 95 / img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      up((d) => void (d.logo = c.toDataURL('image/png')));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };
  return (
    <div className="stack">
      <LvKarte s={s} up={up} />

      <section className="card">
        <h2>Vorhaben</h2>
        <div className="grid">
          <Field label="Bezeichnung der Maßnahme" wide><input value={p.titel} onChange={(e) => set('titel', e.target.value)} /></Field>
          <Field label="Vergabenummer"><input value={p.nummer} onChange={(e) => set('nummer', e.target.value)} /></Field>
          <Field label="Maßnahmennummer (optional)"><input value={p.massnahmeNr ?? ''} onChange={(e) => set('massnahmeNr', e.target.value)} /></Field>
          <Field label="Vergabeverfahren">
            <select value={p.verfahren} onChange={(e) => set('verfahren', e.target.value)}>
              <option value="">– bitte wählen –</option>
              {p.verfahren && !VERFAHREN.includes(p.verfahren) && <option value={p.verfahren}>{p.verfahren} (bisherige Angabe)</option>}
              {VERFAHREN_GRUPPEN.map((g) => (
                <optgroup key={g.regel} label={g.titel}>
                  {g.arten.map((a) => <option key={a} value={verfahrenName(a, g.regel)}>{a}</option>)}
                </optgroup>
              ))}
              <optgroup label="Ohne Vergaberecht"><option value={VERFAHREN_PRIVAT}>{VERFAHREN_PRIVAT}</option></optgroup>
            </select>
          </Field>
          <Field label="Auftraggeber"><input value={p.auftraggeber} onChange={(e) => set('auftraggeber', e.target.value)} /></Field>
          <Field label="Vergabestelle"><input value={p.vergabestelle} onChange={(e) => set('vergabestelle', e.target.value)} /></Field>
          <Field label="Baustelle (PLZ Ort)" hint={!p.baustelle?.trim() ? undefined : bs ? `Erkannt: ${bs.wie}` : 'Ort nicht gefunden – bitte PLZ angeben'}>
            <input value={p.baustelle ?? ''} onChange={(e) => set('baustelle', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Lose</h2>
          <button className="btn" onClick={() => up((d) => void d.lose.push({ id: uid(), oz: String(d.lose.length + 1).padStart(2, '0'), nr: `LOS${d.lose.length + 1}`, name: '', kosten: null, imVermerk: true, imBudget: true }))}><Icon name="plus" /> Los</button>
        </div>
        {s.lose.length === 0 && <p className="muted">Noch keine Lose – entstehen beim Laden des LV oder über „+ Los“.</p>}
        <div className="loslist">
          {s.lose.map((l, i) => (
            <div className="losrow" key={l.id}>
              <input className="nr" value={l.nr} onChange={(e) => up((d) => void (d.lose[i].nr = e.target.value))} aria-label="Los-Nr." />
              <input value={l.name} onChange={(e) => up((d) => void (d.lose[i].name = e.target.value))} placeholder="Bezeichnung des Loses" aria-label="Bezeichnung" />
              <NumInput value={l.kosten ?? kostenOf(s, l)} onChange={(v) => up((d) => void (d.lose[i].kosten = v))} suffix="€" placeholder="Kostenvoranschlag" label="Kostenvoranschlag" className={l.kosten == null && kostenOf(s, l) != null ? 'berechnet' : ''} />
              <label className="mini"><input type="checkbox" checked={l.imVermerk} onChange={(e) => up((d) => void (d.lose[i].imVermerk = e.target.checked))} /> im Vermerk</label>
              <label className="mini"><input type="checkbox" checked={l.imBudget} onChange={(e) => up((d) => void (d.lose[i].imBudget = e.target.checked))} /> im Budget</label>
              <button className="icon-btn" title="Los entfernen" onClick={() => up((d) => { const [x] = d.lose.splice(i, 1); d.offers.forEach((o) => (o.lose = o.lose.filter((id) => id !== x.id))); })}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
        <div className="grid" style={{ marginTop: 18 }}>
          <Field label="Kostenvoranschlag ist angegeben als">
            <select value={p.kostenBasis} onChange={(e) => set('kostenBasis', e.target.value as 'brutto' | 'netto')}><option value="brutto">brutto</option><option value="netto">netto</option></select>
          </Field>
          <Field label="Kostenvoranschlag vom"><input type="date" value={p.kostenDatum} onChange={(e) => set('kostenDatum', e.target.value)} /></Field>
          <Field label="Gesamtbudget (brutto)"><NumInput value={p.budgetBrutto} onChange={(v) => set('budgetBrutto', v)} suffix="€" /></Field>
        </div>
      </section>

      <section className="card">
        <h2>Termine & Teilnehmer</h2>
        <div className="grid">
          <Field label="Eröffnungstermin"><input type="datetime-local" value={p.eroeffnung} onChange={(e) => set('eroeffnung', e.target.value)} /></Field>
          <Field label="Ende der Zuschlagsfrist"><input type="date" value={p.zuschlagsfrist} onChange={(e) => set('zuschlagsfrist', e.target.value)} /></Field>
          <Field label="Beginn der Ausführung"><input value={p.beginn} onChange={(e) => set('beginn', e.target.value)} /></Field>
          <Field label="Vollendung der Ausführung"><input value={p.ende} onChange={(e) => set('ende', e.target.value)} /></Field>
          <Field label="Aufgeforderte Unternehmen"><NumInput value={p.angefordert} onChange={(v) => set('angefordert', v)} decimals={0} /></Field>
          <Field label="MwSt.-Satz"><NumInput value={p.mwst} onChange={(v) => set('mwst', v ?? 19)} decimals={0} suffix="%" /></Field>
        </div>
      </section>

      <section className="card">
        <h2>Absender & Darstellung</h2>
        <div className="grid">
          <Field label="Verfasser / Planungsbüro"><input value={p.ersteller} onChange={(e) => set('ersteller', e.target.value)} /></Field>
          <Field label="Unterzeichner"><input value={p.unterzeichner} onChange={(e) => set('unterzeichner', e.target.value)} /></Field>
          <Field label="Ort"><input value={p.ort} onChange={(e) => set('ort', e.target.value)} /></Field>
          <Field label="Datum des Vermerks"><input type="date" value={p.datum} onChange={(e) => set('datum', e.target.value)} /></Field>
          <Field label="Logo (PNG/JPG)">
            <div className="row"><input type="file" accept="image/*" onChange={(e) => onLogo(e.target.files?.[0])} />{s.logo && <><img src={s.logo} alt="Logo" className="logo-prev" /><button className="link danger" onClick={() => up((d) => void (d.logo = ''))}>entfernen</button></>}</div>
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Prüfregeln</h2>
        <p className="lead">Gelten für Preisspiegel, Wertung, Rückfrage und Vermerk gleichermaßen. Die engere Wahl legen Sie in „Wertung“ per Haken fest. Die Vorgaben passen in der Regel – nur bei Bedarf ändern.</p>
        <div className="grid">
          <Field label="Einzelpreis auffällig ab" hint="Abweichung vom Median der übrigen Bieter bzw. vom LV-Schätzpreis; zählt erst ab einer Auswirkung von 0,5 % der Angebotssumme"><NumInput value={p.abweichung} onChange={(v) => set('abweichung', v ?? 30)} decimals={0} suffix="%" /></Field>
          <Field label="Angebot auffallend niedrig ab" hint="unter Kostenvoranschlag bzw. nächstem Angebot – Hinweis auf Aufklärung"><NumInput value={p.schwelle} onChange={(v) => set('schwelle', v ?? 15)} decimals={0} suffix="%" /></Field>
        </div>
      </section>
    </div>
  );
}
