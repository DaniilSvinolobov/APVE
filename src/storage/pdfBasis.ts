/**
 * Gemeinsame Grundlagen der im Browser erzeugten PDF-Anlagen (Preisspiegel, Vollständigkeitsprüfung):
 * Schrift Inter wie in der Oberfläche, Farben aus styles.css, Kürzen und Umbrechen von Text, Download.
 */
import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit'; // WOFF statt WOFF2: fontkit kann WOFF2 nicht als Teilmenge einbetten
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff?url';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff?url';

export const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
/** Farben aus styles.css */
export const C = {
  ink: hex('#0f1230'), muted: hex('#575c7a'), faint: hex('#98a2b3'), line: hex('#e4e8f0'), line2: hex('#eef1f6'),
  brand: hex('#4d4ae0'), brandL: hex('#edecfc'), head: hex('#f8f9fc'), ref: hex('#f9fafc'), titel: hex('#f6f8fc'),
  okL: hex('#e3f6ee'), ok: hex('#067a53'), okB: hex('#9ad9bf'), high: hex('#7c3aed'), highL: hex('#f3edff'), highB: hex('#c4b5fd'),
  warn: hex('#b76e00'), amber: hex('#f59e0b'), warnL: hex('#fff3dc'), blue: hex('#3b82f6'), neu: hex('#f8f5ff'), neuK: hex('#f1ebff'), neuT: hex('#6d28d9'),
  bedarf: hex('#f6f7fb'), white: rgb(1, 1, 1), bad: hex('#d92d20'),
};

/** A4 quer */
export const PW = 841.89, PH = 595.28, M = 30;
export const TOP = PH - 34, BOTTOM = 40;

export interface Fonts { r: PDFFont; m: PDFFont; s: PDFFont; b: PDFFont }

/** Neues Dokument mit eingebetteter Inter (400/500/600/700). */
export async function neuesPdf(): Promise<{ doc: PDFDocument; F: Fonts }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const load = async (u: string) => doc.embedFont(await (await fetch(u)).arrayBuffer(), { subset: true });
  const [r, m, s, b] = await Promise.all([inter400, inter500, inter600, inter700].map(load));
  doc.setCreator('Angebotsauswertung – Preisspiegel & Vergabeempfehlung');
  return { doc, F: { r, m, s, b } };
}

export const clean = (t: string) => (t ?? '').replace(/\s+/g, ' ').trim();

export function fit(t: string, f: PDFFont, size: number, w: number) {
  t = clean(t);
  if (f.widthOfTextAtSize(t, size) <= w) return t;
  while (t.length > 1 && f.widthOfTextAtSize(t + '…', size) > w) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

export function wrap(t: string, f: PDFFont, size: number, w: number, max = 99): string[] {
  const words = clean(t).split(' ').filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const wd of words) {
    const nx = cur ? cur + ' ' + wd : wd;
    if (f.widthOfTextAtSize(nx, size) <= w || !cur) cur = nx;
    else { out.push(cur); cur = wd; }
  }
  if (cur) out.push(cur);
  if (out.length > max) { const rest = out.slice(max - 1).join(' '); out.length = max - 1; out.push(fit(rest, f, size, w)); }
  return out.map((l) => fit(l, f, size, w));
}

/** PDF-Bytes als Datei herunterladen. */
export function downloadPdf(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[\\/:*?"<>|]+/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
