# Angebotsauswertung – Preisspiegel & Vergabeempfehlung

Web-App (deutsch) für die Auswertung von Angeboten: Formalprüfung → Preisspiegel → Wertung → Vergabeempfehlung/Vergabevermerk.
Alle Daten bleiben im Browser (localStorage), es gibt kein Backend.

```bash
npm install
npm run dev     # Entwicklung
npm run build   # Produktions-Build nach dist/
```

## Ablauf in der App
1. **Vergabe** – Eckdaten, Verfahren, Kostenschätzung, Erfassungsart (LV-positionsweise oder nur Summen), Wertungskriterien
2. **Bieter** – Formalprüfung als Haken-Matrix, Ausschluss mit Begründung
3. **Preisspiegel** – EP je Position/Bieter (Excel-Einfügen), Nachlass, Skonto (nur Info), Rechenprüfung, Ausreißer-Markierung
4. **Wertung** – Rangfolge, Abstand zur Kostenschätzung/zum günstigsten, Hinweise (auffallend niedrig → Preisaufklärung), optional gewichtete Kriterien
5. **Empfehlung** – automatisch formulierter Vorschlag + Begründung, druckbarer Vergabevermerk (PDF), Excel-CSV-Export, JSON-Sicherung

## Fachliche Logik (Orientierung an VOB/A)
- Wertung: Nachlass ohne Bedingung wird eingerechnet, **Skonto nicht gewertet** (§ 16d VOB/A)
- Auffallend niedrige Preise: Hinweis bei > 15 % (einstellbar) unter Kostenschätzung bzw. Nächstbieter → Aufklärung; „unangemessen" = nicht gewertet
- Preispunkte (bei mehreren Kriterien): günstigster Preis ÷ Preis × 100
- Die App ersetzt keine Rechtsprüfung; Schwellenwerte und Vorgaben des jeweiligen Auftraggebers bitte gegenprüfen.
