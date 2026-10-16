/** Text aus PDF lesen (pdf.js läuft lokal im Browser, wird erst bei Bedarf nachgeladen; es gehen keine Daten nach außen). */

interface TextItem { str: string; transform: number[] }

/** Textzeilen eines PDF in Lesereihenfolge (Seite für Seite, oben nach unten, links nach rechts). */
export async function pdfLines(data: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  const doc = await pdfjs.getDocument({ data: data.slice(), isEvalSupported: false }).promise;
  const lines: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const items = ((await page.getTextContent()).items as unknown as Partial<TextItem>[])
      .filter((i): i is TextItem => typeof i.str === 'string' && Array.isArray(i.transform) && i.str.trim() !== '');
    items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
    let row: TextItem[] = [];
    const flush = () => { if (row.length) lines.push(row.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str.trim()).join(' ')); row = []; };
    for (const it of items) {
      if (row.length && Math.abs(row[0].transform[5] - it.transform[5]) > 3) flush();
      row.push(it);
    }
    flush();
  }
  await doc.destroy();
  return lines;
}
