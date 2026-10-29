import { useCallback, useEffect, useRef, useState } from 'react';
import type { State } from './domain/types';
import { emptyState, demoState } from './domain/demo';
import { STEPS, stepsDone } from './steps/stepList';
import { clearAllLocal, loadState, loadStep, parseBackup, saveState, saveStep } from './storage/projectStore';
import { StepVergabe } from './steps/StepVergabe';
import { StepUnterlagen } from './steps/StepUnterlagen';
import { StepPreisspiegel } from './steps/StepPreisspiegel';
import { StepWertung } from './steps/StepWertung';
import { StepVermerk } from './steps/StepVermerk';
import { Icon } from './components/ui';
import { docStore } from './import/docStore';

export function App() {
  const [s, setS] = useState<State>(loadState);
  const [step, setStep] = useState(loadStep);
  const [saved, setSaved] = useState(true);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const up = useCallback((fn: (d: State) => void) => setS((prev) => { const n = structuredClone(prev); fn(n); return n; }), []);

  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      setErr(saveState(s) ? '' : 'Speicher des Browsers voll – bitte „Datensicherung“ im Vermerk-Schritt nutzen.');
      setSaved(true);
    }, 500);
    return () => clearTimeout(t);
  }, [s]);
  useEffect(() => { saveStep(step); window.scrollTo(0, 0); }, [step]);

  const done = stepsDone(s);

  const confirmNew = (fn: () => State) => { if (confirm('Aktuelle Daten werden überschrieben. Fortfahren?')) { setS(fn()); setStep(0); } };
  const wipeAll = () => {
    if (!confirm('Alle lokal gespeicherten Daten dieser Anwendung (Projekt, Angebote, Zugangscode, Einwilligung) in diesem Browser löschen?\n\nTipp: Vorher eine Datensicherung anlegen (Schritt „Vermerk“).')) return;
    clearAllLocal();
    docStore.clear();
    setS(emptyState()); setStep(0);
  };
  const importJson = async (f: File) => {
    try { const st = parseBackup(JSON.parse(await f.text())); if (!st) throw new Error(); setS(st); setStep(0); } catch { alert('Datei konnte nicht gelesen werden (keine Datensicherung dieser Version).'); }
  };
  const Views = [StepVergabe, StepUnterlagen, StepPreisspiegel, StepWertung, StepVermerk];
  const View = Views[step];

  return (
    <div className="app">
      <header className="top no-print">
        <div className="brand"><svg className="logo" viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="1" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M1 14h26M14 1v26" stroke="currentColor" strokeWidth="1" opacity=".5" /><circle cx="14" cy="14" r="4" fill="currentColor" /></svg><div><b>Angebotsauswertung</b><small>Preisspiegel & Vergabeempfehlung</small></div></div>
        <div className="top-title">{s.project.titel || 'Neue Vergabe'}</div>
        <div className="top-actions">
          <span className={`saved ${saved && !err ? '' : 'busy'}`}>{err || (saved ? 'Automatisch gespeichert' : 'Speichert …')}</span>
          <button className="btn ghost" onClick={() => confirmNew(demoState)}><Icon name="sparkle" /> Beispiel</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Laden</button>
          <button className="btn ghost" onClick={() => confirmNew(emptyState)}>Neu</button>
          <button className="btn ghost" title="Löscht alle in diesem Browser gespeicherten Daten dieser Anwendung" onClick={wipeAll}><Icon name="trash" /> Daten löschen</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </div>
      </header>

      <nav className="steps no-print" aria-label="Fortschritt">
        {STEPS.map((st, i) => (
          <button key={st.id} className={`step ${i === step ? 'on' : ''} ${done[i] && i !== step ? 'done' : ''}`} onClick={() => setStep(i)}>
            <span className="num">{done[i] && i !== step ? <Icon name="check" /> : i + 1}</span>
            <span><b>{st.title}</b><small>{st.sub}</small></span>
          </button>
        ))}
      </nav>

      <main className="main">
        <View s={s} up={up} />
        <div className="pager no-print">
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}><Icon name="back" /> Zurück</button>
          {step < STEPS.length - 1 && <button className="btn primary" onClick={() => setStep(step + 1)}>Weiter: {STEPS[step + 1].title} <Icon name="arrow" /></button>}
        </div>
      </main>
      <footer className="foot no-print"><a href="/datenschutz.html" target="_blank" rel="noreferrer">Datenschutz</a> · <a href="/impressum.html" target="_blank" rel="noreferrer">Impressum</a></footer>
    </div>
  );
}
