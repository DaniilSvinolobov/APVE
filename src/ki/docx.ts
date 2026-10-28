/**
 * Word-Formblätter (.docx) für die KI-Prüfung lesbar machen. Claude kann Word-Dateien nicht direkt öffnen; ohne diesen
 * Schritt blieben sie ungeprüft. Läuft im Browser: Text, Tabellen, Kästchen (☒/☐) und Formularfelder werden so
 * ausgelesen, dass leere Felder als „[leeres Feld]“ bzw. leere Tabellenzellen als „[leer]“ sichtbar bleiben.
 */

export interface DocxInhalt {
  text: string;
  felder: number; // Textfelder (Formularfelder, Inhaltssteuerelemente)
  felderAusgefuellt: number;
  kaestchen: number;
  angekreuzt: number;
  bilder: number; // eingebettete Bilder im Textteil (z. B. eingescannte Unterschrift)
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);

/** Symbolzeichen (Wingdings) für Kästchen. */
const SYM_AN = new Set(['F0FE', 'F078', 'F0FD', 'F0FB', '00FE', '0078']);
const SYM_AUS = new Set(['F0A8', 'F06F', 'F0A1', '00A8', '006F']);

const TOK = /<w:p[ >/]|<\/w:p>|<w:tbl>|<\/w:tbl>|<w:tr[ >]|<\/w:tr>|<w:tc[ >]|<\/w:tc>|<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>|<w:ffData>([\s\S]*?)<\/w:ffData>|<w:fldChar [^>]*?w:fldCharType="(begin|separate|end)"[^>]*>|<w:instrText[^>]*>([^<]*)<\/w:instrText>|<w:sdt>|<\/w:sdt>|<w:showingPlcHdr\/>|<w:sym [^>]*?w:char="([0-9A-Fa-f]+)"[^>]*\/>|<w:drawing>|<v:imagedata /g;

