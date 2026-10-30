# Angebotsauswertung – Preisspiegel & Vergabeempfehlung

Web-App (deutsch) für die Auswertung von Angeboten mit mehreren Losen und Nachverhandlung:
Unterlagen einlesen → Preisspiegel je Los → Wertung → Vergabevermerk (PDF).
Alle Projektdaten bleiben im Browser (IndexedDB, mehrere Projekte mit ihren Unterlagen, jederzeit wieder zu öffnen). Einziger Server-Teil ist die optionale Dokumentprüfung (`api/pruefen.ts`, siehe unten).

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
Maßnahme, Auftraggeber und Lose werden daraus vorbelegt, außerdem – soweit vorhanden – Vergabenummer, Vergabestelle, Vergabeverfahren, Eröffnungstermin, Zuschlagsfrist, Ausführungsbeginn/-ende, Verfasser (Planverfasser), MwSt.-Satz und das Datum des Kostenvoranschlags (aus dem Kopf der GAEB-DA-XML-Datei, den Vorbemerkungen des LV und dem Deckblatt des LV-PDF; nur leere Felder, Eingaben von Hand bleiben):
- **X83 / X81:** Positionen, Texte, Mengen, Lose (bevorzugt 83, sonst 81)
- **Nur PDF (ohne GAEB):** Positionen, Mengen, Einheiten, Titel und – beim bepreisten LV – die LV-Schätzpreise werden direkt aus dem PDF gelesen (lokal im Browser); die Summe wird mit der Endsumme im PDF gegengeprüft. Scans ohne Textebene sind nicht lesbar.
- **X82 (Kostenanschlag):** LV-Schätzpreise je Position (eigenes LV) → Spalte „LV-Schätzpreis“ im Preisspiegel; Zuordnung zum LV über die OZ (auch bei abweichender Nullauffüllung), sonst über Text/Menge. Fehlende Schätzpreise lassen sich in der Spalte direkt eintragen. Der Kostenvoranschlag je Los wird daraus vorbelegt (manuelle Eingabe hat Vorrang)
- **Preisspiegel:** Abweichung in % zum Günstigsten, zum LV-Schätzpreis oder zu beiden (je Position, Titel und Gesamt); Fußzeilen Nachlass (% und €), Gesamt netto, MwSt., Gesamt brutto, Abweichung zum Günstigsten/LV-Schätzpreis, Skonto informativ; höchster EP je Position violett
- Eine x81/x83-Datei **mit Preisen** ist kein LV, sondern ein Angebot und wird hier abgewiesen.
- **LV-Prüfung** (Kasten „Prüfung des LV“): doppelte OZ, Positionen ohne Menge/Einheit/Kurztext, leere Titel, Rechen- und Summenprüfung bei Preisen; mehrere Dateien desselben LV (z. B. X83 ↔ D83, X82) werden auf Positionen, Mengen, Einheiten und Texte verglichen.
- **Geladene Dateien** stehen als Liste unter dem Ablagefeld und lassen sich einzeln entfernen. Weitere Dateien einfach dazulegen: eine X82 allein ergänzt die Schätzpreise zum geladenen LV, ein PDF wird zusätzlich abgeglichen, eine neue X81/X83 ersetzt das LV (Schätzpreise einer separaten X82 bleiben erhalten).
- **LV als PDF** zusätzlich ablegen: Text wird lokal im Browser gelesen (pdf.js) und je Ordnungszahl mit Menge und Einheit der GAEB-Datei verglichen (fehlende/zusätzliche Positionen, abweichende Mengen). Scans ohne Text können nicht gelesen werden und werden als Hinweis gemeldet.

**Angebote der Bieter (Schritt 2):** Ordner oder ZIP-Dateien (auch verschachtelt)
- GAEB X84 / P84 / D84 je Bieterordner; Signaturbeleg, Eignungsfragebogen, Nachforderungen usw. werden erkannt
- Exportiert ein Bieter seine Preise als **X83/X81** (statt X84), wird die Datei am Preisbestand erkannt (Mehrheit der Positionen mit Einheitspreis) und als Angebot gelesen; im Angebot steht dazu ein Hinweis
- Zuordnung der Preise über die Ordnungszahl (OZ); Mengenabweichungen zwischen LV und Bieterdatei werden markiert
  (z. B. korrigierte Stückzahl) und lassen sich per Klick ins LV übernehmen
