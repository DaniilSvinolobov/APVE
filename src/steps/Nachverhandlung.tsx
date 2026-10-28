import { useRef, useState } from 'react';
import type { Offer, State } from '../domain/types';
import { kette, vorRunde } from '../domain/runden';
import { fmtNum } from '../domain/fmt';
import { ozKey } from '../gaeb/gaeb';
import { expandZips, base, type RawFile } from '../import/zip';
import { groupBids, isLvFile } from '../import/files';
import { analyzeGroup } from '../import/analyze';
import { nachverhandlungAnfuegen, preiseAlsDoc, summenCheck } from '../import/apply';
import { pdfSummenCheck } from '../import/pdfSumme';
import { docStore } from '../import/docStore';
import { collect, fromInput } from '../components/DropZone';
import { Chip, Icon } from '../components/ui';

type Up = (fn: (d: State) => void) => void;

/** Bezeichnung einer Runde wie im Preisspiegel: Runde 2 = „Nachverhandlung“, Runde 3 = „Nachverhandlung 2“. */
export const rundeName = (r: number) => (r <= 1 ? 'Hauptangebot' : `Nachverhandlung${r > 2 ? ' ' + (r - 1) : ''}`);

/**
 * Nachverhandlung zu einem Hauptangebot einlesen (Preisdatei, Schreiben, Nachlass … – auch als Ordner/ZIP).
 * Es entsteht ein eigenes, verknüpftes Angebot der nächsten Runde; die Unterlagen des Hauptangebots bleiben unverändert.
 * Ohne Preisdatei gelten die Einheitspreise der vorigen Runde als bestätigt (z. B. reines Nachlassschreiben).
 */
export function NvEinlesen({ s, o, up }: { s: State; o: Offer; up: Up }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = async (raw: RawFile[]) => {
    setMsg(null);
    try {
      const alle = await expandZips(raw);
      if (!alle.length) return;
      const bids = groupBids(alle).flatMap((g) => g.bids);
      // beigelegte Kopien des Ausschreibungs-LV (ohne Preise) gehören nicht zu den Unterlagen
      const files = alle.filter((f) => !isLvFile(f.path) || bids.includes(f));
      const g = { root: '', files, bids };
      const vorher = kette(s, o).pop()!;
      const p = bids.length
        ? analyzeGroup(g, 0)
        : analyzeGroup(g, 0, undefined, { doc: preiseAlsDoc(vorher), quelle: '', hinweis: '', art: 'vorrunde' });
      if (!p) { setMsg({ ok: false, text: `Preisdatei nicht lesbar (${bids.map((f) => base(f.path)).join(', ')}).` }); return; }
      if (bids.length) { const ck = summenCheck(p.doc); p.offer.check = { ...ck, pdf: await pdfSummenCheck(files, ck.gaeb ?? ck.positionen) }; }
      docStore.set(p.offer.id, p.docs);
      up((d) => nachverhandlungAnfuegen(d, o.id, p));
      setMsg({ ok: true, text: `${rundeName(vorher.runde + 1)} eingelesen: ${bids.length ? `Preise aus „${p.offer.quelle}“` : 'ohne Preisdatei (Preise der vorigen Runde)'}${p.offer.dateien.length ? `, ${p.offer.dateien.length} weitere Datei(en)` : ''}. Die Unterlagen des Hauptangebots bleiben unverändert.` });
    } catch (e) {
      setMsg({ ok: false, text: `Fehler beim Einlesen: ${(e as Error).message}` });
    }
  };

  return (
    <>
      <div className={`nv-add ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={async (e) => { e.preventDefault(); setDrag(false); add(await collect(e.dataTransfer)); }}>
        <button className="link" title="Preisdatei und Schreiben der Nachverhandlung wählen oder hierher ziehen (auch Ordner/ZIP). Wird als eigene Runde geführt – das Hauptangebot bleibt unverändert." onClick={() => fileRef.current?.click()}><Icon name="plus" /> Nachverhandlung einlesen</button>
        <input ref={fileRef} type="file" hidden multiple onChange={async (e) => { if (e.target.files) add(await fromInput(e.target.files)); e.target.value = ''; }} />
      </div>
      {msg && <p className={msg.ok ? 'okbox' : 'warnbox slim'}><Icon name={msg.ok ? 'check' : 'alert'} /> {msg.text}</p>}
    </>
  );
}

/** Was sich gegenüber der vorigen Runde desselben Bieters geändert hat (Einheitspreise, Nachlass). */
export function NvAenderung({ s, o }: { s: State; o: Offer }) {
  const vor = vorRunde(s, o);
  if (!vor) return null;
  const geaendert = s.lv.filter((p) => { const k = ozKey(p.oz), a = o.prices[k]?.ep, b = vor.prices[k]?.ep; return a != null && b != null && Math.abs(a - b) > 0.005; });
  const nl = (o.nachlass ?? 0) !== (vor.nachlass ?? 0);
  // ohne Änderung an Preisen und Nachlass bringt die Runde nichts Neues – Hinweis, den Nachlass einzutragen
  const nichts = !geaendert.length && !nl;
  return (
    <>
      <Chip kind={nichts ? 'warn' : 'info'}>
        {geaendert.length ? `${geaendert.length} Einheitspreis(e) geändert ggü. Nr. ${vor.nr}` : `Einheitspreise wie Nr. ${vor.nr}`}
        {nl ? ` · Nachlass ${fmtNum(vor.nachlass ?? 0)} % → ${fmtNum(o.nachlass ?? 0)} %` : nichts ? ' – Nachlass eintragen?' : ''}
      </Chip>
      {geaendert.length > 0 && <span className="muted" title={geaendert.map((p) => p.oz).join(', ')}>Pos. {geaendert.slice(0, 6).map((p) => p.oz).join(', ')}{geaendert.length > 6 ? ' …' : ''}</span>}
    </>
  );
}
