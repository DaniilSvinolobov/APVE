import { ozKey, type GaebDoc } from '../gaeb/gaeb';
import type { Los, Offer, State } from '../domain/types';
import { uid } from '../domain/fmt';
import { losPositions } from '../domain/calc';
import type { ParsedBid } from './analyze';

const LOS_TITEL = /^\s*LOS\s*\d+/i;

/**
 * Lose aus den obersten Titeln des LV ableiten – aber nur, wenn das LV sie ausdrücklich
 * als „LOS …“ benennt. Sonst ist das gesamte LV ein einziges Los (oberste Titel sind dann
 * nur Gliederung), Los.oz ist dann leer und umfasst alle Positionen.
 */
export function losFromTitles(titles: Record<string, string>, name = ''): Los[] {
  const top = Object.entries(titles).filter(([k]) => !k.includes('.')).sort(([a], [b]) => a.localeCompare(b));
  if (!top.some(([, t]) => LOS_TITEL.test(t))) {
    return [{ id: uid(), oz: '', nr: 'LOS 1', name: titleCase(name.trim()), kosten: null, imVermerk: true, imBudget: true }];
  }
  return top
    .map(([oz, t]) => {
      const m = t.match(/^\s*(LOS\s*\d+)\s*[-–:]?\s*(.*)$/i);
      return { id: uid(), oz, nr: m ? m[1].replace(/\s+/, '').toUpperCase() : `LOS ${oz}`, name: titleCase(m ? m[2] || t : t), kosten: null, imVermerk: true, imBudget: true };
    });
}

const titleCase = (s: string) => {
  const t = s.trim();
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\bUnd\b/g, 'und');
};

/** Eigenes LV laden; `schaetz` (GAEB 82) liefert die LV-Schätzpreise je Position. */
export function applyLv(d: State, doc: GaebDoc, schaetz: GaebDoc | null = null, names = { lv: '', schaetz: '' }) {
  d.schaetz = {};
  for (const p of (schaetz ?? doc).positions) if (p.ep != null) d.schaetz[ozKey(p.oz)] = p.ep;
  d.lvInfo = { lv: names.lv, schaetz: Object.keys(d.schaetz).length ? (schaetz ? names.schaetz : names.lv) : '' };
  const old = new Map(d.lv.map((p) => [p.oz, p]));
  d.lv = doc.positions
    .filter((p) => p.menge != null || p.kurz)
    .map((p) => ({ oz: p.oz, kurz: p.kurz, menge: old.get(p.oz)?.menge ?? p.menge, mengeOrig: p.menge, einheit: p.einheit, bedarf: p.bedarf }));
  d.titles = doc.titles;
  const lose = losFromTitles(doc.titles, doc.projekt || doc.bezeichnung);
  if (lose.length === 1 && lose[0].oz === '') {
    // frühere Aufteilung nach obersten Titeln (00, 01, …) verwerfen
    d.lose = d.lose.filter((l) => l.oz === '' || !(l.oz in doc.titles));
  }
  for (const l of lose) {
    const ex = d.lose.find((x) => x.oz === l.oz);
    if (ex) { ex.name = ex.name || l.name; }
    else d.lose.push(l);
  }
  d.lose = d.lose.filter((l) => !l.oz || d.lv.some((p) => p.oz.startsWith(l.oz + '.')) || !lose.length);
  if (!d.project.titel && doc.bezeichnung) d.project.titel = doc.bezeichnung;
  if (!d.project.auftraggeber && doc.auftraggeber) d.project.auftraggeber = doc.auftraggeber;
}

