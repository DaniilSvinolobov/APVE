# Angebotsauswertung – Preisspiegel & Vergabeempfehlung

Web-App (deutsch) für die Auswertung von Angeboten mit mehreren Losen und Nachverhandlung:
Unterlagen einlesen → Preisspiegel je Los → Wertung → Vergabevermerk (PDF).
Alle Daten bleiben im Browser (localStorage), es gibt kein Backend.

```bash
npm install
npm run dev     # Entwicklung
npm run build   # Produktions-Build nach dist/ (Vercel erkennt Vite automatisch)
```

## Einlesen (Schritt 2)
Ordner, ZIP-Dateien (auch verschachtelt) oder Einzeldateien ins Feld ziehen:
- **Soll-LV:** GAEB X83 (DA XML), P83 (GAEB 2000) oder D83 (GAEB 90) – liefert Positionen, Texte, Mengen, Lose
- **Angebote:** GAEB X84 / P84 / D84 je Bieterordner; Signaturbeleg, Eignungsfragebogen, Nachforderungen usw. werden erkannt
- Zuordnung der Preise über die Ordnungszahl (OZ); Mengenabweichungen zwischen LV und Bieterdatei werden markiert
  (z. B. korrigierte Stückzahl) und lassen sich per Klick ins LV übernehmen
- PDF-Scans (z. B. gedrucktes LV) können nicht ausgewertet werden

## Vergabevermerk (Schritt 5)
Aufbau wie der bisherige manuelle Vermerk (Veranlassung, Gegenstand, Verfahren, Prüfung und Wertung 4.1–4.n,
Nachverhandlung, Vergabevorschlag je Los, Gesamtbudget, Unterschrift, Anlagen), Arial 11 pt, Logo und
„Seite x von y“ auf jeder Seite. Als PDF über „Drucken“ (Chrome/Edge) speichern. Texte sind anklickbar und editierbar.

## Fachliche Logik
- Nachlass ohne Bedingung wird eingerechnet, Skonto nicht gewertet
- Rang je Los und Runde; maßgeblich ist die letzte Runde mit wertbaren Angeboten
- Auffällige Einzelpreise/Titel (Abweichung vom Mittel der übrigen Angebote) fließen in die Begründung ein
- Auffallend niedrige Gesamtpreise (Standard 15 % unter Kostenvoranschlag bzw. Nächstbieter) → Hinweis zur Aufklärung
- Die App ersetzt keine Rechtsprüfung.
