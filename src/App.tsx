import { useCallback, useEffect, useRef, useState } from 'react';
import type { State } from './types';
import { emptyState, demoState } from './demo';
import { computeAll } from './calc';
import { FORMAL_CHECKS } from './types';
import { StepProjekt } from './StepProjekt';
import { StepBieter } from './StepBieter';
import { StepPreisspiegel } from './StepPreisspiegel';
import { StepWertung } from './StepWertung';
import { StepEmpfehlung } from './StepEmpfehlung';
import { Icon } from './ui';

const KEY = 'apve-state-v1';
const STEPS = [
  { id: 'projekt', title: 'Vergabe', sub: 'Eckdaten' },
  { id: 'bieter', title: 'Bieter', sub: 'Formalprüfung' },
  { id: 'preis', title: 'Preisspiegel', sub: 'Preise erfassen' },
  { id: 'wertung', title: 'Wertung', sub: 'Prüfen & bewerten' },
  { id: 'empfehlung', title: 'Empfehlung', sub: 'Vermerk' },
];

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyState(), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return emptyState();
}

export function App() {
  const [s, setS] = useState<State>(load);
  const [step, setStep] = useState(() => Number(sessionStorage.getItem('apve-step') ?? 0) || 0);
  const [saved, setSaved] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const up = useCallback((fn: (d: State) => void) => setS((prev) => { const n = structuredClone(prev); fn(n); return n; }), []);

  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
      setSaved(true);
    }, 400);
    return () => clearTimeout(t);
  }, [s]);
  useEffect(() => { try { sessionStorage.setItem('apve-step', String(step)); } catch { /* ignore */ } window.scrollTo(0, 0); }, [step]);

  const res = computeAll(s, FORMAL_CHECKS.map((c) => c.id));
  const done = [
    !!s.project.titel.trim(),
    s.bidders.filter((b) => b.name.trim()).length >= 1 && s.bidders.every((b) => b.excluded || FORMAL_CHECKS.every((c) => b.checks[c.id])),
    res.some((r) => r.eligible),
    res.some((r) => r.rank === 1),
    false,
  ];

  const confirmNew = (fn: () => State) => {
    if (confirm('Aktuelle Daten werden überschrieben. Fortfahren?')) { setS(fn()); setStep(0); }
  };
  const importJson = async (f: File) => {
    try { setS({ ...emptyState(), ...JSON.parse(await f.text()) }); setStep(0); } catch { alert('Datei konnte nicht gelesen werden.'); }
  };

  const view = [StepProjekt, StepBieter, StepPreisspiegel, StepWertung, StepEmpfehlung][step];
  const View = view;

  return (
    <div className="app">
      <header className="top no-print">
        <div className="brand"><span className="logo"><i /><i /><i /></span><div><b>Angebotsauswertung</b><small>Preisspiegel & Vergabeempfehlung</small></div></div>
        <div className="top-title">{s.project.titel || 'Neue Vergabe'}</div>
        <div className="top-actions">
          <span className={`saved ${saved ? '' : 'busy'}`}>{saved ? 'Automatisch gespeichert' : 'Speichert …'}</span>
          <button className="btn ghost" onClick={() => confirmNew(demoState)}><Icon name="sparkle" /> Beispiel</button>
          <button className="btn ghost" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Laden</button>
          <button className="btn ghost" onClick={() => confirmNew(emptyState)}>Neu</button>
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
    </div>
  );
}
