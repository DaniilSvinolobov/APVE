/** Kleine Hülle um IndexedDB (ohne Bibliothek): eine Datenbank „apve“ mit Projekten, Projektköpfen und Originaldateien. */

const DB = 'apve';
const VERSION = 1;
export const STORES = { projekte: 'projekte', koepfe: 'koepfe', dokumente: 'dokumente' } as const;
type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB nicht verfügbar')); return; }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.projekte)) db.createObjectStore(STORES.projekte); // Schlüssel: Projekt-ID, Wert: State
      if (!db.objectStoreNames.contains(STORES.koepfe)) db.createObjectStore(STORES.koepfe, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORES.dokumente)) {
        const st = db.createObjectStore(STORES.dokumente, { keyPath: ['pid', 'oid'] }); // Originaldateien je Projekt und Angebot
        st.createIndex('pid', 'pid');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; }; // z. B. „Alle Daten löschen“ in einem anderen Tab
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => { dbPromise = null; reject(new Error('Datenbank ist in einem anderen Tab geöffnet')); };
  });
  return dbPromise;
}

const done = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

/** Eine Transaktion über die genannten Speicher; erfüllt sich erst, wenn alles geschrieben ist. */
export async function tx<T>(stores: StoreName[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  const t = db.transaction(stores, mode);
  const ende = new Promise<void>((resolve, reject) => { t.oncomplete = () => resolve(); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error ?? new Error('Transaktion abgebrochen')); });
  const result = await fn(t);
  await ende;
  return result;
}

export const get = <T>(t: IDBTransaction, store: StoreName, key: IDBValidKey) => done(t.objectStore(store).get(key)) as Promise<T | undefined>;
export const getAll = <T>(t: IDBTransaction, store: StoreName) => done(t.objectStore(store).getAll()) as Promise<T[]>;
export const put = (t: IDBTransaction, store: StoreName, value: unknown, key?: IDBValidKey) => done(t.objectStore(store).put(value, key));
export const del = (t: IDBTransaction, store: StoreName, key: IDBValidKey | IDBKeyRange) => done(t.objectStore(store).delete(key));
export const getAllByPid = <T>(t: IDBTransaction, pid: string) => done(t.objectStore(STORES.dokumente).index('pid').getAll(pid)) as Promise<T[]>;
export const keysByPid = (t: IDBTransaction, pid: string) => done(t.objectStore(STORES.dokumente).index('pid').getAllKeys(pid));

/** Ganze Datenbank löschen (Schaltfläche „Alle Daten löschen“). */
export async function deleteDb(): Promise<void> {
  if (dbPromise) { try { (await dbPromise).close(); } catch { /* ignore */ } dbPromise = null; }
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
}
