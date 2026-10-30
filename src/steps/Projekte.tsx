import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { PROJEKT_STATUS, type ProjektStatus } from '../domain/types';
import { demoState, emptyState } from '../domain/demo';
import { fmtDate } from '../domain/fmt';
import { Icon } from '../components/ui';
import { dauerhaftAnfordern, speicherInfo, type ProjektKopf, type ProjektRepo, type SpeicherInfo } from '../storage/projektRepo';
import { sicherungLesen, sicherungName, sicherungZip } from '../storage/sicherung';
import { downloadBlob } from '../storage/exportCsv';
import { clearAllLocal } from '../storage/projectStore';
import { deleteDb } from '../storage/idb';

const mb = (n: number | null) => (n == null ? '–' : `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: n < 10 * 1024 * 1024 ? 1 : 0 })} MB`);
const isoTag = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const heute = () => isoTag(new Date());
/** „heute, 14:20“ / „gestern, 09:05“ / „28.10.2026“ */
const geaendert = (iso: string) => {
  const d = new Date(iso);
  const uhr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const g = new Date(); g.setDate(g.getDate() - 1);
  return isoTag(d) === heute() ? `heute, ${uhr}` : isoTag(d) === isoTag(g) ? `gestern, ${uhr}` : fmtDate(isoTag(d));
};
const plural = (n: number, eins: string, viele: string) => `${n.toLocaleString('de-DE')} ${n === 1 ? eins : viele}`;

