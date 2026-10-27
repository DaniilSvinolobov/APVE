import { istNuDok, nuZusammen } from '../domain/calc';
import type { HsEintrag, Nachunternehmer, Offer, PStatus, State } from '../domain/types';
import { applyKopf, verfahrenAus } from '../import/kopfdaten';
import { docStore, type DocFile } from '../import/docStore';

const CONSENT = 'apve-ki-consent-eu'; // neue Einwilligung: alle Unterlagen, Verarbeitung über Bedrock in der EU
export const hasConsent = () => { try { return localStorage.getItem(CONSENT) === '1'; } catch { return false; } };
export const setConsent = (v: boolean) => { try { v ? localStorage.setItem(CONSENT, '1') : localStorage.removeItem(CONSENT); } catch { /* ignore */ } };

const CODE = 'apve-access-code';
export const getCode = () => { try { return localStorage.getItem(CODE) ?? ''; } catch { return ''; } };
export const setCode = (c: string) => { try { c ? localStorage.setItem(CODE, c) : localStorage.removeItem(CODE); } catch { /* ignore */ } };

export interface KiDoc { datei: string; art: string; zeilen: string[]; vorlage?: boolean; inhalt: 'ausgefuellt' | 'teilweise' | 'leer' | 'unklar'; unterschrift: 'ja' | 'nein' | 'nicht_erforderlich' | 'unklar'; stempel?: boolean; handschrift?: HsEintrag[]; nachunternehmer?: Nachunternehmer[]; kopf?: Partial<Record<'vergabenummer' | 'massnahmennummer' | 'vergabeart' | 'baumassnahme' | 'leistung' | 'bieter', string>>; pq?: string; sicherheit?: 'hoch' | 'mittel' | 'niedrig'; bemerkung: string }

const rankS: Record<PStatus, number> = { ok: 5, nach: 4, teil: 3, unsign: 2, leer: 1, fehlt: 0, entf: -1, pdf: 0 };

/** Ein Firmenstempel gilt als Zeichnung (auch für Befunde älterer Prüfungen, in denen das noch nicht galt). */
export const mitStempel = <T extends { stempel?: boolean; unterschrift: string }>(k: T): T => (k.stempel && k.unterschrift !== 'ja' ? { ...k, unterschrift: 'ja' } : k);

/** Überträgt KI-Befunde in die Vollständigkeitstabelle (Eintragungen des Nutzers bleiben unangetastet). */
export function applyKi(d: State, offerId: string, roh: KiDoc[]) {
  const results = roh.map(mitStempel);
  const o = d.offers.find((x) => x.id === offerId);
  if (!o) return;
  if (!o.pruef) o.pruef = {};
  o.kiDocs = results.map((r) => ({ datei: r.datei, art: r.art, zeilen: r.zeilen, vorlage: r.vorlage, inhalt: r.inhalt, unterschrift: r.unterschrift, stempel: r.stempel, handschrift: r.handschrift, ...(r.nachunternehmer?.length ? { nachunternehmer: r.nachunternehmer } : {}), ...(r.pq?.trim() ? { pq: r.pq.trim() } : {}), sicherheit: r.sicherheit, bemerkung: r.bemerkung }));
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
  // Nachunternehmer (VVB 233/235): nur aus sicheren Befunden; von Hand bearbeitete Listen bleiben
  if (o.nuQuelle !== 'user') {
    const nuDocs = results.filter((r) => r.sicherheit !== 'niedrig' && r.nachunternehmer?.length);
    const nu = nuDocs.flatMap((r) => r.nachunternehmer!);
    if (nu.length) { o.nu = nuZusammen(nu); o.nuQuelle = 'ki'; }
  }
  // PQ-Nummer: nur aus sicheren Befunden, mit Fundstelle; eine von Hand eingetragene Nummer bleibt
  if (!o.pq?.trim() || o.pqQuelle) {
    const r = results.find((x) => x.sicherheit !== 'niedrig' && x.pq?.trim() && !istNuDok(x)); // PQ aus 233/235 gehört dem jeweiligen Unternehmen
    if (r) { o.pq = r.pq!.trim(); o.pqQuelle = r.datei.split('/').pop(); }
    else if (o.pqQuelle) { delete o.pq; delete o.pqQuelle; }
  }
  // Kopf der Formblätter (Vergabenummer usw.) belegt nur leere Felder des Vorhabens
  const kopf = Object.assign({}, ...results.filter((r) => r.sicherheit !== 'niedrig').map((r) => r.kopf ?? {}).reverse()) as NonNullable<KiDoc['kopf']>;
  const verf = kopf.vergabeart ? verfahrenAus(kopf.vergabeart) : null;
  applyKopf(d.project, { nummer: kopf.vergabenummer, ...(verf ? { verfahren: verf } : {}) });
  if (!d.project.massnahmeNr?.trim() && kopf.massnahmennummer) d.project.massnahmeNr = kopf.massnahmennummer;
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
