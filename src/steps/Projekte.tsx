import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { PROJEKT_STATUS, type ProjektStatus } from '../domain/types';
import { demoState, emptyState } from '../domain/demo';
import { fmtDate } from '../domain/fmt';
import { Chip, Icon } from '../components/ui';
import { dauerhaftAnfordern, speicherInfo, type ProjektKopf, type ProjektRepo, type SpeicherInfo } from '../storage/projektRepo';
import { sicherungLesen, sicherungName, sicherungZip } from '../storage/sicherung';
import { downloadBlob } from '../storage/exportCsv';
import { clearAllLocal } from '../storage/projectStore';
import { deleteDb } from '../storage/idb';

const mb = (n: number | null) => (n == null ? '–' : `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: n < 10 * 1024 * 1024 ? 1 : 0 })} MB`);
const heute = () => new Date().toISOString().slice(0, 10);
const zeit = (iso: string) => { const d = new Date(iso); return `${fmtDate(iso.slice(0, 10))}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`; };

/** Projektübersicht: alle im Browser gespeicherten Vergaben, mit Stand und Frist für Nachreichungen. */
export function Projekte({ repo, fehler, onOpen, Brand, Foot }: { repo: ProjektRepo; fehler: string; onOpen: (id: string) => void; Brand: ComponentType; Foot: ComponentType }) {
  const [liste, setListe] = useState<ProjektKopf[] | null>(null);
  const [info, setInfo] = useState<SpeicherInfo | null>(null);
  const [err, setErr] = useState(fehler);
  const fileRef = useRef<HTMLInputElement>(null);

  const neuLaden = useCallback(async () => {
    try { setListe(await repo.list()); } catch { setListe([]); }
    setInfo(await speicherInfo());
  }, [repo]);
  useEffect(() => { void neuLaden(); }, [neuLaden]);

  const anlegen = async (s = emptyState()) => {
    try { void dauerhaftAnfordern(); onOpen(await repo.create(s)); } catch { setErr('Projekt konnte nicht angelegt werden (Speicher des Browsers nicht verfügbar oder voll).'); }
  };
  const laden = async (f: File) => {
    try {
      const { state, docs } = await sicherungLesen(f);
      void dauerhaftAnfordern();
      onOpen(await repo.create(state, docs));
    } catch (e) { alert((e as Error).message || 'Datei konnte nicht gelesen werden.'); }
  };
  const aendern = async (id: string, fn: (p: { status?: ProjektStatus; frist?: string }) => void) => {
    const s = await repo.load(id);
    if (!s) return;
    fn(s.project);
    await repo.save(id, s);
    await neuLaden();
  };
  const sichern = async (k: ProjektKopf) => {
    const s = await repo.load(k.id);
    if (s) downloadBlob(sicherungName(s), await sicherungZip(s, await repo.loadDocs(k.id)));
  };
  const kopieren = async (k: ProjektKopf) => { await repo.duplicate(k.id); await neuLaden(); };
  const loeschen = async (k: ProjektKopf) => {
    if (!confirm(`Projekt „${k.titel || 'ohne Bezeichnung'}“ mit allen Angeboten und Unterlagen in diesem Browser löschen?\n\nTipp: Vorher eine Sicherung herunterladen.`)) return;
    await repo.remove(k.id);
    await neuLaden();
  };
  const allesLoeschen = async () => {
    if (!confirm('Alle lokal gespeicherten Daten dieser Anwendung (alle Projekte, Unterlagen, Zugangscode, Einwilligungen) in diesem Browser löschen?\n\nTipp: Vorher je Projekt eine Sicherung herunterladen.')) return;
    clearAllLocal();
    await deleteDb();
    await neuLaden();
  };
  const dauerhaft = async () => { if (!(await dauerhaftAnfordern())) alert('Der Browser hat die dauerhafte Speicherung nicht bestätigt. Bitte regelmäßig Sicherungen herunterladen.'); await neuLaden(); };

  return (
    <div className="app">
      <header className="top no-print">
        <Brand />
        <div className="top-title">Projekte</div>
        <div className="top-actions">
          <button className="btn ghost" onClick={() => anlegen(demoState())}><Icon name="sparkle" /> Beispiel</button>
          <button className="btn ghost" title="Sicherung (ZIP oder älteres JSON) als neues Projekt laden" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Sicherung laden</button>
          <button className="btn ghost" title="Löscht alle in diesem Browser gespeicherten Daten dieser Anwendung" onClick={allesLoeschen}><Icon name="trash" /> Alle Daten löschen</button>
          <input ref={fileRef} type="file" accept=".zip,application/zip,application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void laden(f); }} />
        </div>
      </header>

      <main className="main">
        <div className="stack">
          {err && <section className="card attention"><h2><Icon name="alert" /> Hinweis</h2><p>{err}</p></section>}
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Ihre Vergaben</h2>
                <p className="lead">Jede Änderung wird automatisch gespeichert. Projekte lassen sich jederzeit wieder öffnen, z. B. wenn nachgeforderte Unterlagen eingehen.</p>
              </div>
              <button className="btn primary" onClick={() => anlegen()}><Icon name="plus" /> Neues Projekt</button>
            </div>
            {liste == null ? <p className="muted">Wird geladen …</p> : liste.length === 0 ? (
              <p className="muted">Noch keine Projekte. Legen Sie ein neues Projekt an, laden Sie eine Sicherung oder sehen Sie sich das Beispiel an.</p>
            ) : (
              <div className="scroll">
                <table className="projekte">
                  <thead><tr><th>Projekt</th><th>Stand</th><th>Frist Nachreichung</th><th className="r">Bieter</th><th className="r">Dateien</th><th>Geändert</th><th /></tr></thead>
                  <tbody>
                    {liste.map((k) => {
                      const ueberfaellig = k.frist && k.frist < heute() && k.status === 'nachforderung';
                      return (
                        <tr key={k.id}>
                          <td className="name">
                            <button className="linkbtn" onClick={() => onOpen(k.id)}>{k.titel || 'Ohne Bezeichnung'}</button>
                            <small className="muted block">{[k.nummer, k.auftraggeber].filter(Boolean).join(' · ') || '–'}</small>
                          </td>
                          <td>
                            <select value={k.status} aria-label="Stand" onChange={(e) => { const v = e.target.value as ProjektStatus; void aendern(k.id, (p) => void (p.status = v)); }}>
                              {PROJEKT_STATUS.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
                            </select>
                          </td>
                          <td>
                            <input type="date" value={k.frist} aria-label="Frist Nachreichung" onChange={(e) => { const v = e.target.value; void aendern(k.id, (p) => void (p.frist = v)); }} />
                            {ueberfaellig && <Chip kind="bad">abgelaufen</Chip>}
                          </td>
                          <td className="r">{k.angebote}</td>
                          <td className="r">{k.dokumente}</td>
                          <td className="muted">{zeit(k.geaendert)}</td>
                          <td className="aktionen">
                            <button className="btn small primary" onClick={() => onOpen(k.id)}>Öffnen</button>
                            <button className="btn small" title="Projekt mit allen Unterlagen als ZIP-Datei herunterladen" onClick={() => sichern(k)}><Icon name="download" /></button>
                            <button className="btn small" title="Kopie anlegen" onClick={() => kopieren(k)}>Kopie</button>
                            <button className="btn small" title="Projekt löschen" onClick={() => loeschen(k)}><Icon name="trash" /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Wo liegen die Daten?</h2>
            <p className="lead">Projekte und Unterlagen werden <b>nur in diesem Browser auf diesem Gerät</b> gespeichert (IndexedDB) und nicht an uns übertragen. In einem anderen Browser, auf einem anderen Gerät oder nach dem Löschen der Websitedaten sind sie nicht vorhanden. Für den Wechsel des Geräts, die Weitergabe an Kollegen und als Sicherung: Projekt als ZIP herunterladen und dort über „Sicherung laden“ öffnen.</p>
            <div className="row">
              {info?.dauerhaft
                ? <Chip kind="ok">Dauerhaft gespeichert – der Browser löscht die Daten nicht von sich aus</Chip>
                : <><Chip kind="warn">Der Browser darf die Daten bei Platzmangel löschen</Chip><button className="btn small" onClick={dauerhaft}>Dauerhafte Speicherung anfordern</button></>}
              <span className="muted">Belegt: {mb(info?.belegt ?? null)} · frei: {mb(info?.frei ?? null)}</span>
            </div>
          </section>
        </div>
      </main>
      <Foot />
    </div>
  );
}
