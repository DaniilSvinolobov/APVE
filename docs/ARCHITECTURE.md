# Architektur – wo fange ich an zu lesen?

Reihenfolge zum Einlesen: `src/main.tsx` → `src/App.tsx` → ein Schritt in `src/steps/` → die dort genutzte Logik.

## Datenfluss
```
Dateien (Ordner/ZIP)
   │  import/zip.ts       ZIPs entpacken
   │  import/files.ts     eigenes LV (81/82/83, ohne Preise) finden, Angebote (84, auch 81/83 mit Preisen) je Bieterordner gruppieren
   │  import/analyze.ts   ein Angebot lesen (gaeb/gaeb.ts), Firma/Datum/Unterlagen erkennen
   │  import/pdf.ts + gaeb/lvCheck.ts + import/lvPruefung.ts   LV prüfen (GAEB intern/untereinander, PDF gegen GAEB)
   │  import/ozMatch.ts   Bieterpositionen mit abweichender OZ über Text/Einheit/Menge dem Soll-LV zuordnen
   │  import/pdfSumme.ts  Gegenprobe: Endsumme im PDF des Bieters (lokal im Browser, Scans ohne Textebene nicht lesbar)
   │  import/lvAusPdf.ts  eigenes LV nur als PDF: Positionen, Mengen, Titel, ggf. Preise aus den Textzeilen (ohne GAEB-Datei)
   │  import/kopfdaten.ts Eckdaten für Schritt 1 (Vergabenummer, Termine, Verfasser …) aus GAEB-Kopf, Vorbemerkungen und LV-PDF-Deckblatt; belegt nur leere Felder
   │  import/apply.ts     LV (+ Schätzpreise aus 82) und Angebote in den State schreiben, Vollständigkeit vorbelegen
   ▼
State  (domain/types.ts)  ── ein Objekt für das ganze Projekt, liegt im Browser (storage/projectStore.ts)
   │  domain/calc.ts      Preisspiegel, Rang je Los und Runde, Auffälligkeiten, Rechenprüfung
   ▼
Oberfläche (steps/)  →  Vergabevermerk (vermerk/vermerk.ts) → Druck/PDF
```

## Ordner in `src/`
| Ordner | Inhalt | React? |
|---|---|---|
| `domain/` | `types` (State & Co.), `calc` (Wertung, Rang), `fmt` (deutsche Zahlen/Datum), `demo` (Beispiel-/Leerprojekt) | nein |
| `gaeb/` | Parser GAEB 90 / 2000 / DA XML | nein |
| `import/` | Einlesen und Zuordnen, siehe Datenfluss; `docStore.ts` hält Originaldateien nur im Arbeitsspeicher | nein |
| `ki/` | optionale Dokumentprüfung (Einwilligung, Zugangscode, Zerlegen großer Dateien in `teile.ts`, Aufruf von `api/pruefen.ts` → Bedrock EU über `api/_ki.ts`) und Eignungsprüfung (`kiEignung.ts` → `api/eignung.ts`: Referenzen, Recherche) | nein |
| `vermerk/` | Aufbau und Texte des Vergabevermerks; `anfrage.ts` = E-Mail-Text „Rückfrage an den Auftraggeber“ | nein |
| `geo/` | geschätzte Entfernung Bieter → Baustelle (`entfernung.ts`, Hook `useGeo` lädt die PLZ-Tabelle `plzDaten.ts` als eigenen Chunk nach) | Hook |
| `steps/` | die fünf Schritte; `stepList.ts` = Schrittliste und Fortschrittshaken; `LvKarte.tsx` (eigenes LV) und `OfferDateien.tsx` (Unterlagen je Angebot) mit Dateiliste zum Entfernen/Ergänzen; `Nachunternehmer.tsx` (PQ-Nummer und Nachunternehmer je Bieter prüfen/korrigieren); `Anfrage.tsx` (Rückfrage an den Auftraggeber, in der Wertung) | ja |
| `components/` | wiederverwendbare UI-Bausteine (`ui.tsx`, `DropZone.tsx`) | ja |
| `storage/` | Browser-Speicher (`projectStore.ts`), Export CSV/JSON (`exportCsv.ts`), Preisspiegel als PDF (`preisspiegelPdf.ts`, pdf-lib + Schrift Inter, im Browser erzeugt) | nein |

## Regeln, damit es lesbar bleibt
- Abhängigkeiten zeigen nach unten: `steps` → `import`/`ki`/`vermerk`/`storage` → `geo` → `domain`/`gaeb`. Nie umgekehrt.
- Fachlogik (Rechnen, Parsen, Texte) gehört nicht in `.tsx`-Dateien.
- Der gesamte Zustand ist ein `State`; Änderungen laufen über `up(fn)` in `App.tsx`.
- Außerhalb von `api/` gibt es keine Netzwerkzugriffe (siehe Datenschutz in `CLAUDE.md`).
