import { useEffect, useState } from 'react';
import type { Bew, Offer, State } from '../domain/types';

/**
 * Entfernung Bieter → Baustelle, ohne externen Dienst: Mittelpunkt der Postleitzahl (bzw. des Ortsnamens) aus der
 * mitgelieferten GeoNames-Tabelle, Luftlinie mal Umwegfaktor ≈ Straßenkilometer. Genauigkeit etwa ±15 %, daher immer „ca.“.
 */

export interface Punkt { lat: number; lon: number }
export interface Fundort { pt: Punkt; wie: string } // wie = „PLZ 50181“ bzw. „Ort Bedburg“
export interface Entfernung { km: number; luft: number; von: string; nach: string }

/** Ab dieser Entfernung (geschätzte Straßen-km) schreibt der Vermerk den Satz zu Fahrt- und Betriebskosten automatisch. */
export const KM_HINWEIS = 50;

let daten: { plz: Map<string, Punkt>; orte: Map<string, Punkt> } | null = null;
let laden: Promise<void> | null = null;

const parse = (s: string) => new Map(s.split('|').map((e) => {
  const b = e.lastIndexOf(':'), a = e.lastIndexOf(':', b - 1);
  return [e.slice(0, a), { lat: Number(e.slice(a + 1, b)) / 100, lon: Number(e.slice(b + 1)) / 100 }] as const;
}));

/** Tabelle nachladen (eigener Chunk, ca. 200 KB gepackt) – nur von der eigenen Domain, kein externer Host. */
export function geoLaden(): Promise<void> {
  return (laden ??= import('./plzDaten').then((m) => { daten = { plz: parse(m.PLZ), orte: parse(m.ORTE) }; }));
}

/** Lädt die Tabelle und zeichnet neu, sobald sie da ist; Rückgabe: geladen ja/nein (für useMemo-Abhängigkeiten). */
export function useGeo(): boolean {
  const [da, setDa] = useState(daten != null);
  useEffect(() => { if (!da) geoLaden().then(() => setDa(true)).catch(() => { laden = null; }); }, [da]);
  return da;
}

const norm = (t: string) => t.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();

/** „50181 Bedburg“, „Am Rathaus 1, 50181 Bedburg“, „D-46395 Bocholt“ oder nur „Bedburg-Kaster“ → Koordinate. */
export function findeOrt(text: string | undefined): Fundort | null {
  if (!daten || !text?.trim()) return null;
  const plz = text.match(/(?<!\d)(\d{5})(?!\d)/)?.[1];
  if (plz && daten.plz.has(plz)) return { pt: daten.plz.get(plz)!, wie: `PLZ ${plz}` };
  // Ort steht in Anschriften hinten: Teile von hinten probieren, jeweils auch ohne Zusatz („Stadt …“, „-Kaster“, „ / OT …“)
  const teile = text.replace(/(?<!\d)\d{5}(?!\d)/g, ' ').split(/[,;\n]/).map(norm).filter(Boolean).reverse();
  for (const t of teile) {
    const ohne = t.replace(/^(?:stadt|gemeinde|markt|hansestadt)\s+/, '');
    for (const k of [t, ohne, ohne.split(/\s*\/\s*|\s+ot\s+/)[0], ohne.split('-')[0], ohne.split(' ')[0]]) {
      const pt = k && daten.orte.get(k);
      if (pt) return { pt, wie: `Ort ${k.replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase())}` };
    }
  }
  return null;
}

/** Luftlinie in km (Haversine). */
export function luftlinie(a: Punkt, b: Punkt): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Geschätzte Straßenkilometer: Umwegfaktor fällt von ca. 1,4 im Nahbereich auf ca. 1,18 bei großen Entfernungen
 * (z. B. Köln–Düsseldorf 34 km Luftlinie → ca. 40 km, Berlin–Hamburg 253 km → ca. 300 km, München–Köln 457 km → ca. 540 km).
 * Ab 20 km auf 5 km gerundet.
 */
export function strassenKm(luft: number): number {
  const km = luft * (1.18 + 0.25 * Math.exp(-luft / 30));
  return km < 20 ? Math.max(1, Math.round(km)) : Math.round(km / 5) * 5;
}

/** Geschätzte Entfernung vom Firmenort des Bieters zur Baustelle; `null`, wenn eines von beiden nicht gefunden wird. */
export function entfernung(s: State, o: Offer): Entfernung | null {
  const bs = findeOrt(s.project.baustelle), bi = findeOrt(o.ort);
  if (!bs || !bi) return null;
  const luft = luftlinie(bi.pt, bs.pt);
  return { km: strassenKm(luft), luft: Math.round(luft), von: bi.wie, nach: bs.wie };
}

/** Entfernung für den Text im Vermerk: Eingabe von Hand hat Vorrang (0 = keinen Satz schreiben), sonst die Schätzung ab KM_HINWEIS. */
export function kmFuerVermerk(s: State, o: Offer, b: Bew): number | null {
  if (b.km != null) return b.km > 0 ? b.km : null;
  const e = entfernung(s, o);
  return e && e.km >= KM_HINWEIS ? e.km : null;
}