- Liegt im Angebot das **LV als PDF** (Dateiname enthält „LV“/„Leistungsverzeichnis“ oder `AngebotN_L.pdf`), wird es mit den Preisen der GAEB-Datei abgeglichen (Einheitspreis, Gesamtbetrag, Menge × EP); das Ergebnis steht am Angebot
- **Preise nur im PDF:** Enthält der Bieterordner nur ein unbepreistes GAEB-LV (x81/x83) und das bepreiste LV als PDF, erkennt die App das, liest EP/GP aus dem PDF (je OZ, anhand des eigenen LV), markiert das Angebot („Preise aus PDF“) und setzt in der Vollständigkeitsprüfung bei „Preise vollständig (GAEB-Angebotsdatei)“ den Status „Nur als PDF (GAEB ohne Preise)“. Im Vermerk (4.4) steht ein entsprechender Satz. Die Zahlen stammen aus der PDF-Texterkennung und sind stichprobenartig zu prüfen; nicht lesbare Positionen werden als „nicht bepreist“ gemeldet.
- **Preise nur im PDF:** gilt auch, wenn gar keine GAEB-Datei beiliegt (z. B. weil sie nachgereicht wird). Ordnungszahlen mit Platzhaltern („00.__.___1“) und Pauschalpositionen („pauschal 1.334,00“) werden erkannt.
- **Kein Ordner geht verloren:** Lassen sich aus einem Bieterordner keine Preise lesen (keine Preisdatei, PDF nicht lesbar, eigenes LV noch nicht geladen), wird das Angebot trotzdem angelegt („ohne Preise“), deutlich gemeldet und in der Vollständigkeitsprüfung bei „Preise vollständig“ als „nicht beigefügt“ eingetragen. Wird der Ordner später mit Preisdatei erneut eingelesen, ersetzt das neue Angebot den Platzhalter (Nummer, Eingaben von Hand und Markierungen „nachgereicht“ bleiben; die Preisdatei gilt als nachgereicht).
- Dateinamen aus ZIP-Dateien, die Windows ohne UTF-8-Kennung packt (Umlaute, ß), werden richtig gelesen.
- PDF-Scans ohne Text können nicht ausgewertet werden
- **Vollständigkeitsprüfung als PDF** (Schritt 2, „Als PDF herunterladen“; auch unter „Anlagen bearbeiten“ im Vermerk): Tabelle Unterlagen × Angebote (A4 quer) und je Angebot die **nachzufordernden Unterlagen** (nicht beigefügt, nicht ausgefüllt, teilweise ausgefüllt, nicht unterschrieben) – zum Versand an den Auftraggeber. Nach dem Eingang der Nachreichungen das PDF erneut erzeugen; nachgereichte Unterlagen erscheinen mit Datum. Das PDF entsteht im Browser, es werden keine Daten übermittelt.
- **Unterlagen je Angebot** (aufklappbar an der Angebotskarte): alle eingelesenen Dateien mit Kategorie; einzelne Dateien entfernen, Dateien (auch ZIP) ergänzen, als **nachgereicht** markieren und das Eingangsdatum setzen. Nachgereichte Unterlagen werden in der Vollständigkeitsprüfung als „nachgereicht“ mit Datum eingetragen (fehlt eine passende Zeile, entsteht eine neue); Einträge von Hand oder durch die KI bleiben dabei unverändert. Neue Preisdateien (X84) einer Nachverhandlung gehören nicht hierher, sondern über „Nachverhandlung einlesen“ an das Hauptangebot (siehe unten).
- **Nachverhandlung** (eigene Runde, Originalunterlagen bleiben unverändert): Jede Nachverhandlung ist ein eigenes Angebot mit eigenen Preisen, eigenem Nachlass und eigenen Unterlagen, das mit dem Hauptangebot desselben Bieters verknüpft ist und in dessen Karte erscheint (Runde 2 = „Nachverhandlung“, Runde 3 = „Nachverhandlung 2“).
  - Einlesen am Hauptangebot über **„Nachverhandlung einlesen“** (Preisdatei, Schreiben, auch Ordner/ZIP). Liegt keine Preisdatei bei (z. B. nur ein Nachlassschreiben), gelten die Einheitspreise der vorigen Runde als bestätigt; den Nachlass trägt man an der Nachverhandlung ein.
  - Im Ablagefeld oben werden Unterordner bzw. Dateien mit „Nachverhandlung“ im Namen vom Hauptangebot getrennt und als eigene Runde eingelesen; ebenso ein weiteres Angebot desselben Bieters oder eines mit Datum nach der Eröffnung. Ein Angebot lässt sich unter „Runde“ von Hand einem Hauptangebot zuordnen oder an der Nachverhandlung wieder „als Hauptangebot führen“.
  - Die Karte zeigt, welche Einheitspreise sich gegenüber der vorigen Runde geändert haben. Vollständigkeitsprüfung, KI-Dokumentprüfung, Eignung und Nachunternehmer betreffen nur das Hauptangebot. Gewertet und gerankt wird je Runde; im Vermerk stehen die Nachverhandlungen unter 4.x.
  - Hinweis bei Öffentlicher/Beschränkter Ausschreibung bzw. Offenem/Nicht offenem Verfahren: dort sind Verhandlungen über Angebote und Preise grundsätzlich unzulässig (§ 15 Abs. 3 VOB/A, § 15 EU Abs. 3 VOB/A); zulässig sind sie z. B. in der Freihändigen Vergabe und im Verhandlungsverfahren.

