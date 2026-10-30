import type { ProjektStatus, State } from '../domain/types';
import type { DocFile } from '../import/docStore';
import { uid } from '../domain/fmt';
import { clearLegacy, legacyState, parseBackup } from './projectStore';
import { STORES, del, get, getAll, getAllByPid, keysByPid, put, tx } from './idb';

/**
 * Projektspeicher. Die Oberfläche kennt nur diese Schnittstelle; heute liegt alles im Browser (IndexedDB),
 * später kann eine Server-Variante (z. B. Firebase je Organisation) dieselbe Schnittstelle erfüllen.
 */
export interface ProjektKopf {
  id: string;
  titel: string;
  nummer: string;
  auftraggeber: string;
  status: ProjektStatus;
  frist: string; // Frist für Nachreichungen ('' = keine)
  angebote: number; // Anzahl Bieter (Hauptangebote)
  dokumente: number; // Anzahl gespeicherter Originaldateien
  erstellt: string; // ISO-Zeitpunkt
  geaendert: string;
}

export interface ProjektRepo {
  list(): Promise<ProjektKopf[]>;
  load(id: string): Promise<State | null>;
  save(id: string, s: State): Promise<void>;
  create(s: State, docs?: Map<string, DocFile[]>): Promise<string>;
  duplicate(id: string): Promise<string>;
  remove(id: string): Promise<void>;
  loadDocs(id: string): Promise<Map<string, DocFile[]>>;
  saveDocs(id: string, offerId: string, files: DocFile[] | null): Promise<void>;
  clearDocs(id: string): Promise<void>;
}

interface DocRecord { pid: string; oid: string; files: DocFile[] }

const kopf = (id: string, s: State, alt: ProjektKopf | undefined, dokumente: number): ProjektKopf => ({
  id,
  titel: s.project.titel,
  nummer: s.project.nummer,
  auftraggeber: s.project.auftraggeber,
  status: s.project.status ?? 'pruefung',
  frist: s.project.frist ?? '',
  angebote: s.offers.filter((o) => !o.basis).length,
  dokumente,
  erstellt: alt?.erstellt ?? new Date().toISOString(),
  geaendert: new Date().toISOString(),
});

const zaehle = (recs: DocRecord[]) => recs.reduce((n, r) => n + r.files.length, 0);

export const localRepo: ProjektRepo = {
  async list() {
    const k = await tx([STORES.koepfe], 'readonly', (t) => getAll<ProjektKopf>(t, STORES.koepfe));
    return k.sort((a, b) => b.geaendert.localeCompare(a.geaendert));
  },

  async load(id) {
    const raw = await tx([STORES.projekte], 'readonly', (t) => get<unknown>(t, STORES.projekte, id));
    return raw ? parseBackup(raw) : null;
  },

  async save(id, s) {
    await tx([STORES.projekte, STORES.koepfe], 'readwrite', async (t) => {
      const alt = await get<ProjektKopf>(t, STORES.koepfe, id);
      await put(t, STORES.projekte, s, id);
      await put(t, STORES.koepfe, kopf(id, s, alt, alt?.dokumente ?? 0)); // Dateianzahl pflegt saveDocs
    });
  },

  async create(s, docs) {
    const id = uid() + uid();
    await tx([STORES.projekte, STORES.koepfe, STORES.dokumente], 'readwrite', async (t) => {
      let n = 0;
      for (const [oid, files] of docs ?? []) { await put(t, STORES.dokumente, { pid: id, oid, files } satisfies DocRecord); n += files.length; }
      await put(t, STORES.projekte, s, id);
      await put(t, STORES.koepfe, kopf(id, s, undefined, n));
    });
    return id;
  },

  async duplicate(id) {
    const s = await this.load(id);
    if (!s) throw new Error('Projekt nicht gefunden');
    s.project = { ...s.project, titel: `${s.project.titel || 'Projekt'} (Kopie)` };
    return this.create(s, await this.loadDocs(id));
  },

  async remove(id) {
    await tx([STORES.projekte, STORES.koepfe, STORES.dokumente], 'readwrite', async (t) => {
      await del(t, STORES.projekte, id);
      await del(t, STORES.koepfe, id);
      for (const k of await keysByPid(t, id)) await del(t, STORES.dokumente, k);
    });
  },

  async loadDocs(id) {
    const recs = await tx([STORES.dokumente], 'readonly', (t) => getAllByPid<DocRecord>(t, id));
    return new Map(recs.map((r) => [r.oid, r.files]));
  },

  async saveDocs(id, offerId, files) {
    await tx([STORES.dokumente, STORES.koepfe], 'readwrite', async (t) => {
      if (files?.length) await put(t, STORES.dokumente, { pid: id, oid: offerId, files } satisfies DocRecord);
      else await del(t, STORES.dokumente, [id, offerId]);
      const k = await get<ProjektKopf>(t, STORES.koepfe, id);
      if (k) await put(t, STORES.koepfe, { ...k, dokumente: zaehle(await getAllByPid<DocRecord>(t, id)) });
    });
  },

  async clearDocs(id) {
    await tx([STORES.dokumente], 'readwrite', async (t) => { for (const k of await keysByPid(t, id)) await del(t, STORES.dokumente, k); });
  },
};

/** Einmalig: Projekt aus dem früheren localStorage-Speicher als erstes Projekt übernehmen (erst danach dort löschen). */
export async function altesProjektUebernehmen(repo: ProjektRepo): Promise<string | null> {
  const st = legacyState();
  if (!st) { clearLegacy(); return null; }
  const id = await repo.create(st);
  clearLegacy();
  return id;
}

/** Verwaiste Dateien entfernen (Angebot wurde im Projekt gelöscht). */
export async function verwaisteDokumente(repo: ProjektRepo, id: string, s: State, docs: Map<string, DocFile[]>) {
  const ids = new Set(s.offers.map((o) => o.id));
  for (const oid of [...docs.keys()]) if (!ids.has(oid)) { docs.delete(oid); await repo.saveDocs(id, oid, null); }
}

/** Browser bitten, die Daten nicht von sich aus zu löschen (z. B. bei knappem Speicherplatz). */
export async function dauerhaftAnfordern(): Promise<boolean> {
  try { return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false; } catch { return false; }
}

export interface SpeicherInfo { dauerhaft: boolean; belegt: number | null; frei: number | null }
export async function speicherInfo(): Promise<SpeicherInfo> {
  try {
    const [dauerhaft, est] = await Promise.all([navigator.storage?.persisted?.() ?? false, navigator.storage?.estimate?.()]);
    return { dauerhaft, belegt: est?.usage ?? null, frei: est?.quota != null && est.usage != null ? est.quota - est.usage : null };
  } catch { return { dauerhaft: false, belegt: null, frei: null }; }
}
