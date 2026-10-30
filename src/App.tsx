import { useCallback, useEffect, useRef, useState } from 'react';
import type { State } from './domain/types';
import { STEPS, stepsDone } from './steps/stepList';
import { loadAktiv, loadStep, saveAktiv, saveStep } from './storage/projectStore';
import { altesProjektUebernehmen, localRepo, verwaisteDokumente } from './storage/projektRepo';
import { sicherungName, sicherungZip } from './storage/sicherung';
import { downloadBlob } from './storage/exportCsv';
import { StepVergabe } from './steps/StepVergabe';
import { StepUnterlagen } from './steps/StepUnterlagen';
import { StepPreisspiegel } from './steps/StepPreisspiegel';
import { StepWertung } from './steps/StepWertung';
import { StepVermerk } from './steps/StepVermerk';
import { Projekte } from './steps/Projekte';
import { Icon } from './components/ui';
import { docStore } from './import/docStore';

const repo = localRepo;
let uebernahme: Promise<unknown> | null = null; // nur einmal, auch wenn der Effekt doppelt läuft (StrictMode)

const Brand = () => (
  <div className="brand"><svg className="logo" viewBox="0 0 28 28" aria-hidden="true"><rect x="1" y="1" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M1 14h26M14 1v26" stroke="currentColor" strokeWidth="1" opacity=".5" /><circle cx="14" cy="14" r="4" fill="currentColor" /></svg><div><b>Angebotsauswertung</b><small>Preisspiegel & Vergabeempfehlung</small></div></div>
);
const Foot = () => <footer className="foot no-print"><a href="/datenschutz.html" target="_blank" rel="noreferrer">Datenschutz</a> · <a href="/impressum.html" target="_blank" rel="noreferrer">Impressum</a></footer>;

const speicherFehler = (e: unknown) => (e as DOMException)?.name === 'QuotaExceededError'
  ? 'Speicher des Browsers voll – bitte Sicherung anlegen und alte Projekte löschen.'
  : 'Speichern fehlgeschlagen – bitte Sicherung anlegen.';

/** Projektübersicht oder geöffnetes Projekt. */
export function App() {
  const [aktiv, setAktiv] = useState<{ id: string; s: State; step: number } | null>(null);
  const [bereit, setBereit] = useState(false);
  const [fehler, setFehler] = useState('');

  const oeffnen = useCallback(async (id: string, step = 0) => {
    const s = await repo.load(id);
    if (!s) { saveAktiv(null); return; }
    const docs = await repo.loadDocs(id);
    await verwaisteDokumente(repo, id, s, docs);
    docStore.laden(docs);
    saveAktiv(id);
    saveStep(step);
    setAktiv({ id, s, step });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await (uebernahme ??= altesProjektUebernehmen(repo));
        const id = loadAktiv();
        if (id) await oeffnen(id, loadStep());
      } catch {
        setFehler('Der Projektspeicher des Browsers ist nicht verfügbar (z. B. gesperrt oder im privaten Modus eingeschränkt). Projekte können nicht gespeichert werden.');
      }
      setBereit(true);
    })();
  }, [oeffnen]);

  const schliessen = () => { docStore.sink = null; docStore.laden(new Map()); saveAktiv(null); setAktiv(null); };

  if (!bereit) return <div className="app"><header className="top"><Brand /></header><main className="main"><p className="muted">Projekte werden geladen …</p></main></div>;
  if (!aktiv) return <Projekte repo={repo} fehler={fehler} onOpen={(id) => oeffnen(id)} Brand={Brand} Foot={Foot} />;
  return <Editor key={aktiv.id} id={aktiv.id} initial={aktiv.s} startStep={aktiv.step} onClose={schliessen} />;
}

function Editor({ id, initial, startStep, onClose }: { id: string; initial: State; startStep: number; onClose: () => void }) {
  const [s, setS] = useState<State>(initial);
  const [step, setStep] = useState(startStep);
  const [saved, setSaved] = useState(true);
  const [err, setErr] = useState('');
  const sRef = useRef(s);
  sRef.current = s;
  const offen = useRef(false); // Änderung noch nicht gespeichert

  const up = useCallback((fn: (d: State) => void) => setS((prev) => { const n = structuredClone(prev); fn(n); return n; }), []);

  const speichern = useCallback(async () => {
    try { await repo.save(id, sRef.current); offen.current = false; setErr(''); } catch (e) { setErr(speicherFehler(e)); }
    setSaved(true);
  }, [id]);

  // Originaldateien gehen direkt in den Projektspeicher
  useEffect(() => {
    docStore.sink = (offerId, files) => {
      (offerId ? repo.saveDocs(id, offerId, files) : repo.clearDocs(id)).catch((e) => setErr(speicherFehler(e)));
    };
    return () => { docStore.sink = null; };
  }, [id]);

  const erster = useRef(true);
  useEffect(() => {
    if (erster.current) { erster.current = false; return; } // Öffnen ist keine Änderung
    setSaved(false);
    offen.current = true;
    const t = setTimeout(speichern, 500);
    return () => clearTimeout(t);
  }, [s, speichern]);
  useEffect(() => {
    const weg = () => { if (offen.current) void repo.save(id, sRef.current); };
    window.addEventListener('pagehide', weg);
    return () => window.removeEventListener('pagehide', weg);
  }, [id]);
  useEffect(() => { saveStep(step); window.scrollTo(0, 0); }, [step]);

  const done = stepsDone(s);
  const zurUebersicht = async () => { if (offen.current) await speichern(); onClose(); };
  const sicherung = async () => downloadBlob(sicherungName(s), await sicherungZip(s, docStore));

  const Views = [StepVergabe, StepUnterlagen, StepPreisspiegel, StepWertung, StepVermerk];
  const View = Views[step];

  return (
    <div className="app">
      <header className="top no-print">
        <Brand />
        <div className="top-title">{s.project.titel || 'Neue Vergabe'}</div>
        <div className="top-actions">
          <span className={`saved ${saved && !err ? '' : 'busy'}`}>{err || (saved ? 'Automatisch gespeichert' : 'Speichert …')}</span>
          <button className="btn ghost" title="Projekt mit allen Unterlagen als ZIP-Datei sichern" onClick={sicherung}><Icon name="download" /> Sicherung</button>
          <button className="btn ghost" onClick={zurUebersicht}><Icon name="folder" /> Alle Projekte</button>
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
      <Foot />
    </div>
  );
}