## Dokumentprüfung mit Claude (Schritt 2, optional)
Beim Einlesen öffnet Claude **jede Unterlage** eines Angebots (PDF, Scan, Foto – auch Meisterbrief, Referenzen, Versicherungs-
und Präqualifikationsnachweise, LV mit Preisen) und beurteilt: ausgefüllt / teilweise / leer, unterschrieben / nicht unterschrieben;
handschriftliche Eintragungen werden mit Seitenzahl wiedergegeben. Jeder Befund hat eine Sicherheit (hoch/mittel/niedrig); unsichere
Befunde werden **nicht** in die Tabelle eingetragen, die Zeile bleibt offen und ist von Hand zu prüfen. Große Dateien werden im Browser
in Teile zerlegt (max. 20 Seiten bzw. ca. 2,8 MB je Teil, übergroße Einzelseiten als Bild), sodass keine Datei übersprungen wird.
Die Ergebnisse stehen in der Vollständigkeitstabelle (Markierung „KI“, Begründung als Tooltip) und bleiben manuell änderbar.
Zusätzlich liest Claude aus dem **VVB 233/235 die Nachunternehmer** (OZ/Leistungsbereich, Teilleistung, Unternehmen), eine
**Präqualifikationsnummer** und aus dem Kopf der Formblätter **Vergabenummer, Maßnahmennummer und Vergabeart** (nur leere Felder in
Schritt 1). Die Nachunternehmer stehen in Schritt 4 je Bieter in einer Tabelle zum Prüfen und Korrigieren (Handschrift wird nicht immer
richtig gelesen, z. B. „Versicherung“ statt „Verkehrssicherung“); von Hand bearbeitete Listen überschreibt eine neue Prüfung nicht.
Bei Befunden älterer Prüfungen wird die Liste aus den handschriftlichen Eintragungen im VVB 233 abgeleitet.
**Nutzer der App brauchen dafür keinen eigenen Key.**

Claude läuft über **Amazon Bedrock in der EU** (Standard: Frankfurt, EU-Inferenzprofil). Die Function bricht ab, wenn Region oder
Modell außerhalb der EU liegen würden.

Einrichtung durch den Betreiber (einmalig):
1. AWS-Konto anlegen, in der Konsole Region **Europe (Frankfurt) eu-central-1** wählen.
2. *Amazon Bedrock → Model access*: Zugriff auf **Claude Sonnet 4.6** anfordern (stärkere Modelle wie Opus 5.5 nach Bedarf; dann `KI_MODEL` anpassen).
3. *Bedrock → Inference profiles*: die ID des **EU**-Profils für Claude Sonnet 4.6 nachsehen (erwartet `eu.anthropic.claude-sonnet-4-6`;
   weicht sie ab, als `KI_MODEL` eintragen).
