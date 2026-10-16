# Angebotsauswertung – Preisspiegel & Vergabeempfehlung

Web-App (deutsch) für die Auswertung von Angeboten mit mehreren Losen und Nachverhandlung:
Unterlagen einlesen → Preisspiegel je Los → Wertung → Vergabevermerk (PDF).
Alle Projektdaten bleiben im Browser (localStorage). Einziger Server-Teil ist die optionale Dokumentprüfung (`api/pruefen.ts`, siehe unten).

```bash
npm install
npm run dev     # Entwicklung
npm run build   # Produktions-Build nach dist/ (Vercel erkennt Vite automatisch)
```

## Arbeitsablauf (Git/Vercel)
- `main` ist der stabile Stand; Vercel-Production deployt von `main`.
- Änderungen entstehen auf eigenen Feature-Branches (Vercel baut dafür automatisch Preview-Links) und gelangen per Pull Request nach `main`.
- Vor Push, Pull oder Merge wird nachgefragt.

## Einlesen – LV im Schritt „Vergabe“, Angebote im Schritt „Unterlagen“
**Eigenes LV (Schritt 1, ganz oben):** GAEB-Dateien (X8x, P8x, D8x), die App erkennt die Rolle selbst.
Maßnahme, Auftraggeber und Lose werden daraus vorbelegt:
- **X83 / X81:** Positionen, Texte, Mengen, Lose (bevorzugt 83, sonst 81)
- **X82 (Kostenanschlag):** LV-Schätzpreise je Position → Spalte „LV-Schätzpreis“ im Preisspiegel; der Kostenvoranschlag je Los wird daraus vorbelegt (manuelle Eingabe hat Vorrang)
- Eine x81/x83-Datei **mit Preisen** ist kein LV, sondern ein Angebot und wird hier abgewiesen.
- **LV-Prüfung** (Kasten „Prüfung des LV“): doppelte OZ, Positionen ohne Menge/Einheit/Kurztext, leere Titel, Rechen- und Summenprüfung bei Preisen; mehrere Dateien desselben LV (z. B. X83 ↔ D83, X82) werden auf Positionen, Mengen, Einheiten und Texte verglichen.
- **LV als PDF** zusätzlich ablegen: Text wird lokal im Browser gelesen (pdf.js) und je Ordnungszahl mit Menge und Einheit der GAEB-Datei verglichen (fehlende/zusätzliche Positionen, abweichende Mengen). Scans ohne Text können nicht gelesen werden und werden als Hinweis gemeldet.

**Angebote der Bieter (Schritt 2):** Ordner oder ZIP-Dateien (auch verschachtelt)
- GAEB X84 / P84 / D84 je Bieterordner; Signaturbeleg, Eignungsfragebogen, Nachforderungen usw. werden erkannt
- Exportiert ein Bieter seine Preise als **X83/X81** (statt X84), wird die Datei am Preisbestand erkannt (Mehrheit der Positionen mit Einheitspreis) und als Angebot gelesen; im Angebot steht dazu ein Hinweis
- Zuordnung der Preise über die Ordnungszahl (OZ); Mengenabweichungen zwischen LV und Bieterdatei werden markiert
  (z. B. korrigierte Stückzahl) und lassen sich per Klick ins LV übernehmen
- Liegt im Angebot das **LV als PDF** (Dateiname enthält „LV“/„Leistungsverzeichnis“ oder `AngebotN_L.pdf`), wird es mit den Preisen der GAEB-Datei abgeglichen (Einheitspreis, Gesamtbetrag, Menge × EP); das Ergebnis steht am Angebot
- **Preise nur im PDF:** Enthält der Bieterordner nur ein unbepreistes GAEB-LV (x81/x83) und das bepreiste LV als PDF, erkennt die App das, liest EP/GP aus dem PDF (je OZ, anhand des eigenen LV), markiert das Angebot („Preise aus PDF“) und setzt in der Vollständigkeitsprüfung bei „Preise vollständig (GAEB-Angebotsdatei)“ den Status „Nur als PDF (GAEB ohne Preise)“. Im Vermerk (4.4) steht ein entsprechender Satz. Die Zahlen stammen aus der PDF-Texterkennung und sind stichprobenartig zu prüfen; nicht lesbare Positionen werden als „nicht bepreist“ gemeldet.
- PDF-Scans ohne Text können nicht ausgewertet werden

