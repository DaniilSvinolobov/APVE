import { useRef, useState } from 'react';
import type { Offer, State } from '../domain/types';
import { expandZips, base, type RawFile } from '../import/zip';
import { groupBids, isBidFile, isLvFile, kategorie } from '../import/files';
import { analyzeGroup, docFiles } from '../import/analyze';
import { addDateien, istNach, preisAbweichungen, preisdateiUebernehmen, removeDatei, setNachgereicht } from '../import/apply';
import { docStore, type DocFile } from '../import/docStore';
import { collect, fromInput } from '../components/DropZone';
import { Chip, Icon, Seg } from '../components/ui';

type Up = (fn: (d: State) => void) => void;

const heute = () => { const t = new Date(); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/** Nachgereichte Dokumente ohne eigene Kategorie gehen als „Nachforderung“ in die (optionale) Dokumentprüfung; Nachweise wie Meisterbrief bleiben ausgenommen. */
const docKat = (f: DocFile, nach: boolean): DocFile => (nach && f.kat === 'Sonstiges' ? { ...f, kat: 'Nachforderung' } : f);

/** Unterlagen eines Angebots: ansehen, entfernen, ergänzen und als nachgereicht kennzeichnen. */
export function OfferDateien({ o, up, onAdded }: { o: Offer; up: Up; onAdded: (offerId: string) => void }) {
  const [modus, setModus] = useState<'mit' | 'nach'>('nach');
  const [datum, setDatum] = useState(heute);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const upOffer = (fn: (d: State, x: Offer) => void) => up((d) => { const x = d.offers.find((y) => y.id === o.id); if (x) fn(d, x); });

  const add = async (raw: RawFile[]) => {
    setMsg(null);
    try {
      const files = (await expandZips(raw)).filter((f) => !/signaturbeleg|\.offerinfo/i.test(base(f.path)));
      const gaeb = files.filter((f) => isBidFile(f.path) || isLvFile(f.path));
      const docs = files.filter((f) => !gaeb.includes(f)).filter((f, i, a) => a.findIndex((x) => base(x.path) === base(f.path)) === i);
      const nach = modus === 'nach' ? datum : null;
      // GAEB-Preisdateien (x84, auch x83 mit Preisen) gehören zu diesem Angebot. Nachgereicht = Nachforderung, keine Nachverhandlung:
      // Die Preise des Angebots ändern sich dadurch nicht, sie liefern nur fehlende bzw. nur als PDF lesbare Preise.
      const bids = groupBids(gaeb).flatMap((g) => g.bids);
      const ohnePreise = gaeb.filter((f) => !bids.includes(f));
      const ablegen: RawFile[] = [];
      let preis = '';
      let warn = false;
      if (bids.length) {
        const p = analyzeGroup({ root: '', files: bids, bids }, 0);
        if (!p) { preis = `Preisdatei nicht lesbar (${bids.map((f) => base(f.path)).join(', ')}).`; warn = true; }
        else {
          const name = p.offer.quelle;
          const diff = o.preisQuelle === 'keine' ? [] : preisAbweichungen(o.bidPos, p.doc);
          const ersetzen = o.preisQuelle === 'keine' || (diff.length > 0 ? nach == null : o.preisQuelle === 'pdf');
          const texte: string[] = [];
          if (ersetzen) {
            up((d) => preisdateiUebernehmen(d, o.id, { ...p, offer: structuredClone(p.offer) }, nach));
            texte.push(o.preisQuelle === 'keine' ? `Preise aus „${name}“ übernommen${nach != null ? ' (nachgereicht) – bitte mit dem eingereichten Angebot abgleichen' : ''}.`
              : diff.length ? `Preise aus „${name}“ übernommen (mit dem Angebot eingereicht); abweichend von der bisherigen Preisquelle in ${diff.length} Position(en): ${diff.slice(0, 5).join(', ')}${diff.length > 5 ? ' …' : ''}.`
              : `„${name}“ stimmt mit den Preisen aus dem PDF überein – Preise jetzt aus der GAEB-Datei.`);
          }
          // jede weitere Preisdatei einzeln abgleichen (x84 und p84 können voneinander abweichen) und als Unterlage ablegen
          const ref = ersetzen ? p.doc.positions : o.bidPos;
          const weitere = ersetzen ? bids.filter((f) => base(f.path) !== name) : bids;
          ablegen.push(...weitere);
          const gleich: string[] = [];
          for (const f of weitere) {
            const n = base(f.path);
            let q: ReturnType<typeof analyzeGroup> = null;
            try { q = analyzeGroup({ root: '', files: [f], bids: [f] }, 0); } catch { /* unten gemeldet */ }
            if (!q) { texte.push(`„${n}“ konnte nicht gelesen werden.`); warn = true; continue; }
            const dq = preisAbweichungen(ref, q.doc);
            if (!dq.length) { gleich.push(`„${n}“`); continue; }
            warn = true;
            const text = `Nachgereichte Preisdatei „${n}“ weicht in ${dq.length} Position(en) ${ersetzen ? `von „${name}“` : 'vom eingereichten Angebot'} ab (${dq.slice(0, 5).join(', ')}${dq.length > 5 ? ' …' : ''}). Die Preise wurden nicht übernommen – maßgeblich bleibt das Angebot; Preisänderungen durch Nachreichung sind unzulässig (§ 15 Abs. 3 VOB/A).${o.preisQuelle === 'pdf' ? ' Falls die Preise aus dem PDF falsch gelesen wurden: Datei mit „mit dem Angebot“ erneut hinzufügen.' : ' Geänderte Preise aus einer Nachverhandlung bitte oben unter „Angebote der Bieter“ als neues Angebot einlesen.'}`;
            upOffer((_, x) => { x.warnungen = [...x.warnungen.filter((w) => !w.includes(`„${n}“`)), text]; });
            texte.push(text);
          }
          if (gleich.length) texte.push(`${gleich.join(', ')} ${gleich.length > 1 ? 'stimmen' : 'stimmt'} mit den Preisen des Angebots überein.`);
          preis = texte.join(' ');
        }
      }
      docs.push(...ablegen);
      if (docs.length) {
        upOffer((d, x) => addDateien(d, x, docs.map((f) => ({ name: base(f.path), kat: kategorie(f.path) })), nach));
        const neu = docFiles(docs, '').map((f) => docKat(f, nach != null));
        docStore.set(o.id, [...(docStore.get(o.id) ?? []).filter((x) => !neu.some((n) => n.name === x.name)), ...neu]);
        if (docs.some((f) => !ablegen.includes(f))) onAdded(o.id);
      }
      setMsg({ ok: (docs.length > 0 || !!preis) && !warn && !ohnePreise.length, text: [
        docs.length ? `${docs.length} Datei(en) ${nach != null ? 'als nachgereicht ' : ''}hinzugefügt.` : bids.length ? '' : 'Keine Unterlagen hinzugefügt.',
        preis,
        ohnePreise.length ? `${ohnePreise.map((f) => base(f.path)).join(', ')} ohne Preise (LV-Datei) – nicht übernommen.` : '',
      ].filter(Boolean).join(' ') });
    } catch (e) {
      setMsg({ ok: false, text: `Fehler beim Einlesen: ${(e as Error).message}` });
    }
  };

  const remove = (name: string) => {
    upOffer((d, x) => removeDatei(d, x, name));
    docStore.set(o.id, (docStore.get(o.id) ?? []).filter((x) => x.name !== name));
  };

  const markNach = (name: string, nach: string | null) => {
    upOffer((d, x) => setNachgereicht(d, x, name, nach));
    docStore.set(o.id, (docStore.get(o.id) ?? []).map((x) => (x.name === name ? docKat({ ...x, kat: kategorie(x.path) }, nach != null) : x)));
  };

  const anzNach = o.dateien.filter(istNach).length;
  const kats = Object.entries(o.dateien.reduce<Record<string, number>>((a, d) => ({ ...a, [d.kat]: (a[d.kat] ?? 0) + 1 }), {})).sort(([a], [b]) => Number(a === 'Sonstiges') - Number(b === 'Sonstiges'));

  return (
    <details className="det">
      <summary><span className="opt-l">Unterlagen</span> {o.dateien.length + (o.quelle ? 1 : 0)} Datei(en){anzNach > 0 && <> · <Chip kind="warn">{anzNach} nachgereicht</Chip></>}{kats.length > 0 && <span className="muted"> – {kats.map(([k, n]) => `${k}${n > 1 ? ` (${n})` : ''}`).join(' · ')}</span>}</summary>
      <ul className="filelist">
        {o.preisQuelle === 'keine'
          ? <li className="nach"><Icon name="alert" /><span className="fname">Keine Preisdatei</span><Chip kind="warn">Preise fehlen</Chip><span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>Ordner mit Preisdatei erneut einlesen</span></li>
          : <li><Icon name="file" /><span className="fname" title={o.quelle}>{o.quelle}</span><Chip kind="info">{o.preisQuelle === 'pdf' ? 'Preise (PDF)' : 'Preisdatei'}</Chip><span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>entfernen = Angebot entfernen</span></li>}
        {o.dateien.map((f) => {
          const n = istNach(f);
          return (
            <li key={f.name} className={n ? 'nach' : ''}>
              <Icon name="file" /><span className="fname" title={f.name}>{f.name}</span><Chip kind="info">{f.kat}</Chip>
              <label className="mini" title={f.kat === 'Nachforderung' ? 'Liegt im Ordner „Nachforderung“' : undefined}>
                <input type="checkbox" checked={n} disabled={f.kat === 'Nachforderung'} onChange={(e) => markNach(f.name, e.target.checked ? heute() : null)} /> nachgereicht
              </label>
              {n && <input type="date" className="pdate" value={f.nach ?? ''} onChange={(e) => markNach(f.name, e.target.value)} aria-label={`${f.name} nachgereicht am`} />}
              <button className="icon-btn" title="Datei entfernen" onClick={() => remove(f.name)}><Icon name="trash" /></button>
            </li>
          );
        })}
      </ul>
      <div className={`addfiles ${drag ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={async (e) => { e.preventDefault(); setDrag(false); add(await collect(e.dataTransfer)); }}>
        <Seg small value={modus} onChange={setModus} options={[{ value: 'nach', label: 'nachgereicht' }, { value: 'mit', label: 'mit dem Angebot' }]} />
        {modus === 'nach' && <label className="mini">am <input type="date" className="pdate" value={datum} onChange={(e) => setDatum(e.target.value)} /></label>}
        <button className="btn small" onClick={() => fileRef.current?.click()}><Icon name="plus" /> Dateien hinzufügen</button>
        <span className="muted" style={{ fontSize: 12 }}>oder hierher ziehen (auch ZIP)</span>
        <input ref={fileRef} type="file" hidden multiple onChange={async (e) => { if (e.target.files) add(await fromInput(e.target.files)); e.target.value = ''; }} />
      </div>
      {msg && <p className={msg.ok ? 'okbox' : 'warnbox slim'}><Icon name={msg.ok ? 'check' : 'alert'} /> {msg.text}</p>}
    </details>
  );
}