4. Zugang anlegen: entweder einen **Bedrock-API-Key** erzeugen oder einen IAM-Nutzer, der nur Bedrock aufrufen darf
   (`bedrock-mantle:CreateInference`), mit Zugangsschlüssel.
5. In AWS ein Budget mit Warnung setzen (Billing → Budgets).
6. Vercel → Project → Settings → Environment Variables eintragen, danach neu deployen:

| Variable | Pflicht | Bedeutung |
|---|---|---|
| `BEDROCK_API_KEY` | ja* | Bedrock-API-Key – bleibt auf dem Server |
| `BEDROCK_ACCESS_KEY_ID`, `BEDROCK_SECRET_ACCESS_KEY` | ja* | *statt des API-Keys: Zugangsschlüssel des IAM-Nutzers |
| `BEDROCK_REGION` | nein | Standard `eu-central-1`; nur `eu-…` zulässig |
| `KI_MODEL` | nein | Standard `eu.anthropic.claude-sonnet-4-6`; Profile `global.`/`us.` u. Ä. werden abgelehnt |
| `KI_EFFORT` | nein | `low`/`medium`/`high` (Standard `high`, gründlichste Prüfung) |
| `APP_ACCESS_CODE` | empfohlen | Zugangscode; verhindert, dass Fremde auf Ihre Kosten die Funktion nutzen (wird Nutzern einmalig abgefragt) |
| `ANTHROPIC_API_KEY` | nein | nur für die Internetrecherche in Schritt 4 (Bedrock hat keine Websuche); ohne Key ist sie ausgeschaltet |
| `ANTHROPIC_WORKSPACE_ID` | nein | nur nötig, wenn der `ANTHROPIC_API_KEY` keinem Workspace zugeordnet ist (`wrkspc_…`, zu finden in der Claude Console unter Workspaces) |

Ohne Bedrock-Zugang bleibt die App voll nutzbar; die Tabelle wird dann nur anhand der Dateinamen vorbelegt.
Die Vercel-Variablennamen `AWS_*` sind reserviert, daher die eigenen Namen.

## Projekte speichern
- Startseite ist die **Projektübersicht**: alle Vergaben in diesem Browser mit Stand (*In Prüfung / Nachforderung läuft / Wertung / Abgeschlossen*), Frist für Nachreichungen (abgelaufen = rot), Anzahl Bieter und Dateien. Öffnen, Kopie, Sicherung (ZIP), Löschen.
- Jede Änderung wird automatisch gespeichert, auch die Originalunterlagen der Angebote (bisher nur bis zum Neuladen vorhanden). Nachgereichte Unterlagen lassen sich Tage später im Schritt „Unterlagen“ ergänzen.
- Ein Projekt aus der früheren Version (localStorage) wird beim ersten Start einmalig als Projekt übernommen.
- Die Oberfläche spricht nur die Schnittstelle `ProjektRepo` an (`src/storage/projektRepo.ts`); eine spätere Server-Variante (z. B. Firebase je Organisation) kann sie ersetzen, ohne die Schritte zu ändern.

## Datenschutz (DSGVO)
- Projektdaten und Originalunterlagen bleiben im Browser (IndexedDB) und werden nicht übertragen; „Alle Daten löschen“ in der Projektübersicht entfernt sie.
  Sie liegen nur in diesem Browser auf diesem Gerät. Wechsel des Geräts, Weitergabe und Sicherung über „Sicherung“ (ZIP mit `projekt.json` und allen Unterlagen), wieder einlesen über „Sicherung laden“ (ältere JSON-Sicherungen gehen weiterhin).
