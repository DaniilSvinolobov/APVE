import type { Eignung, KiReferenz, Offer, State } from '../domain/types';
import { docStore, type DocFile } from '../import/docStore';
import { b64, KiError } from './kiPruefung';

/**
 * Optionale Eignungsprüfung mit KI (api/eignung), je Funktion mit eigener Einwilligung:
 * - Referenzen: Referenzunterlagen des Bieters (auch nachgereichte) und die Bezeichnungen seiner Lose gehen an die Anthropic-API.
 * - Recherche: nur Firmenname, Ort und Bezeichnungen der Lose; Claude sucht damit im Internet.
 */
export type EignungArt = 'referenzen' | 'recherche';
const CONSENT: Record<EignungArt, string> = { referenzen: 'apve-ki-ref-consent', recherche: 'apve-ki-web-consent' };
export const hasEignungConsent = (a: EignungArt) => { try { return localStorage.getItem(CONSENT[a]) === '1'; } catch { return false; } };
export const setEignungConsent = (a: EignungArt, v: boolean) => { try { v ? localStorage.setItem(CONSENT[a], '1') : localStorage.removeItem(CONSENT[a]); } catch { /* ignore */ } };

const MAX_RAW = 3_000_000; // wie bei der Dokumentprüfung: Vercel begrenzt Request-Bodies auf 4,5 MB
const MAX_DOCS = 8;

/** Referenzunterlagen eines Angebots (nur im Arbeitsspeicher; nach Neuladen der Seite Ordner erneut einlesen). */
export function referenzDocs(o: Offer): DocFile[] {
  return (docStore.get(o.id) ?? []).filter((d) => d.kat === 'Referenzen' || (d.kat === 'Nachforderung' && /referenz/i.test(d.name)));
}

/** Bezeichnungen der Lose, für die das Angebot gilt („LOS1 Wege- und Landschaftsbauarbeiten“). */
export const losNamen = (s: State, o: Offer) => s.lose.filter((l) => o.lose.includes(l.id)).map((l) => `${l.nr} ${l.name}`.trim());

async function post<T>(body: unknown, code: string): Promise<T> {
  const r = await fetch('/api/eignung', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(code ? { 'x-access-code': code } : {}) },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new KiError(j.error ?? `Fehler ${r.status}`, r.status);
  return j;
}

/** Referenzunterlagen auswerten; zu große Dateien bzw. mehr als acht bleiben außen vor und werden gemeldet. */
export async function referenzenAuswerten(s: State, o: Offer, code: string): Promise<{ ergebnis: NonNullable<Eignung['referenzen']>; ausgelassen: string[] }> {
  const docs = referenzDocs(o);
  const send: DocFile[] = [];
  let size = 0;
  for (const d of docs) if (send.length < MAX_DOCS && size + d.data.length <= MAX_RAW) { send.push(d); size += d.data.length; }
  if (!send.length) throw new KiError('Keine Referenzunterlagen (bzw. zu groß) – bitte den Angebotsordner in Schritt 2 laden.');
  const j = await post<{ referenzen: KiReferenz[]; hinweise: string[]; fazit: string }>(
    { art: 'referenzen', lose: losNamen(s, o), docs: send.map((d) => ({ path: d.path, mime: d.mime, data: b64(d.data) })) }, code);
  return {
    ergebnis: { liste: j.referenzen ?? [], hinweise: j.hinweise ?? [], fazit: j.fazit ?? '', dateien: send.map((d) => d.name), stand: new Date().toISOString() },
    ausgelassen: docs.filter((d) => !send.includes(d)).map((d) => d.name),
  };
}

/** Öffentlich zugängliche Informationen zum Unternehmen recherchieren (nur Name, Ort, Lose). */
export async function recherchieren(s: State, o: Offer, code: string): Promise<NonNullable<Eignung['recherche']>> {
  const j = await post<{ text: string; quellen: { url: string; titel: string }[] }>({ art: 'recherche', firma: o.firma, ort: o.ort, lose: losNamen(s, o) }, code);
  return { text: j.text ?? '', quellen: j.quellen ?? [], stand: new Date().toISOString() };
}

/** Text für „Qualifikation / Referenzen des Bieters“ aus den vorhandenen Ergebnissen. */
export function eignungText(e: Eignung | undefined): string {
  return [e?.recherche?.text, e?.referenzen?.fazit].map((t) => t?.trim()).filter(Boolean).join('\n');
}
