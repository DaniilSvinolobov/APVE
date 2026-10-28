import JSZip from 'jszip';

export interface RawFile { path: string; data: Uint8Array }

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;
export const base = (p: string) => p.split('/').pop() ?? p;
export const dir = (p: string) => p.split('/').slice(0, -1).join('/');

/** Obere Hälfte von Codepage 437 (Dateinamen aus „ZIP-komprimierter Ordner“ unter Windows, z. B. 0x84 = ä, 0xE1 = ß). */
const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/** Dateinamen im ZIP: UTF-8, sonst (ohne UTF-8-Kennung, ältere Windows-Packer) Codepage 437. */
export function decodeName(bytes: Uint8Array | string[]): string {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes, (c) => c.charCodeAt(0));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return Array.from(b, (c) => (c < 128 ? String.fromCharCode(c) : CP437[c - 128])).join(''); }
}

export async function expandZips(files: RawFile[], depth = 0): Promise<RawFile[]> {
  const out: RawFile[] = [];
  for (const f of files) {
    if (JUNK.test(f.path)) continue;
    if (/\.zip$/i.test(f.path) && depth < 3) {
      try {
        const z = await JSZip.loadAsync(f.data, { decodeFileName: (n) => decodeName(n as Uint8Array | string[]) });
        const entries = Object.values(z.files).filter((e) => !e.dir);
        const inner: RawFile[] = [];
        for (const e of entries) inner.push({ path: e.name, data: await e.async('uint8array') });
        const roots = new Set(inner.map((i) => i.path.split('/')[0]));
        const prefix = dir(f.path);
        const zipName = base(f.path).replace(/\.zip$/i, '');
        // ZIP-Name bleibt Teil des Pfads, wenn er die Runde bzw. Nachforderung kennzeichnet („Nachverhandlung.zip“ mit einem Ordner darin)
        const single = roots.size === 1 && inner.every((i) => i.path.includes('/')) && !/nachverh|nachforder/i.test(zipName);
        const mapped = inner.map((i) => ({ path: [prefix, single ? '' : zipName, i.path].filter(Boolean).join('/'), data: i.data }));
        out.push(...(await expandZips(mapped, depth + 1)));
        continue;
      } catch { /* kein gültiges Zip – als Datei behalten */ }
    }
    out.push(f);
  }
  return out;
}