- Schriftarten werden lokal ausgeliefert (keine Google Fonts), keine Cookies, kein Tracking.
- Die Entfernung zur Baustelle wird im Browser aus einer mitgelieferten PLZ-Tabelle geschätzt; Anschriften verlassen den Browser nicht.
- Vercel-Functions laufen in Frankfurt (`regions: ["fra1"]` in `vercel.json`).
- Die Claude-Dokumentprüfung ist optional und erst nach ausdrücklicher Aktivierung im Browser aktiv. Übermittelt werden dann alle
  Unterlagen der Angebote (auch Meisterbriefe, Referenzen, Versicherungs- und Präqualifikationsnachweise), und zwar über Amazon Bedrock
  in der EU (Frankfurt). Wer vor dieser Änderung zugestimmt hatte, wird erneut gefragt.
- Die Eignungsprüfung mit Claude (Schritt 4) hat zwei eigene Einwilligungen: **Referenzen auswerten** übermittelt die
  Referenzunterlagen des Bieters (auch nachgereichte) und die Losbezeichnungen über Amazon Bedrock (EU); **Im Internet recherchieren** übermittelt nur
  Firmenname, Ort und Losbezeichnungen – Claude sucht damit über die Websuche von Anthropic. Beides läuft nur auf Knopfdruck je Bieter.
- `public/datenschutz.html` und `public/impressum.html` enthalten die Angaben des Betreibers (Verantwortlicher, Anschrift, USt-IdNr.)
  und die Bedingungen von Vercel, AWS (Bedrock) und Anthropic. Offen ist nur die Geschäftsanschrift (gelb markiert). Eine rechtliche
  Prüfung bleibt empfohlen (AVV mit den Kunden, Verarbeitungsverzeichnis, Vertraulichkeit im Vergabeverfahren).

## Eignung mit KI (Schritt 4, optional)
- `api/eignung.ts` mit `art: 'referenzen'` (Referenzlisten → Projekte, Vergleichbarkeit mit den Losen, Hinweise, Fazit als JSON)
  und `art: 'recherche'` (Websuche → Leistungsprofil und öffentliche Referenzen als Text mit Quellen).
- Ergebnisse stehen am Angebot (`offer.eignung`) und lassen sich in „Qualifikation / Referenzen“ übernehmen; der Text bleibt editierbar.
- Referenzen: gleicher Bedrock-Zugang wie die Dokumentprüfung; Recherche: `ANTHROPIC_API_KEY` (optional `KI_WEB_MODEL`). Laufzeit bis 300 s.

## Vergabevermerk (Schritt 5)
Aufbau wie der bisherige manuelle Vermerk (Veranlassung, Gegenstand, Verfahren, Prüfung und Wertung 4.1–4.n,
Nachverhandlung, Vergabevorschlag je Los, Gesamtbudget, Unterschrift, Anlagen). Die Vollständigkeitsprüfung steht nur im Anlagenverzeichnis;
sie wird wie der Preisspiegel als eigenes PDF heruntergeladen (siehe Schritt 2).
Inhalte der Wertungsschritte der bisherigen Vergabeempfehlungen sind in Abschnitt 4 enthalten: Tabelle der geprüften Angebotssummen
netto/brutto mit dem verpreisten LV (4.3), offene Unterlagen getrennt nach fehlt / unausgefüllt / teilweise / nicht unterschrieben (4.4),
**Nachweise und Eignungsprüfung** je einzeln geprüftem Bieter mit Eignungsnachweis (VVB 124 bzw. PQ-Nummer) und Nachunternehmereinsatz (4.5),
je Los die Lage der Angebote zum Kostenvoranschlag sowie je Bieter Titel und Positionen mit deutlicher Abweichung vom LV-Schätzpreis, ohne Schätzpreis vom günstigsten Angebot
(Prüfregel „Einzelpreis auffällig ab“), jeweils getrennt nach auffallend hoch und auffallend niedrig, und die
fachliche Auswertung. Gibt es nichts Auffälliges, steht das ausdrücklich im Text. **Engere Wahl:** In Schritt 4 wählt man per Haken direkt in der Rangtabelle (vorbelegt: die zwei günstigsten),
welche Bieter einzeln geprüft werden; für jeden anderen nennt 4.4 den Grund (eigener Text oder automatisch: Abstand in % zu den
gewählten Angeboten und zum Kostenvoranschlag), dazu optional die Festlegung (z. B. Abstimmung mit der Vergabestelle). Ohne eingetragenes Gesamtbudget nennt Abschnitt 6 den Kostenvoranschlag.
Alle Texte bleiben im Vermerk editierbar.
Segoe UI Light 11 pt, Logo und „Seite x von y“ auf jeder Seite. Als PDF über „Drucken“ (Chrome/Edge) speichern.
Texte sind anklickbar und editierbar.

