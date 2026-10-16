import { useRef, useState } from 'react';
import type { RawFile } from '../import/zip';
import { Icon } from './ui';

async function readEntry(entry: FileSystemEntry, path: string, out: RawFile[]) {
  if (entry.isFile) {
    const f: File = await new Promise((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ path: path + f.name, data: new Uint8Array(await f.arrayBuffer()) });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const e of batch) await readEntry(e, `${path}${entry.name}/`, out);
    } while (batch.length);
  }
}

async function collect(dt: DataTransfer): Promise<RawFile[]> {
  const out: RawFile[] = [];
  const entries = Array.from(dt.items).map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (entries.length) { for (const e of entries) await readEntry(e, '', out); return out; }
  for (const f of Array.from(dt.files)) out.push({ path: f.name, data: new Uint8Array(await f.arrayBuffer()) });
  return out;
}
async function fromInput(list: FileList): Promise<RawFile[]> {
  const out: RawFile[] = [];
  for (const f of Array.from(list)) out.push({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, data: new Uint8Array(await f.arrayBuffer()) });
  return out;
}

export function DropZone({ busy, onFiles, title, hint, folder }: { busy: boolean; onFiles: (f: RawFile[]) => void; title: string; hint: string; folder: boolean }) {
  const [drag, setDrag] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`drop ${drag ? 'over' : ''} ${busy ? 'busy' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={async (e) => { e.preventDefault(); setDrag(false); onFiles(await collect(e.dataTransfer)); }}
    >
      <Icon name="upload" />
      <b>{busy ? 'Wird eingelesen …' : title}</b>
      <span className="muted">{hint}</span>
      <div className="row">
        {folder && <button className="btn" onClick={() => folderRef.current?.click()}><Icon name="folder" /> Ordner wählen</button>}
        <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="file" /> Dateien / ZIP wählen</button>
      </div>
      {folder && <input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: '' } as object)} onChange={async (e) => { if (e.target.files) onFiles(await fromInput(e.target.files)); e.target.value = ''; }} />}
      <input ref={fileRef} type="file" hidden multiple onChange={async (e) => { if (e.target.files) onFiles(await fromInput(e.target.files)); e.target.value = ''; }} />
    </div>
  );
}
