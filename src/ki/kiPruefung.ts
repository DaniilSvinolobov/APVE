import type { DocFile } from '../import/docStore';
import type { KiDoc } from './kiApply';
import { zerlegen, type Teil } from './teile';

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
const MAX_SEITEN = 30; // Seiten je Anfrage, damit die Function nicht in die Zeitgrenze läuft

export function b64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

export class KiError extends Error { constructor(msg: string, public status = 0) { super(msg); } }

/** Dokumente eines Angebots prüfen lassen (Zugang liegt serverseitig, Nutzer brauchen keinen Key). Große Dateien werden in Teile zerlegt. */
export async function pruefeAngebot(docs: DocFile[], zeilen: { id: string; label: string }[], code: string, onProgress?: (t: string) => void): Promise<{ results: KiDoc[]; fehler: string[] }> {
  const teile: Teil[] = [];
  const fehler: string[] = [];
  for (const d of docs) {
    try { teile.push(...(await zerlegen(d))); }
    catch { fehler.push(d.path); }
  }
  const batches: Teil[][] = [];
  let cur: Teil[] = [], size = 0, seiten = 0;
  for (const t of teile) {
    if (cur.length && (size + t.data.length > MAX_RAW || seiten + t.seiten > MAX_SEITEN || cur.length >= 6)) { batches.push(cur); cur = []; size = 0; seiten = 0; }
    cur.push(t); size += t.data.length; seiten += t.seiten;
  }
  if (cur.length) batches.push(cur);
  const roh: KiDoc[] = [];
  let n = 0;
  for (const batch of batches) {
    onProgress?.(`Teil ${n + 1}–${n + batch.length} von ${teile.length} (${docs.length} Dateien) …`);
    const r = await fetch('/api/pruefen', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(code ? { 'x-access-code': code } : {}) },
      body: JSON.stringify({ docs: batch.map((t) => ({ path: t.label, mime: t.mime, data: b64(t.data) })), zeilen }),
    });
    const j = (await r.json().catch(() => ({}))) as { dokumente?: KiDoc[]; error?: string };
    if (!r.ok) throw new KiError(j.error ?? `Fehler ${r.status}`, r.status);
    // Befund dem gesendeten Teil zuordnen (über den Namen, sonst über die Reihenfolge) und auf die Originaldatei zurückführen
    (j.dokumente ?? []).forEach((k, i) => {
      const t = batch.find((x) => x.label === k.datei) ?? batch.find((x) => x.label.endsWith(k.datei)) ?? batch[i];
      if (t) roh.push({ ...k, datei: t.datei, bemerkung: t.label !== t.datei ? `${t.label.slice(t.datei.length).trim()} ${k.bemerkung}` : k.bemerkung });
    });
    n += batch.length;
  }
  return { results: zusammenfuehren(roh), fehler };
}

const SICHER = ['niedrig', 'mittel', 'hoch'] as const;

/** Befunde mehrerer Teile einer Datei zu einem Befund zusammenführen. */
function zusammenfuehren(roh: KiDoc[]): KiDoc[] {
  const by = new Map<string, KiDoc[]>();
  for (const k of roh) by.set(k.datei, [...(by.get(k.datei) ?? []), k]);
  return [...by.values()].map((ks) => {
    if (ks.length === 1) return ks[0];
    const inh = new Set(ks.map((k) => k.inhalt));
    const inhalt: KiDoc['inhalt'] = inh.has('unklar') ? 'unklar' : inh.size === 1 ? ks[0].inhalt : 'teilweise';
    const u = ks.map((k) => k.unterschrift);
    const unterschrift: KiDoc['unterschrift'] = u.includes('ja') ? 'ja' : u.includes('nein') ? 'nein' : u.includes('unklar') ? 'unklar' : 'nicht_erforderlich';
    return {
      datei: ks[0].datei,
      art: ks[0].art,
      zeilen: [...new Set(ks.flatMap((k) => k.zeilen))],
      inhalt,
      unterschrift,
      handschrift: ks.map((k) => k.handschrift).filter(Boolean).join('; '),
      sicherheit: SICHER[Math.min(...ks.map((k) => SICHER.indexOf(k.sicherheit ?? 'niedrig')))],
      bemerkung: ks.map((k) => k.bemerkung).filter(Boolean).join(' · '),
    };
  });
}
