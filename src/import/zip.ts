import JSZip from 'jszip';

export interface RawFile { path: string; data: Uint8Array }

const JUNK = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i;
export const base = (p: string) => p.split('/').pop() ?? p;
export const dir = (p: string) => p.split('/').slice(0, -1).join('/');

export async function expandZips(files: RawFile[], depth = 0): Promise<RawFile[]> {
  const out: RawFile[] = [];
  for (const f of files) {
    if (JUNK.test(f.path)) continue;
    if (/\.zip$/i.test(f.path) && depth < 3) {
      try {
        const z = await JSZip.loadAsync(f.data);
        const entries = Object.values(z.files).filter((e) => !e.dir);
        const inner: RawFile[] = [];
        for (const e of entries) inner.push({ path: e.name, data: await e.async('uint8array') });
        const roots = new Set(inner.map((i) => i.path.split('/')[0]));
        const prefix = dir(f.path);
        const zipName = base(f.path).replace(/\.zip$/i, '');
        const single = roots.size === 1 && inner.every((i) => i.path.includes('/'));
        const mapped = inner.map((i) => ({ path: [prefix, single ? '' : zipName, i.path].filter(Boolean).join('/'), data: i.data }));
        out.push(...(await expandZips(mapped, depth + 1)));
        continue;
      } catch { /* kein gültiges Zip – als Datei behalten */ }
    }
    out.push(f);
  }
  return out;
}
