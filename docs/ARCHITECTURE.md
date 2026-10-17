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
| `ki/` | optionale Dokumentprüfung (Einwilligung, Zugangscode, Aufruf von `api/pruefen.ts`) | nein |
| `vermerk/` | Aufbau und Texte des Vergabevermerks | nein |
| `steps/` | die fünf Schritte; `stepList.ts` = Schrittliste und Fortschrittshaken; `LvKarte.tsx` (eigenes LV) und `OfferDateien.tsx` (Unterlagen je Angebot) mit Dateiliste zum Entfernen/Ergänzen | ja |
| `components/` | wiederverwendbare UI-Bausteine (`ui.tsx`, `DropZone.tsx`) | ja |
| `storage/` | Browser-Speicher (`projectStore.ts`), Export CSV/JSON (`exportCsv.ts`) | nein |

## Regeln, damit es lesbar bleibt
- Abhängigkeiten zeigen nach unten: `steps` → `import`/`ki`/`vermerk`/`storage` → `domain`/`gaeb`. Nie umgekehrt.
- Fachlogik (Rechnen, Parsen, Texte) gehört nicht in `.tsx`-Dateien.
- Der gesamte Zustand ist ein `State`; Änderungen laufen über `up(fn)` in `App.tsx`.
- Außerhalb von `api/` gibt es keine Netzwerkzugriffe (siehe Datenschutz in `CLAUDE.md`).
