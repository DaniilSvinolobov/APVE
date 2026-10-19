// Erzeugt src/geo/plzDaten.ts aus GeoNames-Postleitzahlen (CC BY 4.0).
// Eingabe: zipcodes.de.json aus github.com/zauberware/postal-codes-json-xml-csv (data/DE.zip) – aufbereitete GeoNames-Daten (download.geonames.org/export/zip/DE.zip)
// Aufruf: node scripts/build-plz.mjs zipcodes.de.json src/geo/plzDaten.ts
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(src, 'utf8'));
const FIRMA = /GmbH|\bAG\b|\bKG\b|Bank|Versicherung|Postfach|e\.V\.|&|Verwaltung|Amt\b|Service/i;
const plz = new Map(), orte = new Map();
const add = (m, k, la, lo) => { const a = m.get(k) ?? [0, 0, 0]; a[0] += la; a[1] += lo; a[2]++; m.set(k, a); };
for (const r of rows) {
  const la = Number(r.latitude), lo = Number(r.longitude);
  if (!/^\d{5}$/.test(r.zipcode) || !la || !lo) continue;
  add(plz, r.zipcode, la, lo);
  if (FIRMA.test(r.place)) continue;
  const name = r.place.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/,.*$/, '').replace(/\s+/g, ' ').trim();
  if (name) add(orte, `${name}\t${r.community_code}`, la, lo);
}
// gleichnamige Orte (Kerpen bei Köln / Kerpen in der Eifel): den Ort mit den meisten Postleitzahlen nehmen, nicht den Mittelwert
const orteEins = new Map();
for (const [k, a] of orte) { const n = k.split('\t')[0]; if (!orteEins.has(n) || orteEins.get(n)[2] < a[2]) orteEins.set(n, a); }
const enc = (m) => [...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, [la, lo, n]]) => `${k}:${Math.round((la / n) * 100)}:${Math.round((lo / n) * 100)}`).join('|');
writeFileSync(out, `/* Automatisch erzeugt aus GeoNames-Postleitzahlen (https://www.geonames.org, Lizenz CC BY 4.0). Nicht von Hand bearbeiten.
 * Format: „Schlüssel:Breite×100:Länge×100“, getrennt durch „|“ – Mittelpunkt je Postleitzahl bzw. je Ortsname (bei gleichnamigen Orten der größere). */
export const PLZ = '${enc(plz)}';
export const ORTE = '${enc(orteEins).replace(/'/g, "\\'")}';
`);
console.log(plz.size, 'PLZ,', orte.size, 'Orte');