## Fachliche Logik
- Nachlass ohne Bedingung wird eingerechnet, Skonto nicht gewertet
- Rang je Los und Runde; maßgeblich ist die letzte Runde mit wertbaren Angeboten
- **Eine Regel für auffällige Einzelpreise** – gleich in Preisspiegel (Markierung), Wertung, Vermerk und Rückfrage: EP weicht um mehr als „Einzelpreis auffällig ab“ (Standard 30 %) vom LV-Schätzpreis ab (ohne Schätzpreis: vom günstigsten EP der Runde, wie im Preisspiegel) **und** die Mehr-/Minderkosten der Position (Menge × Differenz) erreichen 0,5 % der mittleren Angebotssumme der Runde (mind. 250 €, auf 50 € gerundet; Titel: das Doppelte). Titel werden ebenso mit der Schätz-Titelsumme bzw. der günstigsten Titelsumme verglichen. In der Wertung zeigt jede Bieterkarte nur die auffälligen Titel (↑/↓ mit %) und die Zahl der auffälligen Positionen; „In Rückfrage prüfen“ übernimmt den Bieter in die Rückfrage. Die Prüfregeln stehen in Schritt 1 in einer eigenen Karte
- **Rückfrage an den Auftraggeber** (Schritt 4): E-Mail-Text während der Prüfung. Je Bieter per Haken wählbar, ob er in der E-Mail steht, und dann: detaillierte Angebotskalkulation nachfordern (vorgeschlagen werden die nach der Regel oben auffälligen Positionen, also dieselben wie im Preisspiegel; Tabelle nach Titeln geordnet mit Menge, EP, GP, Vergleichs-EP und Auswirkung, Positionen einzeln oder je Titel per Haken wählbar, Liste änderbar) oder Ausschluss vorab empfehlen (zählt dann nicht mehr als günstigstes Vergleichsangebot). Vorbelegt sind die Bieter der engeren Wahl mit auffälligen Positionen. Wertung und Rangfolge bleiben unverändert; der Vermerk nennt in 4.4 (nach den Gründen für die nicht weiter gewerteten Angebote und der Festlegung), bei welchen Bietern Unterlagen zur Aufklärung der Angebotspreise angefordert wurden. Text kopieren, ins E-Mail-Programm übergeben (mailto, ohne Server) oder als Textdatei speichern
- Auffallend niedrige Gesamtpreise (Standard 15 % unter Kostenvoranschlag bzw. Nächstbieter) → Hinweis zur Aufklärung
- Die App ersetzt keine Rechtsprüfung.

## Entfernung zur Baustelle
- Baustelle in Schritt 1 als „PLZ Ort“ (vorbelegt aus „Baustelle:“/„Ausführungsort:“ im LV, sonst aus der Anschrift des Auftraggebers).
- Firmenort des Bieters aus dem Signaturbeleg bzw. der Anschrift in der GAEB-Datei; in Schritt 2 änderbar (am besten mit PLZ).
- Geschätzte Straßenkilometer = Luftlinie zwischen den PLZ-Mittelpunkten × Umwegfaktor (ca. 1,4 im Nahbereich bis ca. 1,18 auf
  großen Strecken), Genauigkeit etwa ±15 %. Ab 50 km schreibt der Vermerk den Satz zu Fahrt- und Betriebskosten automatisch;
  ein Wert von Hand hat Vorrang, 0 km unterdrückt den Satz.
- Ohne externen Dienst: Die PLZ-Tabelle (`src/geo/plzDaten.ts`, erzeugt mit `scripts/build-plz.mjs`) wird mit der App ausgeliefert.
  Datenquelle: [GeoNames](https://www.geonames.org) Postleitzahlen, Lizenz [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