/** Inhalt von word/document.xml als Text mit Kennzeichnung leerer Felder. */
export function docxText(xml: string): DocxInhalt {
  const body = xml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
  const st: DocxInhalt = { text: '', felder: 0, felderAusgefuellt: 0, kaestchen: 0, angekreuzt: 0, bilder: 0 };
  const lines: string[] = [];
  let para = '';
  const tabs: { rows: string[]; row: string[]; cell: string }[] = [];
  const fields: { ff: string; instr: string; result: string; phase: 'instr' | 'result' }[] = [];
  const sdts: { plc: boolean }[] = [];

  const emit = (s: string) => {
    const f = fields[fields.length - 1];
    if (f) { f.result += s; return; } // Text im Befehlsteil kommt nur in fehlerhaften Feldern vor (Plattform-Vorlagen) – dann als Ergebnis werten
    if (sdts.some((x) => x.plc)) return; // Platzhaltertext eines leeren Inhaltssteuerelements
    para += s;
  };
  const textFeld = (v: string) => {
    st.felder++;
    const w = v.replace(/[\s  ]+/g, ' ').trim();
    if (w) st.felderAusgefuellt++;
    return w ? `«${w}»` : '[leeres Feld]';
  };
  const kaestchen = (an: boolean) => (an ? '☒' : '☐');

  /** Feld abschließen: Kästchen, Textfeld oder sonstiges Feld (Ergebnistext übernehmen, Verweise/Seitenzahlen weglassen). */
  const schliessen = () => {
    const f = fields.pop();
    if (!f) return;
    let out: string;
    if (/<w:checkBox>/.test(f.ff) || /FORMCHECKBOX/.test(f.instr)) {
      const c = /<w:checked(?: w:val="(\w+)")?\/>/.exec(f.ff);
      out = kaestchen(c ? !['0', 'false'].includes(c[1] ?? '1') : /<w:default w:val="(1|true)"\/>/.test(f.ff));
    } else if (/<w:textInput/.test(f.ff) || /FORMTEXT/.test(f.instr)) out = textFeld(f.result);
    else if (/^\s*(NOTEREF|PAGE|NUMPAGES|SEQ)\b/.test(f.instr)) out = '';
    else out = f.result;
    emit(out);
  };

  for (const m of body.matchAll(TOK)) {
    const t = m[0];
    if (m[1] != null) emit(decode(m[1]));
    else if (t === '<w:tab/>') emit('\t');
    else if (t === '<w:br/>' || t === '<w:cr/>') emit(' ');
    else if (m[2] != null) { const f = fields[fields.length - 1]; if (f) f.ff = m[2]; }
    else if (m[3] === 'begin') fields.push({ ff: '', instr: '', result: '', phase: 'instr' });
    else if (m[3] === 'separate') { const f = fields[fields.length - 1]; if (f) f.phase = 'result'; }
    else if (m[3] === 'end') schliessen();
    else if (m[4] != null) { const f = fields[fields.length - 1]; if (f) f.instr += m[4]; }
    else if (t === '<w:sdt>') sdts.push({ plc: false });
    else if (t === '</w:sdt>') { const x = sdts.pop(); if (x?.plc) emit(textFeld('')); }
    else if (t === '<w:showingPlcHdr/>') { const x = sdts[sdts.length - 1]; if (x) x.plc = true; }
    else if (m[5] != null) { const c = m[5].toUpperCase(); if (SYM_AN.has(c)) emit(kaestchen(true)); else if (SYM_AUS.has(c)) emit(kaestchen(false)); }
    else if (t === '<w:drawing>' || t === '<v:imagedata ') { st.bilder++; emit(' [Bild] '); }
    else if (t.startsWith('<w:tbl')) tabs.push({ rows: [], row: [], cell: '' });
    else if (t.startsWith('<w:tr')) { const x = tabs[tabs.length - 1]; if (x) x.row = []; }
    else if (t.startsWith('<w:tc')) { const x = tabs[tabs.length - 1]; if (x) x.cell = ''; }
    else if (t === '</w:tc>') { const x = tabs[tabs.length - 1]; if (x) x.row.push(x.cell.trim() || '[leer]'); }
    else if (t === '</w:tr>') { const x = tabs[tabs.length - 1]; if (x) x.rows.push(`| ${x.row.join(' | ')} |`); }
    else if (t === '</w:tbl>') {
      const x = tabs.pop();
      if (!x) continue;
      const outer = tabs[tabs.length - 1];
      if (outer) outer.cell += (outer.cell ? ' / ' : '') + x.rows.join(' ');
      else lines.push(...x.rows);
    }
    else if (t === '</w:p>') {
      // Felder ohne Trennzeichen/Ende (fehlerhafte Vorlagen) enden spätestens mit dem Absatz
      while (fields.length && fields[fields.length - 1].phase === 'instr') schliessen();
      const p = para.replace(/[  ]+/g, ' ').trim();
      para = '';
      const x = tabs[tabs.length - 1];
      if (x) { if (p) x.cell += (x.cell ? ' / ' : '') + p; }
      else if (p) lines.push(p);
    }
  }
  st.text = lines.join('\n');
  // Kästchen zählen, wie sie im Text stehen (Formularfelder, Symbole und Inhaltssteuerelemente mit ☐/☒)
  st.angekreuzt = (st.text.match(/[☒☑]/g) ?? []).length;
  st.kaestchen = st.angekreuzt + (st.text.match(/☐/g) ?? []).length;
  return st;
}

/** .docx im Browser auslesen (nur Haupttext; Kopf-/Fußzeilen enthalten bei den Formblättern nur Logo und Seitenzahl). */
export async function docxAuslesen(data: Uint8Array): Promise<DocxInhalt> {
  const JSZip = (await import('jszip')).default;
  const z = await JSZip.loadAsync(data);
  const f = z.file('word/document.xml');
  if (!f) throw new Error('Keine Word-Datei.');
  return docxText(await f.async('string'));
}

/** Kurzfassung für die KI: Zählwerte vorweg, dann der Text. */
export function docxFuerKi(name: string, d: DocxInhalt): string {
  return [
    `Word-Datei „${name}“, Inhalt maschinell ausgelesen (kein Bild der Seiten).`,
    `Zählung: ${d.felder} Formular-Textfelder, davon ${d.felderAusgefuellt} ausgefüllt; ${d.kaestchen} Kästchen, davon ${d.angekreuzt} angekreuzt; ${d.bilder} eingebettete Bilder im Textteil.`,
    'Zeichen: ☒ = angekreuzt, ☐ = nicht angekreuzt, «…» = Eintrag in einem Formularfeld, [leeres Feld] = Formularfeld ohne Eintrag, [leer] = leere Tabellenzelle, [Bild] = eingebettetes Bild, | … | = Tabellenzeile.',
    '---',
    d.text,
  ].join('\n');
}
