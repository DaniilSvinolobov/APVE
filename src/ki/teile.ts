import type { DocFile } from '../import/docStore';

/**
 * Große Dokumente für die KI-Prüfung zerlegen, damit jede Datei geprüft wird (Vercel begrenzt Anfragen auf 4,5 MB).
 * Läuft vollständig im Browser: PDFs werden seitenweise aufgeteilt (pdf-lib); eine einzelne Seite, die allein zu groß ist,
 * sowie zu große Fotos werden als JPEG neu gerechnet (Auflösung bleibt für Handschrift ausreichend).
 */
export interface Teil { datei: string; label: string; mime: string; data: Uint8Array; seiten: number }

export const MAX_TEIL = 2_800_000; // Rohgröße je Teil (Base64 + 33 % bleibt unter dem Vercel-Limit)
export const SEITEN_JE_TEIL = 20;

export async function zerlegen(d: DocFile): Promise<Teil[]> {
  if (d.mime !== 'application/pdf') {
    const data = d.data.length <= MAX_TEIL ? d.data : await bildVerkleinern(d.data, d.mime);
    return [{ datei: d.path, label: d.path, mime: data === d.data ? d.mime : 'image/jpeg', data, seiten: 1 }];
  }
  const { PDFDocument } = await import('pdf-lib');
  let src: Awaited<ReturnType<typeof PDFDocument.load>>;
  try { src = await PDFDocument.load(d.data, { ignoreEncryption: true }); }
  catch {
    // nicht zerlegbar (beschädigt o. Ä.): klein genug → unverändert, sonst Seiten als Bilder
    return d.data.length <= MAX_TEIL ? [{ datei: d.path, label: d.path, mime: d.mime, data: d.data, seiten: 1 }] : seitenAlsBilder(d, 1, Infinity);
  }
  const n = src.getPageCount();
  if (n <= SEITEN_JE_TEIL && d.data.length <= MAX_TEIL) return [{ datei: d.path, label: d.path, mime: d.mime, data: d.data, seiten: n }];

  const teile: Teil[] = [];
  const bereich = async (von: number, bis: number): Promise<void> => {
    const out = await PDFDocument.create();
    const pages = await out.copyPages(src, Array.from({ length: bis - von + 1 }, (_, i) => von - 1 + i));
    pages.forEach((p) => out.addPage(p));
    const data = await out.save();
    if (data.length <= MAX_TEIL) { teile.push({ datei: d.path, label: `${d.path} [Seiten ${von}–${bis} von ${n}]`, mime: d.mime, data, seiten: bis - von + 1 }); return; }
    if (von === bis) { teile.push(...(await seitenAlsBilder(d, von, bis, n))); return; }
    const mitte = Math.floor((von + bis) / 2);
    await bereich(von, mitte);
    await bereich(mitte + 1, bis);
  };
  for (let von = 1; von <= n; von += SEITEN_JE_TEIL) await bereich(von, Math.min(n, von + SEITEN_JE_TEIL - 1));
  return teile;
}

/** Seiten mit pdf.js rendern (für Einzelseiten, die als PDF zu groß sind). */
async function seitenAlsBilder(d: DocFile, von: number, bis: number, gesamt?: number): Promise<Teil[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: d.data.slice(), isEvalSupported: false }).promise;
  const n = gesamt ?? doc.numPages;
  const teile: Teil[] = [];
  for (let i = von; i <= Math.min(bis, doc.numPages); i++) {
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    const scale = 2200 / Math.max(vp1.width, vp1.height); // ca. 190 dpi bei A4 – genug für Handschrift
    const vp = page.getViewport({ scale });
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    const data = await canvasJpeg(canvas);
    teile.push({ datei: d.path, label: `${d.path} [Seite ${i} von ${n}, als Bild]`, mime: 'image/jpeg', data, seiten: 1 });
  }
  await doc.destroy();
  return teile;
}

async function bildVerkleinern(data: Uint8Array, mime: string): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([new Uint8Array(data)], { type: mime }));
  const f = Math.min(1, 2600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * f); canvas.height = Math.round(bmp.height * f);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvasJpeg(canvas);
}

/** JPEG mit abnehmender Qualität, bis es unter die Grenze passt. */
async function canvasJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && (blob.size <= MAX_TEIL || q === 0.4)) return new Uint8Array(await blob.arrayBuffer());
  }
  throw new Error('Seite konnte nicht umgewandelt werden.');
}