/** Projektübersicht: alle im Browser gespeicherten Vergaben, mit Stand und Frist für Nachreichungen. */
export function Projekte({ repo, fehler, onOpen, Brand, Foot }: { repo: ProjektRepo; fehler: string; onOpen: (id: string) => void; Brand: ComponentType; Foot: ComponentType }) {
  const [liste, setListe] = useState<ProjektKopf[] | null>(null);
  const [info, setInfo] = useState<SpeicherInfo | null>(null);
  const [err, setErr] = useState(fehler);
  const [filter, setFilter] = useState<ProjektStatus | ''>('');
  const [suche, setSuche] = useState('');
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

  const alle = liste ?? [];
  const q = suche.trim().toLowerCase();
  const sichtbar = alle.filter((k) => (!filter || k.status === filter) && (!q || `${k.titel || 'Ohne Bezeichnung'} ${k.nummer} ${k.auftraggeber}`.toLowerCase().includes(q)));
  const anzahl = (v: ProjektStatus) => alle.filter((k) => k.status === v).length;
  const faellig = alle.filter((k) => k.status === 'nachforderung' && k.frist && k.frist < heute()).length;

  return (
    <div className="app">
      <header className="top no-print">
        <Brand />
      </header>
      <input ref={fileRef} type="file" accept=".zip,application/zip,application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void laden(f); }} />

      <main className="main pj">
        <div className="pj-head">
          <div>
            <span className="pj-eyebrow"><Icon name="folder" /> Projekte</span>
            <h1>Ihre Vergaben</h1>
            <p className="muted">
              {liste == null ? 'Wird geladen …' : alle.length ? `${plural(alle.length, 'Projekt', 'Projekte')} · jede Änderung wird automatisch gespeichert` : 'Jede Änderung wird automatisch gespeichert – Projekte lassen sich jederzeit fortsetzen.'}
              {faellig > 0 && <> · <span className="pj-faellig">{plural(faellig, 'Frist', 'Fristen')} abgelaufen</span></>}
            </p>
          </div>
          {alle.length > 0 && (
            <div className="row">
              <button className="btn ghost" onClick={() => anlegen(demoState())}><Icon name="sparkle" /> Beispiel</button>
              <button className="btn" title="Sicherung (ZIP oder älteres JSON) als neues Projekt laden" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Sicherung laden</button>
              <button className="btn primary" onClick={() => anlegen()}><Icon name="plus" /> Neues Projekt</button>
            </div>
          )}
        </div>

        {err && <div className="pj-alert"><Icon name="alert" /> {err}</div>}

        {liste != null && alle.length === 0 && (
          <section className="pj-empty">
            <div className="pj-empty-icon"><Icon name="folder" /></div>
            <h2>Noch keine Vergabe angelegt</h2>
            <p className="muted">Legen Sie ein Projekt an und lesen Sie LV und Angebote ein. Sie können jederzeit unterbrechen und später weitermachen, z. B. wenn nachgeforderte Unterlagen eingehen.</p>
            <div className="pj-tiles">
              <button className="pj-tile main" onClick={() => anlegen()}><Icon name="plus" /><b>Neues Projekt</b><span>Leeres Projekt anlegen, LV und Angebotsordner einlesen</span></button>
              <button className="pj-tile" onClick={() => fileRef.current?.click()}><Icon name="upload" /><b>Sicherung laden</b><span>ZIP-Sicherung von einem anderen Gerät oder von Kollegen</span></button>
              <button className="pj-tile" onClick={() => anlegen(demoState())}><Icon name="sparkle" /><b>Beispiel ansehen</b><span>Erfundenes Projekt mit 2 Losen und 3 Bietern</span></button>
            </div>
          </section>
        )}

        {alle.length > 0 && (
          <>
            <div className="pj-bar">
              <div className="pj-filter" role="tablist">
                <button role="tab" aria-selected={!filter} className={!filter ? 'on' : ''} onClick={() => setFilter('')}>Alle <span>{alle.length}</span></button>
                {PROJEKT_STATUS.map((x) => (
                  <button key={x.v} role="tab" aria-selected={filter === x.v} className={filter === x.v ? 'on' : ''} onClick={() => setFilter(x.v)}>{x.label} <span>{anzahl(x.v)}</span></button>
                ))}
              </div>
              <label className="pj-search"><Icon name="search" /><input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Suchen" aria-label="Projekte durchsuchen" /></label>
            </div>

            {sichtbar.length === 0 ? <p className="muted pj-none">Keine Projekte für diese Auswahl.</p> : (
              <div className="pj-grid">
                {sichtbar.map((k) => {
                  const abgelaufen = !!k.frist && k.frist < heute() && k.status === 'nachforderung';
                  return (
                    <article key={k.id} className="pj-card">
                      <div className="pj-card-top">
                        <label className={`pj-st st-${k.status}`} title="Stand ändern">
                          <i />
                          <select value={k.status} aria-label="Stand" onChange={(e) => { const v = e.target.value as ProjektStatus; void aendern(k.id, (p) => void (p.status = v)); }}>
                            {PROJEKT_STATUS.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
                          </select>
                        </label>
                        <span className="pj-icons">
                          <button className="btn ghost" title="Sicherung als ZIP herunterladen (mit allen Unterlagen)" aria-label="Sicherung herunterladen" onClick={() => sichern(k)}><Icon name="download" /></button>
                          <button className="btn ghost" title="Kopie anlegen" aria-label="Kopie anlegen" onClick={() => kopieren(k)}><Icon name="copy" /></button>
                          <button className="btn ghost danger" title="Projekt löschen" aria-label="Projekt löschen" onClick={() => loeschen(k)}><Icon name="trash" /></button>
                        </span>
                      </div>

                      <button className="pj-title" onClick={() => onOpen(k.id)}>{k.titel || 'Ohne Bezeichnung'}</button>
                      <div className="pj-sub">{[k.nummer, k.auftraggeber].filter(Boolean).join(' · ') || 'Noch keine Eckdaten'}</div>

                      <div className="pj-meta">
                        <span>{plural(k.angebote, 'Bieter', 'Bieter')} · {plural(k.dokumente, 'Datei', 'Dateien')}</span>
                        <span title={new Date(k.geaendert).toLocaleString('de-DE')}>{geaendert(k.geaendert)}</span>
                      </div>
                      {(k.status === 'nachforderung' || k.frist) && (
                        <label className={`pj-frist ${abgelaufen ? 'bad' : ''}`}>
                          {abgelaufen ? 'Frist abgelaufen' : 'Nachreichen bis'}
                          <input type="date" value={k.frist} aria-label="Frist für Nachreichungen" onChange={(e) => { const v = e.target.value; void aendern(k.id, (p) => void (p.frist = v)); }} />
                        </label>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        <section className="pj-store">
          <div className="pj-store-main">
            <Icon name="lock" />
            <div>
              <b>Nur in diesem Browser gespeichert</b>
              <span className="muted"> · {mb(info?.belegt ?? null)} belegt{info?.dauerhaft ? ' · dauerhaft gesichert' : ''}</span>
              <details>
                <summary>Was heißt das?</summary>
                <p>Projekte und Unterlagen liegen <b>nur in diesem Browser auf diesem Gerät</b> (IndexedDB) und werden nicht an uns übertragen. In einem anderen Browser, auf einem anderen Gerät oder nach dem Löschen der Websitedaten sind sie nicht vorhanden. Für den Gerätewechsel, die Weitergabe an Kollegen und als Sicherung: Projekt als ZIP herunterladen <Icon name="download" /> und dort über „Sicherung laden“ öffnen.</p>
                {!info?.dauerhaft && <p>Ohne dauerhafte Speicherung darf der Browser die Daten bei Platzmangel selbst löschen.</p>}
              </details>
            </div>
          </div>
          <div className="row">
            {!info?.dauerhaft && <button className="btn small" onClick={dauerhaft}>Dauerhaft speichern</button>}
            <button className="btn small ghost danger" title="Löscht alle in diesem Browser gespeicherten Daten dieser Anwendung" onClick={allesLoeschen}><Icon name="trash" /> Alle Daten löschen</button>
          </div>
        </section>
      </main>
      <Foot />
    </div>
  );
}
