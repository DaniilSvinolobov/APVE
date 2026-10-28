import type { DocFile } from '../import/docStore';
import type { KiDoc } from './kiApply';
import { docxAuslesen, docxFuerKi } from './docx';
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

const PARALLEL = 3; // gleichzeitige Anfragen je Angebot

export function b64(data: Uint8Array): string {
  let s = '';
  for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(s);
}

export class KiError extends Error { constructor(msg: string, public status = 0) { super(msg); } }

/** Word-Datei als Text (UTF-8) für die Prüfung; Claude kann .docx nicht selbst öffnen. */
async function wordTeil(d: DocFile): Promise<Teil> {
  const text = docxFuerKi(d.path.split('/').pop() ?? d.path, await docxAuslesen(d.data));
  return { datei: d.path, label: `${d.path} [Word-Datei, als Text ausgelesen]`, mime: 'text/plain', data: new TextEncoder().encode(text.slice(0, 400_000)), seiten: 1 };
}

/**
 * Dokumente eines Angebots prüfen lassen (Zugang liegt serverseitig, Nutzer brauchen keinen Key). Jede Datei bzw. jeder
 * Teil einer großen Datei geht einzeln in eine eigene Anfrage – so kann Claude Befunde nicht zwischen Dokumenten vertauschen.
 */
export async function pruefeAngebot(docs: DocFile[], zeilen: { id: string; label: string }[], code: string, onProgress?: (t: string) => void): Promise<{ results: KiDoc[]; fehler: string[]; grund: string }> {
  const teile: Teil[] = [];
  const fehler: string[] = [];
  let grund = '';
  for (const d of docs) {
    // leere Dateien und Formate, die nicht lesbar sind (.doc, Excel …), nicht senden, sondern als „nicht geprüft“ melden
    try {
      if (d.data.length && /\.docx$/i.test(d.path)) teile.push(await wordTeil(d));
      else if (d.data.length && /\.(pdf|png|jpe?g)$/i.test(d.path)) teile.push(...(await zerlegen(d)));
      else fehler.push(d.path);
    } catch { fehler.push(d.path); }
  }
  const roh: { i: number; k: KiDoc }[] = [];
  let fertig = 0, abbruch = null as KiError | null;
  const pruefeTeil = async (t: Teil) => {
    try {
      const r = await fetch('/api/pruefen', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(code ? { 'x-access-code': code } : {}) },
        body: JSON.stringify({ docs: [{ path: t.label, mime: t.mime, data: b64(t.data) }], zeilen }),
      });
      const j = (await r.json().catch(() => ({}))) as { dokumente?: KiDoc[]; error?: string };
      if (!r.ok) throw new KiError(j.error ?? `Fehler ${r.status}`, r.status);
      // genau ein Dokument je Anfrage: der Befund gehört eindeutig zu diesem Teil
      const k = j.dokumente?.[0];
      if (!k) throw new KiError('Keine Antwort zum Dokument.');
      roh.push({ i: teile.indexOf(t), k: { ...k, datei: t.datei, bemerkung: t.label !== t.datei && !t.label.includes('Word-Datei') ? `${t.label.slice(t.datei.length).trim()} ${k.bemerkung}` : k.bemerkung } });
    } catch (e) {
      // Ein gescheiterter Teil soll die übrigen Dateien des Angebots nicht mitreißen; nur ein falscher Zugangscode bricht ab.
      if (e instanceof KiError && e.status === 401) { abbruch = e; return; }
      fehler.push(t.datei);
      grund ||= e instanceof Error ? e.message : String(e);
    } finally {
      fertig++;
      onProgress?.(`${fertig} von ${teile.length} Dokument(en/teilen) geprüft (${docs.length} Dateien) …`);
    }
  };
  onProgress?.(`${teile.length} Dokument(e/teile) werden einzeln geprüft …`);
  const warte = [...teile];
  await Promise.all(Array.from({ length: Math.min(PARALLEL, warte.length) }, async () => {
    for (let t = warte.shift(); t && !abbruch; t = warte.shift()) await pruefeTeil(t);
  }));
  if (abbruch) throw abbruch;
  if (!roh.length && grund) throw new KiError(grund);
  // in der Reihenfolge der Teile zusammenführen (parallel kommen sie ungeordnet zurück)
  return { results: zusammenfuehren(roh.sort((a, b) => a.i - b.i).map((x) => x.k)), fehler: [...new Set(fehler)], grund };
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
      titel: ks.find((k) => k.titel)?.titel ?? '',
      art: ks[0].art,
      zeilen: [...new Set(ks.flatMap((k) => k.zeilen))],
      vorlage: ks.every((k) => k.vorlage),
      inhalt,
      unterschrift,
      stempel: ks.some((k) => k.stempel),
      handschrift: ks.flatMap((k) => k.handschrift ?? []),
      nachunternehmer: ks.flatMap((k) => k.nachunternehmer ?? []),
      kopf: Object.assign({}, ...ks.map((k) => k.kopf ?? {}).reverse()),
      pq: ks.find((k) => k.pq)?.pq ?? '',
      sicherheit: SICHER[Math.min(...ks.map((k) => SICHER.indexOf(k.sicherheit ?? 'niedrig')))],
      bemerkung: ks.map((k) => k.bemerkung).filter(Boolean).join(' · '),
    };
  });
}
