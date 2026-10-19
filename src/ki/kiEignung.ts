import type { Eignung, KiReferenz, Offer, State } from '../domain/types';
import { docStore, type DocFile } from '../import/docStore';
import { b64, KiError } from './kiPruefung';
import { zerlegen, type Teil } from './teile';

/**
 * Optionale Eignungsprüfung mit KI (api/eignung), je Funktion mit eigener Einwilligung:
 * - Referenzen: Referenzunterlagen des Bieters (auch nachgereichte) und die Bezeichnungen seiner Lose gehen über Amazon Bedrock (EU) an Claude.
 * - Recherche: nur Firmenname, Ort und Bezeichnungen der Lose gehen an die Anthropic-API (USA); Claude sucht damit im Internet.
 */
export type EignungArt = 'referenzen' | 'recherche';
const CONSENT: Record<EignungArt, string> = { referenzen: 'apve-ki-ref-consent', recherche: 'apve-ki-web-consent' };
export const hasEignungConsent = (a: EignungArt) => { try { return localStorage.getItem(CONSENT[a]) === '1'; } catch { return false; } };
export const setEignungConsent = (a: EignungArt, v: boolean) => { try { v ? localStorage.setItem(CONSENT[a], '1') : localStorage.removeItem(CONSENT[a]); } catch { /* ignore */ } };

const MAX_RAW = 3_000_000; // wie bei der Dokumentprüfung: Vercel begrenzt Request-Bodies auf 4,5 MB
const MAX_DOCS = 8;
const MAX_SEITEN = 30;

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

/** Referenzunterlagen auswerten; große Dateien werden zerlegt und in mehreren Anfragen geprüft, nicht lesbare werden gemeldet. */
export async function referenzenAuswerten(s: State, o: Offer, code: string): Promise<{ ergebnis: NonNullable<Eignung['referenzen']>; ausgelassen: string[] }> {
  const docs = referenzDocs(o);
  if (!docs.length) throw new KiError('Keine Referenzunterlagen – bitte den Angebotsordner in Schritt 2 laden.');
  const teile: Teil[] = [];
  const ausgelassen: string[] = [];
  for (const d of docs) { try { teile.push(...(await zerlegen(d))); } catch { ausgelassen.push(d.name); } }
  const batches: Teil[][] = [];
  let cur: Teil[] = [], size = 0, seiten = 0;
  for (const t of teile) {
    if (cur.length && (size + t.data.length > MAX_RAW || seiten + t.seiten > MAX_SEITEN || cur.length >= MAX_DOCS)) { batches.push(cur); cur = []; size = 0; seiten = 0; }
    cur.push(t); size += t.data.length; seiten += t.seiten;
  }
  if (cur.length) batches.push(cur);
  const liste: KiReferenz[] = [], hinweise: string[] = [], fazit: string[] = [];
  for (const batch of batches) {
    const j = await post<{ referenzen: KiReferenz[]; hinweise: string[]; fazit: string }>(
      { art: 'referenzen', lose: losNamen(s, o), docs: batch.map((t) => ({ path: t.label, mime: t.mime, data: b64(t.data) })) }, code);
    liste.push(...(j.referenzen ?? []));
    hinweise.push(...(j.hinweise ?? []).filter((h) => !hinweise.includes(h)));
    if (j.fazit) fazit.push(j.fazit);
  }
  return {
    ergebnis: { liste, hinweise, fazit: fazit.join('\n'), dateien: docs.filter((d) => !ausgelassen.includes(d.name)).map((d) => d.name), stand: new Date().toISOString() },
    ausgelassen,
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
