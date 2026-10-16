import { useCallback, useEffect, useRef, useState } from 'react';
import type { State } from './types';
import { emptyState, demoState } from './demo';
import { computeLos } from './calc';
import { StepVergabe } from './StepVergabe';
import { StepUnterlagen } from './StepUnterlagen';
import { StepPreisspiegel } from './StepPreisspiegel';
import { StepWertung } from './StepWertung';
import { StepVermerk } from './StepVermerk';
import { Icon } from './ui';
import { docStore } from './importer';

const KEY = 'apve-state-v2';
const STEPS = [
  { id: 'vergabe', title: 'Vergabe', sub: 'Eckdaten & Lose' },
  { id: 'unterlagen', title: 'Unterlagen', sub: 'LV & Angebote einlesen' },
  { id: 'preis', title: 'Preisspiegel', sub: 'je Los vergleichen' },
  { id: 'wertung', title: 'Wertung', sub: 'Prüfen & bewerten' },
  { id: 'vermerk', title: 'Vermerk', sub: 'Vergabevorschlag' },
];

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const j = JSON.parse(raw); if (j?.v === 2) return { ...emptyState(), ...j }; }
  } catch { /* ignore */ }
  return emptyState();
}

export function App() {
  const [s, setS] = useState<State>(load);
  const [step, setStep] = useState(() => Number(sessionStorage.getItem('apve-step') ?? 0) || 0);
  const [saved, setSaved] = useState(true);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const up = useCallback((fn: (d: State) => void) => setS((prev) => { const n = structuredClone(prev); fn(n); return n; }), []);

  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(s)); setErr(''); } catch { setErr('Speicher des Browsers voll – bitte „Datensicherung“ im Vermerk-Schritt nutzen.'); }
      setSaved(true);
    }, 500);
    return () => clearTimeout(t);
  }, [s]);
  useEffect(() => { try { sessionStorage.setItem('apve-step', String(step)); } catch { /* ignore */ } window.scrollTo(0, 0); }, [step]);

  const done = [
    !!s.project.titel.trim() && s.lose.length > 0,
    s.lv.length > 0 && s.offers.length > 0,
    s.lose.length > 0 && s.lose.every((l) => computeLos(s, l).some((c) => c.complete)),
    s.lose.length > 0 && s.lose.every((l) => computeLos(s, l).some((c) => c.rank === 1)),
    false,
  ];

  const confirmNew = (fn: () => State) => { if (confirm('Aktuelle Daten werden überschrieben. Fortfahren?')) { setS(fn()); setStep(0); } };
  const wipeAll = () => {
    if (!confirm('Alle lokal gespeicherten Daten dieser Anwendung (Projekt, Angebote, Zugangscode, Einwilligung) in diesem Browser löschen?\n\nTipp: Vorher eine Datensicherung anlegen (Schritt „Vermerk“).')) return;
    try { Object.keys(localStorage).filter((k) => k.startsWith('apve-')).forEach((k) => localStorage.removeItem(k)); sessionStorage.clear(); } catch { /* ignore */ }
    docStore.clear();
    setS(emptyState()); setStep(0);
  };
  const importJson = async (f: File) => {
    try { const j = JSON.parse(await f.text()); if (j?.v !== 2) throw new Error(); setS({ ...emptyState(), ...j }); setStep(0); } catch { alert('Datei konnte nicht gelesen werden (keine Datensicherung dieser Version).'); }
  };
  const Views = [StepVergabe, StepUnterlagen, StepPreisspiegel, StepWertung, StepVermerk];
  const View = Views[step];

  return (
    <div className="app">
      <header className="top no-print">
        <div className="brand"><span className="logo"><i /><i /><i /></span><div><b>Angebotsauswertung</b><small>Preisspiegel & Vergabeempfehlung</small></div></div>
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
