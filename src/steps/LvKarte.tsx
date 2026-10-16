import { useRef, useState } from 'react';
import type { State } from '../domain/types';
import { expandZips, type RawFile } from '../import/zip';
import { findLvFiles, isBidFile } from '../import/files';
import { applyLv } from '../import/apply';
import { schaetzSumme } from '../domain/calc';
import { fmtEur } from '../domain/fmt';
import { Chip, Icon } from '../components/ui';
import { DropZone } from '../components/DropZone';

type Up = (fn: (d: State) => void) => void;

/** Eigenes LV (GAEB 81/82/83) laden – legt Lose, Maßnahme und Auftraggeber an. */
export function LvKarte({ s, up }: { s: State; up: Up }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sRef = useRef(s);
  sRef.current = s;

  const process = async (raw: RawFile[]) => {
    setBusy(true); setMsg(null);
    try {
      const files = await expandZips(raw);
      const { soll, sollName, schaetz, schaetzName, pricedSkipped } = findLvFiles(files);
      if (!soll) {
        const bids = pricedSkipped.length > 0 || files.some((f) => isBidFile(f.path));
        setMsg({ ok: false, text: pricedSkipped.length ? `„${pricedSkipped.join('“, „')}“ enthält Bieterpreise und ist damit ein Angebot, kein LV – bitte im Schritt „Unterlagen“ unter „Angebote der Bieter“ ablegen.` : bids ? 'Das sind Angebotsdateien (x84/p84/d84) – bitte im Schritt „Unterlagen“ unter „Angebote der Bieter“ ablegen.' : 'Kein LV erkannt. Erwartet: .x81/.x82/.x83 (GAEB DA XML), .p8x (GAEB 2000) oder .d8x (GAEB 90).' });
      } else {
        up((d) => applyLv(d, soll, schaetz, { lv: sollName, schaetz: schaetzName }));
        const n = schaetz ? schaetz.positions.filter((p) => p.ep != null).length : 0;
        setMsg({ ok: true, text: [`LV geladen: ${soll.positions.length} Positionen (${sollName})`, n ? `LV-Schätzpreise: ${n} Positionen (${schaetzName})` : 'keine Schätzpreise (GAEB 82) gefunden', pricedSkipped.length ? `Übersprungen (enthält Bieterpreise, gehört zu den Angeboten): ${pricedSkipped.join(', ')}` : '', sRef.current.offers.length ? 'Bereits geladene Angebote werden automatisch neu verglichen.' : ''].filter(Boolean).join(' · ') });
      }
    } catch (e) {
      setMsg({ ok: false, text: `Fehler beim Einlesen: ${(e as Error).message}` });
    }
    setBusy(false);
  };

  const hasLv = s.lv.length > 0;
  const hasSchaetz = Object.keys(s.schaetz ?? {}).length > 0;
  const schaetzGesamt = s.lose.reduce((a, l) => a + (schaetzSumme(s, l) ?? 0), 0);

  return (
    <section className="card" id="lv-card">
      <h2>Eigenes LV (Ausschreibung)</h2>
      <p className="lead">Ihr Leistungsverzeichnis als GAEB-Datei: <b>X81/X83</b> liefert Positionen und Mengen, <b>X82</b> (Kostenanschlag) die LV-Schätzpreise für den Preisvergleich und den Kostenvoranschlag je Los. Eine oder mehrere Dateien oder eine ZIP – die App erkennt die Rolle selbst. Maßnahme, Auftraggeber und Lose werden daraus vorbelegt.</p>
      <DropZone busy={busy} onFiles={process} title="LV-Dateien hierher ziehen (X81 · X82 · X83)" hint="Auch .p8x (GAEB 2000) und .d8x (GAEB 90) · Daten verlassen Ihren Browser nicht" folder={false} />
      {msg && <p className={msg.ok ? 'okbox' : 'warnbox'}><Icon name={msg.ok ? 'check' : 'alert'} /> {msg.text}</p>}
      <div className="status">
        <Chip kind={hasLv ? 'ok' : 'warn'}>{hasLv ? `LV: ${s.lv.length} Positionen, ${s.lose.length} Los/Lose${s.lvInfo?.lv ? ` (${s.lvInfo.lv})` : ''}` : 'LV fehlt'}</Chip>
        <Chip kind={hasSchaetz ? 'ok' : 'info'}>{hasSchaetz ? `LV-Schätzpreise: ${Object.keys(s.schaetz).length} Positionen · ${fmtEur(schaetzGesamt)} netto` : 'keine LV-Schätzpreise (X82)'}</Chip>
        {hasLv && s.lv.some((p) => p.menge !== p.mengeOrig) && <Chip kind="info">{s.lv.filter((p) => p.menge !== p.mengeOrig).length} Menge(n) im LV angepasst</Chip>}
      </div>
    </section>
  );
}
