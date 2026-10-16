import type { State } from './types';
import { VERFAHREN, VERGABEARTEN } from './types';
import { Field, NumInput, Seg } from './ui';

export function StepProjekt({ s, up }: { s: State; up: (fn: (d: State) => void) => void }) {
  const p = s.project;
  const set = <K extends keyof State['project']>(k: K, v: State['project'][K]) => up((d) => void (d.project[k] = v));
  return (
    <div className="stack">
      <section className="card">
        <h2>Worum geht es?</h2>
        <p className="lead">Nur die Eckdaten – alles andere ergibt sich später automatisch.</p>
        <div className="grid">
          <Field label="Bezeichnung der Maßnahme" wide>
            <input value={p.titel} onChange={(e) => set('titel', e.target.value)} placeholder="z. B. Neubau Kita – Trockenbauarbeiten" autoFocus />
          </Field>
          <Field label="Vergabe-Nr.">
            <input value={p.nummer} onChange={(e) => set('nummer', e.target.value)} placeholder="V-2026-001" />
          </Field>
          <Field label="Gewerk / Leistung">
            <input value={p.gewerk} onChange={(e) => set('gewerk', e.target.value)} placeholder="Trockenbau" />
          </Field>
          <Field label="Auftraggeber">
            <input value={p.auftraggeber} onChange={(e) => set('auftraggeber', e.target.value)} />
          </Field>
          <Field label="Bearbeiter/in">
            <input value={p.sachbearbeiter} onChange={(e) => set('sachbearbeiter', e.target.value)} />
          </Field>
          <Field label="Submissionsdatum">
            <input type="date" value={p.submission} onChange={(e) => set('submission', e.target.value)} />
          </Field>
          <Field label="Kostenschätzung (netto)" hint="Vergleichswert zur Preisprüfung – optional, aber empfohlen">
            <NumInput value={p.kostenschaetzung} onChange={(v) => set('kostenschaetzung', v)} suffix="€" />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Verfahren</h2>
        <div className="grid">
          <Field label="Vergabeordnung">
            <select value={p.verfahren} onChange={(e) => set('verfahren', e.target.value)}>
              {VERFAHREN.map((v) => <option key={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Vergabeart">
            <select value={p.vergabeart} onChange={(e) => set('vergabeart', e.target.value)}>
              {VERGABEARTEN.map((v) => <option key={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="MwSt.-Satz">
            <NumInput value={p.mwst} onChange={(v) => set('mwst', v ?? 0)} decimals={0} suffix="%" />
          </Field>
          <Field label="Aufklärungsschwelle" hint="Preis liegt um mehr als diesen Wert unter Kostenschätzung bzw. Nächstbieter → Hinweis zur Aufklärung (Praxiswert 15 %)">
            <NumInput value={p.schwelle} onChange={(v) => set('schwelle', v ?? 15)} decimals={0} suffix="%" />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2>Wie wollen Sie die Preise erfassen?</h2>
        <Seg
          value={p.mode}
          onChange={(v) => set('mode', v)}
          options={[
            { value: 'lv', label: 'Positionsweise (Leistungsverzeichnis)', sub: 'Vollständiger Preisspiegel mit Einheitspreisen – inkl. Excel-Einfügen' },
            { value: 'summe', label: 'Nur Angebotssummen', sub: 'Schnellvergleich: eine Summe pro Bieter' },
          ]}
        />
        <h2 style={{ marginTop: 28 }}>Nach welchem Kriterium wird gewertet?</h2>
        <Seg
          value={p.kriterienModus}
          onChange={(v) => set('kriterienModus', v)}
          options={[
            { value: 'preis', label: 'Nur Preis', sub: 'Niedrigster Preis = wirtschaftlichstes Angebot' },
            { value: 'mehrere', label: 'Preis + weitere Kriterien', sub: 'Gewichtete Bewertung (z. B. Termin, Qualität)' },
          ]}
        />
      </section>
    </div>
  );
}
