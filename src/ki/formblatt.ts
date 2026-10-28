/**
 * Strenge Zuordnung KI-Befund → Prüfzeile. Ein Formblatt belegt nur seine eigene Zeile: Das Angebotsschreiben (213)
 * nennt in seiner Anlagenliste 124, 221, 233 … – das belegt diese Formblätter nicht. Preise und Frist folgen aus dem
 * Import (GAEB-Datei, Eingang), nie aus der KI.
 */

/** Formblattnummern (VHB/VVB 1xx–3xx) in einem Text, z. B. „VVB 124 - …“, „GFMGALA 213 Angebotsschreiben.pdf“, „221 oder 222“. */
export function formNummern(text: string): string[] {
  const t = text.replace(/\.[a-z0-9]{2,4}$/i, ''); // Dateiendung
  const out = new Set<string>();
  for (const m of t.matchAll(/(?<![\d.,/-])([1-3]\d{2})(?![\d.,/]|-\d)/g)) out.add(m[1]);
  return [...out];
}

const SIG_ZEILE = /unterschrieben|signiert/i;
/** Zeilen, die nicht aus Dokumenten der KI folgen: Preise (GAEB-Import) und Frist (Eingang). */
export const KEINE_KI_ZEILE = /preise vollständig|gaeb|fristgerecht/i;

const woerter = (s: string) => s.toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length >= 6);

export interface KiZuordnung { datei: string; art: string; titel?: string }

/** Formblattnummern des Dokuments: laut Titel/Art im Dokument selbst; der Dateiname zählt nur, wenn der Inhalt keine nennt. */
export function dokNummern(k: KiZuordnung): string[] {
  const inhalt = formNummern(`${k.titel ?? ''} ${k.art}`);
  return inhalt.length ? inhalt : formNummern(k.datei.split('/').pop() ?? '');
}

/** Darf dieses Dokument die Prüfzeile belegen? */
export function zeileErlaubt(label: string, k: KiZuordnung): boolean {
  if (KEINE_KI_ZEILE.test(label)) return false;
  const dok = dokNummern(k);
  const art = `${k.titel ?? ''} ${k.art}`;
  // Unterschrift unter dem Angebot: nur das Angebotsschreiben selbst
  if (SIG_ZEILE.test(label)) return dok.includes('213') || (!dok.length && /angebotsschreiben/i.test(art));
  const soll = formNummern(label);
  if (soll.length) {
    if (dok.length) return dok.some((n) => soll.includes(n));
    // Dokument ohne Nummer: nur bei klar gleichem Titel (z. B. „Eigenerklärung zur Eignung“)
    const w = woerter(label.replace(/^\D*\d{3}\s*[-–:]?\s*/, ''));
    const a = woerter(art);
    return w.length > 0 && w.filter((x) => a.some((y) => y.startsWith(x.slice(0, 6)))).length * 3 >= w.length * 2;
  }
  // eigene Zeile ohne Formblattnummer (z. B. „Referenzliste“): ein nummeriertes Formblatt gehört nicht dazu
  return !dok.length;
}

/** Zeilen-IDs eines Befunds, die die strenge Zuordnung bestehen. */
export function erlaubteZeilen(zeilen: string[] | undefined, unterlagen: { id: string; label: string }[], k: KiZuordnung): string[] {
  return (zeilen ?? []).filter((id) => { const u = unterlagen.find((x) => x.id === id); return !!u && zeileErlaubt(u.label, k); });
}

/** Widerspruch zwischen Dateiname und Inhalt (z. B. Datei „VVB 124 …“ enthält Formblatt 221)? */
export function nameWiderspruch(k: KiZuordnung): string {
  const name = formNummern(k.datei.split('/').pop() ?? '');
  const inhalt = formNummern(`${k.titel ?? ''} ${k.art}`);
  if (!name.length || !inhalt.length || name.some((n) => inhalt.includes(n))) return '';
  return `Dateiname nennt Formblatt ${name.join('/')}, das Dokument ist aber Formblatt ${inhalt.join('/')}.`;
}