## Dokumentprüfung mit Claude (Schritt 2, optional)
Beim Einlesen öffnet Claude jedes PDF/jeden Scan eines Angebots und beurteilt: ausgefüllt / teilweise / leer,
unterschrieben / nicht unterschrieben. Die Ergebnisse stehen in der Vollständigkeitstabelle (Markierung „KI“,
Begründung als Tooltip) und bleiben manuell änderbar. **Nutzer der App brauchen dafür keinen eigenen Key.**

Einrichtung durch den Betreiber (einmalig, Vercel → Project → Settings → Environment Variables, danach neu deployen):

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `ANTHROPIC_API_KEY` | ja | Key aus console.anthropic.com – bleibt auf dem Server (`api/pruefen.ts`) |
| `APP_ACCESS_CODE` | empfohlen | Zugangscode; verhindert, dass Fremde auf Ihre Kosten die Funktion nutzen (wird Nutzern einmalig abgefragt) |
| `KI_MODEL` | nein | Standard `claude-opus-5-5`; z. B. `claude-sonnet-5-5` für geringere Kosten |

Ohne `ANTHROPIC_API_KEY` bleibt die App voll nutzbar; die Tabelle wird dann nur anhand der Dateinamen vorbelegt.
Hinweise: Im Anthropic-Console ein monatliches Ausgabenlimit setzen. Die Dokumente werden zur Prüfung über die
Vercel-Function an die Anthropic-API übermittelt. Pro Anfrage max. ca. 3 MB (Vercel-Limit), größere Dateien werden übersprungen.

## Datenschutz (DSGVO)
- Projektdaten bleiben im Browser (localStorage); „Daten löschen“ in der Kopfzeile entfernt sie.
- Schriftarten werden lokal ausgeliefert (keine Google Fonts), keine Cookies, kein Tracking.
- Vercel-Functions laufen in Frankfurt (`regions: ["fra1"]` in `vercel.json`).
- Die Claude-Dokumentprüfung ist optional und erst nach ausdrücklicher Aktivierung im Browser aktiv. Übermittelt werden nur Formulare und
  Erklärungen (Angebotsschreiben, Eignungsfragebogen, Nachforderungen, Nachunternehmerverzeichnis) – keine Meisterbriefe, Referenzen,
  Versicherungs- oder Präqualifikationsnachweise.
- `public/datenschutz.html` und `public/impressum.html` sind **Entwürfe** mit gelb markierten Platzhaltern; vor dem produktiven Einsatz
  ergänzen und rechtlich prüfen lassen (AVV mit Vercel und Anthropic, Drittlandübertragung, Verarbeitungsverzeichnis, Vertraulichkeit im Vergabeverfahren).

## Vergabevermerk (Schritt 5)
Aufbau wie der bisherige manuelle Vermerk (Veranlassung, Gegenstand, Verfahren, Prüfung und Wertung 4.1–4.n,
Nachverhandlung, Vergabevorschlag je Los, Gesamtbudget, Unterschrift, Anlagen) mit Vollständigkeitsprüfung als Anlage,
Segoe UI Light 11 pt, Logo und „Seite x von y“ auf jeder Seite. Als PDF über „Drucken“ (Chrome/Edge) speichern.
Texte sind anklickbar und editierbar.

## Fachliche Logik
- Nachlass ohne Bedingung wird eingerechnet, Skonto nicht gewertet
- Rang je Los und Runde; maßgeblich ist die letzte Runde mit wertbaren Angeboten
- Auffällige Einzelpreise/Titel (Abweichung vom Mittel der übrigen Angebote) fließen in die Begründung ein
- Auffallend niedrige Gesamtpreise (Standard 15 % unter Kostenvoranschlag bzw. Nächstbieter) → Hinweis zur Aufklärung
- Die App ersetzt keine Rechtsprüfung.