/** Fügt ein analysiertes Angebot in den State ein. */
export function applyOffer(d: State, parsed: ParsedBid, sigFound = parsed.sig) {
  const { offer, doc } = parsed;
  if (!d.lv.length) {
    // Fallback: LV aus Bieterdatei ableiten (ohne Texte/Mengen aus der Ausschreibung)
    const pos = doc.positions.map((p) => ({
      oz: p.oz, kurz: p.kurz || '', menge: p.ep ? Math.round(((p.gp ?? 0) / p.ep) * 1000) / 1000 : (p.menge ?? null), mengeOrig: null as number | null, einheit: p.einheit, bedarf: false,
    }));
    d.lv = pos.map((p) => ({ ...p, mengeOrig: p.menge }));
    const titles: Record<string, string> = {};
    for (const p of doc.positions) { const s = p.oz.split('.'); for (let i = 1; i < s.length; i++) { const k = s.slice(0, i).join('.'); titles[k] = doc.titles[k] ?? ''; } }
    d.titles = { ...titles, ...doc.titles };
    for (const l of losFromTitles(Object.fromEntries(Object.entries(d.titles).filter(([k]) => !k.includes('.'))), doc.projekt || doc.bezeichnung)) if (!d.lose.some((x) => x.oz === l.oz)) d.lose.push({ ...l, name: l.name || `Los ${l.oz}` });
    offer.warnungen.push('Kein Soll-LV geladen – Positionen und Mengen aus der Bieterdatei abgeleitet. Bitte Ausschreibungs-LV (GAEB X83/P83/D83) laden.');
  }
  const known = new Set(d.lv.map((p) => ozKey(p.oz)));
  const extra = Object.keys(offer.prices).filter((k) => !known.has(k));
  if (extra.length) offer.warnungen.push(`${extra.length} Position(en) der Bieterdatei kommen im Soll-LV nicht vor (z. B. ${extra.slice(0, 3).join(', ')}).`);
  const miss = d.lv.filter((p) => !p.bedarf && offer.prices[ozKey(p.oz)]?.ep == null);
  if (miss.length) offer.warnungen.push(`${miss.length} Position(en) des Soll-LV sind in der Bieterdatei nicht bepreist.`);
  offer.lose = d.lose.filter((l) => losPositions(d, l).some((p) => (offer.prices[ozKey(p.oz)]?.ep ?? 0) !== 0)).map((l) => l.id);
  const preise = d.lv.every((p) => p.bedarf || (offer.prices[ozKey(p.oz)]?.ep ?? 0) !== 0 || !offer.lose.some((id) => { const l = d.lose.find((x) => x.id === id); return !!l && (!l.oz || p.oz.startsWith(l.oz + '.')); }));
  autoPruef(d, offer, sigFound, preise);
  const eroeff = d.project.eroeffnung.slice(0, 10);
  if (eroeff && offer.datum && offer.datum > eroeff && offer.runde === 1) offer.runde = 2;
  const dup = d.offers.filter((o) => o.firma.toLowerCase().replace(/\W/g, '') === offer.firma.toLowerCase().replace(/\W/g, ''));
  if (dup.length && offer.runde === 1) offer.runde = (Math.min(3, Math.max(...dup.map((o) => o.runde)) + 1)) as 2 | 3;
  if (d.offers.some((o) => o.nr === offer.nr)) offer.nr = Math.max(0, ...d.offers.map((o) => o.nr)) + 1;
  if (offer.nr === 0) offer.nr = 1;
  d.offers.push(offer);
  d.offers.sort((a, b) => a.nr - b.nr);
}



const SYN: Record<string, RegExp> = {
  '124': /eigenerkl|eignung/, '213': /angebotsschreiben/, '221': /zuschlagskalk/, '222': /endsumme/, '223': /aufgliederung/,
  '233': /nachunternehmer/, '234': /arbeitsgemeinschaft|bietergemeinschaft/, '235': /kapazit/, '248': /holzprodukt/,
};

/** Vollständigkeitsprüfung aus vorhandenen Dateien vorbelegen. */
function autoPruef(d: State, offer: Offer, sigFound: boolean, preise: boolean) {
  const names = offer.dateien.filter((x) => x.kat !== 'Nachforderung').map((x) => x.name.toLowerCase());
  const nach = offer.nachforderung.map((n) => n.toLowerCase());
  const matches = (label: string, list: string[]) => {
    const num = label.match(/\b(\d{3})\b/)?.[1];
    if (num) return list.some((n) => new RegExp(`(^|\\D)${num}(\\D|$)`).test(n) || (SYN[num]?.test(n) ?? false));
    const words = label.toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length >= 9);
    return words.length > 0 && list.some((n) => words.some((w) => n.includes(w)));
  };
  const set = (id: string, s: 'ok' | 'nach', date = '') => { offer.pruef[id] = { s, d: date, k: 'auto' }; };
  for (const u of d.unterlagen) {
    const l = u.label.toLowerCase();
    if (/unterschrieben|signiert/.test(l)) { if (sigFound) set(u.id, 'ok'); }
    else if (/preise vollständig|gaeb/.test(l)) {
      if (offer.preisQuelle === 'pdf') offer.pruef[u.id] = { s: 'pdf', d: '', n: 'Die GAEB-Datei des Bieters enthält keine Preise; das bepreiste LV liegt nur als PDF vor. Die Preise wurden aus dem PDF gelesen und sind zu prüfen.', k: 'auto' };
      else if (preise) set(u.id, 'ok');
    }
    else if (/fristgerecht/.test(l)) { /* nur manuell */ }
    else if (matches(u.label, nach)) set(u.id, 'nach');
    else if (matches(u.label, names)) set(u.id, 'ok');
  }
  // nachgereichte Unterlagen ohne passende Zeile → neue Prüfzeile
  for (const n of offer.nachforderung) {
    if (d.unterlagen.some((u) => matches(u.label, [n.toLowerCase()]))) continue;
    const label = n.replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const row = d.unterlagen.find((u) => u.label === label) ?? { id: uid(), label };
    if (!d.unterlagen.includes(row)) d.unterlagen.push(row);
    set(row.id, 'nach');
  }
}

