import JSZip from 'jszip';
import type { State } from '../domain/types';
import type { DocFile } from '../import/docStore';
import { parseBackup } from './projectStore';

/**
 * Datensicherung eines Projekts als ZIP: `projekt.json` (State) und die Originaldateien unter `dokumente/`,
 * beschrieben in `dokumente.json`. Ältere Sicherungen (nur JSON) lassen sich weiterhin laden.
 */
interface DocEintrag { offerId: string; datei: string; name: string; path: string; mime: string; kat: string }

export async function sicherungZip(s: State, docs: Map<string, DocFile[]>): Promise<Blob> {
  const zip = new JSZip();
  zip.file('projekt.json', JSON.stringify(s, null, 2));
  const liste: DocEintrag[] = [];
  let i = 0;
  for (const [offerId, files] of docs) {
    for (const f of files) {
      const datei = `dokumente/${String(++i).padStart(4, '0')}_${f.name.replace(/[\\/:*?"<>|]/g, '_')}`;
      zip.file(datei, f.data);
      liste.push({ offerId, datei, name: f.name, path: f.path, mime: f.mime, kat: f.kat });
    }
  }
  zip.file('dokumente.json', JSON.stringify(liste, null, 2));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export const sicherungName = (s: State) => `Vergabe_${(s.project.nummer || s.project.titel || 'Projekt').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)}_${new Date().toISOString().slice(0, 10)}.zip`;

/** Sicherung (ZIP oder älteres JSON) lesen; wirft einen Fehler mit deutschem Text, wenn die Datei nicht passt. */
export async function sicherungLesen(f: File): Promise<{ state: State; docs: Map<string, DocFile[]> }> {
  const fehler = 'Datei konnte nicht gelesen werden (keine Datensicherung dieser Anwendung).';
  const docs = new Map<string, DocFile[]>();
  if (/\.json$/i.test(f.name) || f.type === 'application/json') {
    const state = parseBackup(JSON.parse(await f.text()));
    if (!state) throw new Error(fehler);
    return { state, docs };
  }
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await f.arrayBuffer()); } catch { throw new Error(fehler); }
  const pj = zip.file('projekt.json');
  const state = pj ? parseBackup(JSON.parse(await pj.async('string'))) : null;
  if (!state) throw new Error(fehler);
  const dj = zip.file('dokumente.json');
  const liste: DocEintrag[] = dj ? JSON.parse(await dj.async('string')) : [];
  const ids = new Set(state.offers.map((o) => o.id));
  for (const e of liste) {
    const z = zip.file(e.datei);
    if (!z || !ids.has(e.offerId)) continue;
    const doc: DocFile = { name: e.name, path: e.path, mime: e.mime, kat: e.kat, data: await z.async('uint8array') };
    docs.set(e.offerId, [...(docs.get(e.offerId) ?? []), doc]);
  }
  return { state, docs };
}
