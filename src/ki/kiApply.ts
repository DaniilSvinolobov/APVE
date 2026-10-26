import type { Offer, PStatus, State } from '../domain/types';
import { docStore, type DocFile } from '../import/docStore';

const CONSENT = 'apve-ki-consent-eu'; // neue Einwilligung: alle Unterlagen, Verarbeitung über Bedrock in der EU
export const hasConsent = () => { try { return localStorage.getItem(CONSENT) === '1'; } catch { return false; } };
export const setConsent = (v: boolean) => { try { v ? localStorage.setItem(CONSENT, '1') : localStorage.removeItem(CONSENT); } catch { /* ignore */ } };

const CODE = 'apve-access-code';
export const getCode = () => { try { return localStorage.getItem(CODE) ?? ''; } catch { return ''; } };
export const setCode = (c: string) => { try { c ? localStorage.setItem(CODE, c) : localStorage.removeItem(CODE); } catch { /* ignore */ } };

export interface KiDoc { datei: string; art: string; zeilen: string[]; inhalt: 'ausgefuellt' | 'teilweise' | 'leer' | 'unklar'; unterschrift: 'ja' | 'nein' | 'nicht_erforderlich' | 'unklar'; handschrift?: string; sicherheit?: 'hoch' | 'mittel' | 'niedrig'; bemerkung: string }

const rankS: Record<PStatus, number> = { ok: 5, nach: 4, teil: 3, unsign: 2, leer: 1, fehlt: 0, entf: -1, pdf: 0 };

/** Überträgt KI-Befunde in die Vollständigkeitstabelle (Eintragungen des Nutzers bleiben unangetastet). */
export function applyKi(d: State, offerId: string, results: KiDoc[]) {
  const o = d.offers.find((x) => x.id === offerId);
  if (!o) return;
  if (!o.pruef) o.pruef = {};
  o.kiDocs = results.map((r) => ({ datei: r.datei, art: r.art, zeilen: r.zeilen, inhalt: r.inhalt, unterschrift: r.unterschrift, handschrift: r.handschrift, sicherheit: r.sicherheit, bemerkung: r.bemerkung }));
  const best: Record<string, { s: PStatus; n: string }> = {};
  for (const r of results) {
    if (r.sicherheit === 'niedrig') continue; // unsichere Befunde nicht eintragen – die Zeile bleibt offen und wird von Hand geprüft
    for (const id of r.zeilen) {
      const row = d.unterlagen.find((u) => u.id === id);
      if (!row) continue;
      const sigRow = /unterschrieben|signiert/i.test(row.label);
      let s: PStatus | null = null;
      if (sigRow) s = r.unterschrift === 'ja' ? 'ok' : r.unterschrift === 'nein' ? 'unsign' : null;
      else if (r.inhalt === 'leer') s = 'leer';
      else if (r.inhalt === 'teilweise') s = 'teil';
      else if (r.inhalt === 'ausgefuellt') s = r.unterschrift === 'nein' ? 'unsign' : 'ok';
      if (!s) continue;
      const n = `${r.datei.split('/').pop()}: ${r.bemerkung}`;
      if (!best[id] || rankS[s] > rankS[best[id].s]) best[id] = { s, n };
    }
  }
  for (const [id, b] of Object.entries(best)) {
    const cur = o.pruef[id];
    if (cur?.k === 'user') continue;
    // bereits „nachgereicht“ bleibt als Hinweis erhalten, wenn die Datei in Ordner „Nachforderung“ lag
    o.pruef[id] = { s: cur?.s === 'nach' && b.s === 'ok' ? 'nach' : b.s, d: cur?.d ?? '', n: b.n, k: 'ki' };
  }
}

/**
 * Alle Unterlagen eines Angebots gehen in die Prüfung (nach Einwilligung; Verarbeitung über Bedrock in der EU),
 * außer Signaturdateien und Plattformdateien, die keine lesbaren Dokumente sind.
 */
const OHNE = new Set(['Signatur', 'Plattformdatei']);
export function offerDocs(o: Offer): DocFile[] { return (docStore.get(o.id) ?? []).filter((d) => !OHNE.has(d.kat)); }
