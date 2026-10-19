# Arbeitsregeln für dieses Projekt

Web-App „Angebotsauswertung – Preisspiegel & Vergabeempfehlung“ (React + TypeScript + Vite, Hosting Vercel). Oberfläche, Texte und Vergabevermerk sind **deutsch**.

## Git-Ablauf (verbindlich)
- `main` ist der stabile Stand; Vercel-Production deployt von `main`. Nie direkt auf `main` arbeiten.
- Jede Aufgabe bekommt einen eigenen Branch von `main` mit sprechendem Namen (`feature/…`, `fix/…`, `chore/…`).
- **Vor jedem Push, Pull und Merge den Nutzer fragen** und warten. Das gilt auch für Pull Requests und deren Merge.
- Kleine, thematisch getrennte Commits (`feat:`, `fix:`, `docs:`, `chore:` + kurze deutsche Beschreibung).
- Änderungen gelangen per Pull Request nach `main` (Squash-Merge); danach Branch löschen.
- Keine Geheimnisse committen (API-Keys nur als Vercel-Umgebungsvariablen).

## Qualitätsprüfung vor jedem Pull Request
```bash
npx tsc --noEmit
npm run build
```
Zusätzlich die betroffene Funktion im Browser prüfen (z. B. mit Playwright). Ergebnisse ehrlich berichten, auch wenn etwas nicht getestet werden konnte.

## Aufbau
- `src/gaeb/gaeb.ts` – Parser GAEB 90 (D8x), GAEB 2000 (P8x), GAEB DA XML (X8x)
- `src/import/` – Ordner/ZIP einlesen (`zip`, `files`), Angebote lesen (`analyze`), in den State schreiben (`apply`); Zuordnung über Ordnungszahl
- `src/domain/calc.ts` – Preisspiegel, Rang je Los und Runde, Auffälligkeiten, Rechenprüfung
- `src/vermerk/vermerk.ts` – Aufbau und Texte des Vergabevermerks; `src/steps/StepVermerk.tsx` – Anzeige/Druck
- `src/steps/` (`Step*.tsx`, `Vollstaendigkeit.tsx`) – die fünf Schritte der Oberfläche; `src/storage/` – Browser-Speicher und Export
- `docs/ARCHITECTURE.md` – Datenfluss und Ordnerübersicht
- `api/_ki.ts` – Zugang zu Claude über Amazon Bedrock in der EU (Zugangsdaten nur in `BEDROCK_*`; Region/Modell außerhalb der EU werden abgelehnt)
- `api/pruefen.ts` – optionale Dokumentprüfung mit Claude; `src/ki/teile.ts` zerlegt große Dateien im Browser
- `api/eignung.ts` – optionale Referenzauswertung (Bedrock, EU) und Internetrecherche zum Bieter (Anthropic-API, nur mit `ANTHROPIC_API_KEY`) (`src/ki/kiEignung.ts`, Anzeige `src/steps/EignungKi.tsx`)

## Fachliche Leitplanken
- Wertung nach VOB/A-Logik: Nachlass ohne Bedingung wird eingerechnet, **Skonto nicht**. Ein Los wird je Runde (Haupt- bzw. Nachverhandlung) gerankt; maßgeblich ist die letzte Runde mit wertbaren Angeboten.
- Der Vergabevermerk folgt dem Aufbau der Vorlage (1 Veranlassung bis 6 Gesamtbudget, Unterschrift, Anlagen, Vollständigkeitsprüfung als Anlage), Schrift Segoe UI Light 11 pt, A4, „Seite x von y“. Texte bleiben editierbar.
- Zahlen im deutschen Format (`1.234,56`); Rechenwerte nie nur anzeigen, sondern nachrechnen und Abweichungen melden.
- Die App ersetzt keine Rechtsprüfung; Hinweise auf Aufklärungspflichten (auffallend niedrige Preise) bleiben Hinweise.

## Datenschutz (DSGVO)
- Projektdaten bleiben im Browser (localStorage). Keine Cookies, kein Tracking, **keine externen Hosts** (keine CDN-Schriften, keine Analytics).
- Übermittlung an Dritte nur optional, nach ausdrücklicher Aktivierung durch den Nutzer und nur, was der Zweck braucht (Datenminimierung). Dokumente (alle Unterlagen der Angebote, auch Meisterbriefe, Versicherungs- und Präqualifikationsnachweise) gehen nach Einwilligung ausschließlich an Claude über Amazon Bedrock in der EU; an die Websuche (Anthropic-API, USA) nur Firmenname, Ort und Losbezeichnungen.
- Server-Funktionen in Frankfurt (`fra1`). Neue Datenflüsse zuerst mit dem Nutzer abstimmen und in README/Datenschutzhinweisen dokumentieren.
