import type { DocFile } from '../import/docStore';
import type { KiDoc } from './kiApply';

export interface KiStatus { enabled: boolean; code: boolean }

/** Ist die serverseitige Dokumentprüfung (api/pruefen) auf dieser Installation eingerichtet? */
export async function kiStatus(): Promise<KiStatus> {
  try {
    const r = await fetch('/api/pruefen', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { enabled: false, code: false };
    return (await r.json()) as KiStatus;
  } catch { return { enabled: false, code: false }; }
}

const MAX_RAW = 3_000_000; // Vercel begrenzt Request-Bodies auf 4,5 MB (Base64 + 33 %)

export function b64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

export class KiError extends Error { constructor(msg: string, public status = 0) { super(msg); } }

/** Dokumente eines Angebots prüfen lassen (Key liegt serverseitig, Nutzer brauchen keinen). */
export async function pruefeAngebot(docs: DocFile[], zeilen: { id: string; label: string }[], code: string, onProgress?: (t: string) => void): Promise<{ results: KiDoc[]; zuGross: string[] }> {
  const zuGross = docs.filter((d) => d.data.length > MAX_RAW).map((d) => d.path);
  const usable = docs.filter((d) => d.data.length <= MAX_RAW);
  const batches: DocFile[][] = [];
  let cur: DocFile[] = [], size = 0;
  for (const d of usable) {
    if (cur.length && (size + d.data.length > MAX_RAW || cur.length >= 4)) { batches.push(cur); cur = []; size = 0; }
    cur.push(d); size += d.data.length;
  }
  if (cur.length) batches.push(cur);
  const results: KiDoc[] = [];
  let n = 0;
  for (const batch of batches) {
    onProgress?.(`Dokument ${n + 1}–${n + batch.length} von ${usable.length} …`);
    const r = await fetch('/api/pruefen', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(code ? { 'x-access-code': code } : {}) },
      body: JSON.stringify({ docs: batch.map((d) => ({ path: d.path, mime: d.mime, data: b64(d.data) })), zeilen }),
    });
    const j = (await r.json().catch(() => ({}))) as { dokumente?: KiDoc[]; error?: string };
    if (!r.ok) throw new KiError(j.error ?? `Fehler ${r.status}`, r.status);
    results.push(...(j.dokumente ?? []));
    n += batch.length;
  }
  return { results, zuGross };
}
