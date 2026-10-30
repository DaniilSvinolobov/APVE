/** Originaldateien der Angebote (für die KI-Dokumentprüfung und die Dateilisten), je Angebot. */
export interface DocFile { name: string; path: string; data: Uint8Array; mime: string; kat: string }

/** Wird bei jeder Änderung aufgerufen (files = null: Angebot entfernt bzw. alles geleert); App.tsx hängt hier den Projektspeicher an. */
type Sink = (offerId: string | null, files: DocFile[] | null) => void;

class DocStore extends Map<string, DocFile[]> {
  sink: Sink | null = null;
  override set(offerId: string, files: DocFile[]) { super.set(offerId, files); this.sink?.(offerId, files); return this; }
  override delete(offerId: string) { const r = super.delete(offerId); this.sink?.(offerId, null); return r; }
  override clear() { super.clear(); this.sink?.(null, null); }
  /** Beim Öffnen eines Projekts: Inhalt ersetzen, ohne den Speicher zu benachrichtigen. */
  laden(eintraege: Map<string, DocFile[]>) { super.clear(); eintraege.forEach((f, id) => super.set(id, f)); }
}
export const docStore = new DocStore();
