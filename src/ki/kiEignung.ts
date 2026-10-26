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

/** Dateiname deutet auf Referenzen hin – auch wenn die Datei einer anderen Kategorie zugeordnet ist (z. B. „Eignungsnachweis_Referenzen.pdf“). */
const REF_NAME = /referenz|projektliste|leistungsnachweis|(^|[\s._-])ref([\s._-]|\d)/i;

/** Referenzunterlagen eines Angebots (nur im Arbeitsspeicher; nach Neuladen der Seite Ordner erneut einlesen).
 *  Erkannt am Dateinamen oder daran, dass die KI-Dokumentprüfung die Datei als Referenz eingeordnet hat; leere Dateien nicht. */
export function referenzDocs(o: Offer): DocFile[] {
  const ki = new Set((o.kiDocs ?? []).filter((k) => /referenz/i.test(k.art)).map((k) => k.datei));
  return (docStore.get(o.id) ?? []).filter((d) => d.data.length > 0 && (d.kat === 'Referenzen' || REF_NAME.test(d.name) || ki.has(d.path)));
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

/** Referenzunterlagen auswerten; große Dateien werden zerlegt und in mehreren Anfragen geprüft, nicht lesbare werden gemeldet.
 *  Ein gescheiterter Teil reißt die übrigen nicht mit (wie bei der Dokumentprüfung); nur ein falscher Zugangscode bricht ab. */
export async function referenzenAuswerten(s: State, o: Offer, code: string): Promise<{ ergebnis: NonNullable<Eignung['referenzen']>; ausgelassen: string[]; grund: string }> {
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
  const gescheitert = new Set<string>();
  let grund = '', ok = 0;
  for (const batch of batches) {
    try {
      const j = await post<{ referenzen: KiReferenz[]; hinweise: string[]; fazit: string }>(
        { art: 'referenzen', lose: losNamen(s, o), docs: batch.map((t) => ({ path: t.label, mime: t.mime, data: b64(t.data) })) }, code);
      liste.push(...(j.referenzen ?? []));
      hinweise.push(...(j.hinweise ?? []).filter((h) => !hinweise.includes(h)));
      if (j.fazit) fazit.push(j.fazit);
      ok++;
    } catch (e) {
      if (e instanceof KiError && e.status === 401) throw e;
      batch.forEach((t) => gescheitert.add(t.datei));
      grund ||= e instanceof Error ? e.message : String(e);
    }
  }
  if (!ok) throw new KiError(grund || 'Keine Referenzunterlage konnte gelesen werden.');
  const fehlt = [...ausgelassen, ...docs.filter((d) => gescheitert.has(d.path)).map((d) => d.name)];
  return {
    ergebnis: { liste, hinweise, fazit: fazit.join('\n'), dateien: docs.filter((d) => !fehlt.includes(d.name)).map((d) => d.name), stand: new Date().toISOString() },
    ausgelassen: [...new Set(fehlt)],
    grund,
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
