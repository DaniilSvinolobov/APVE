import { ozKey, type GaebDoc } from '../gaeb/gaeb';
import type { BidPos, Los, Offer, State } from '../domain/types';
import { fmtEur, round2, uid } from '../domain/fmt';
import { losPositions } from '../domain/calc';
import type { ParsedBid } from './analyze';
import { matchPositions, SICHER } from './ozMatch';

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
    .map((p) => ({ oz: p.oz, kurz: p.kurz, lang: p.lang ? p.lang.slice(0, 600) : undefined, menge: old.get(p.oz)?.menge ?? p.menge, mengeOrig: p.menge, einheit: p.einheit, bedarf: p.bedarf }));
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
  // bereits geladene Angebote gegen das neue LV neu zuordnen (nur wenn Lücken bestehen, damit Handeingaben nicht überschrieben werden)
  for (const o of d.offers) {
    o.warnungen = o.warnungen.filter((w) => !w.startsWith('Kein Soll-LV geladen'));
    if (!o.bidPos || !hatLuecken(d, o)) continue;
    zuordnen(d, o);
    o.lose = o.lose.filter((id) => d.lose.some((l) => l.id === id));
    if (!o.lose.length) o.lose = loseOf(d, o);
  }
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
  offer.bidPos = doc.positions.map((p) => ({ oz: p.oz, kurz: p.kurz, lang: (p.lang ?? '').slice(0, 600), menge: p.menge, einheit: p.einheit, bedarf: p.bedarf, ep: p.ep, gp: p.gp }));
  const gpSumme = round2(doc.positions.reduce((a, p) => a + (p.gp ?? 0), 0));
  offer.dateiSumme = doc.total.net || gpSumme || null;
  zuordnen(d, offer);
  offer.lose = loseOf(d, offer);
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

const ZUORD_WARN = /Ordnungszahl als das Soll-LV|geringer Übereinstimmung|im Soll-LV nicht vor|des Soll-LV sind in der Bieterdatei nicht bepreist|fehlen in der Wertung/;

const loseOf = (d: State, offer: Offer) => d.lose.filter((l) => losPositions(d, l).some((p) => (offer.prices[ozKey(p.oz)]?.ep ?? 0) !== 0)).map((l) => l.id);

/** Gibt es Bieterpreise ohne LV-Position oder LV-Positionen ohne Bieterpreis? */
function hatLuecken(d: State, offer: Offer) {
  const known = new Set(d.lv.map((p) => ozKey(p.oz)));
  return Object.keys(offer.prices).some((k) => !known.has(k)) || d.lv.some((p) => !p.bedarf && offer.prices[ozKey(p.oz)]?.ep == null);
}

/**
 * Bieterpreise dem Soll-LV zuordnen und die Hinweise dazu erzeugen. Kann jederzeit erneut laufen
 * (z. B. wenn das LV erst nach den Angeboten geladen wird): Ausgangspunkt sind die gespeicherten Bieterpositionen.
 */
export function zuordnen(d: State, offer: Offer) {
  const bid = offer.bidPos ?? [];
  offer.warnungen = offer.warnungen.filter((w) => !ZUORD_WARN.test(w));
  offer.ozZuordnung = undefined;
  offer.prices = Object.fromEntries(bid.map((p) => [ozKey(p.oz), { ep: p.ep, gp: p.gp }]));
  const zugeordnet = mapToLv(d, offer, bid);
  const known = new Set(d.lv.map((p) => ozKey(p.oz)));
  const extra = Object.keys(offer.prices).filter((k) => !known.has(k));
  const wert = (p: BidPos) => p.gp ?? (p.ep != null && p.menge != null ? round2(p.ep * p.menge) : 0);
  const toKey = new Map(zugeordnet.map((m) => [ozKey(m.bieter), ozKey(m.lv)]));
  const ungedeckt = round2(bid.filter((p) => !known.has(toKey.get(ozKey(p.oz)) ?? ozKey(p.oz))).reduce((a, p) => a + wert(p), 0));
  offer.ungedeckt = ungedeckt;
  if (extra.length) offer.warnungen.push(`${extra.length} Position(en) der Bieterdatei kommen im Soll-LV nicht vor (z. B. ${extra.slice(0, 3).join(', ')}) – auch nicht nach Textabgleich.`);
  if (ungedeckt > 0.005) offer.warnungen.push(`Bieterpositionen im Wert von ${fmtEur(ungedeckt)} (Summe laut Bieterdatei: ${fmtEur(offer.dateiSumme)}) ließen sich keiner LV-Position zuordnen und fehlen in der Wertung.`);
  const miss = d.lv.filter((p) => !p.bedarf && offer.prices[ozKey(p.oz)]?.ep == null);
  if (miss.length) offer.warnungen.push(`${miss.length} Position(en) des Soll-LV sind in der Bieterdatei nicht bepreist.`);
}

/**
 * Bieterpreise auf die OZ des Soll-LV umschreiben. Weicht die Nummerierung der Bieterdatei ab, wird
 * über Kurz-/Langtext, Einheit und Menge zugeordnet (siehe ozMatch.ts) und im Angebot vermerkt.
 */
function mapToLv(d: State, offer: Offer, bid: BidPos[]): { bieter: string; lv: string }[] {
  const matches = matchPositions(d.lv, bid).filter((m) => ozKey(m.bieter) !== ozKey(m.lv));
  if (!matches.length) return [];
  const to = new Map(matches.map((m) => [ozKey(m.bieter), ozKey(m.lv)]));
  const prices: Offer['prices'] = {};
  for (const [k, v] of Object.entries(offer.prices)) if (to.has(k)) prices[to.get(k)!] = v;
  // nicht zugeordnete Positionen behalten ihren Schlüssel, soweit er nicht schon durch eine Zuordnung belegt ist
  for (const [k, v] of Object.entries(offer.prices)) if (!to.has(k) && !(k in prices)) prices[k] = v;
  offer.prices = prices;
  offer.textErg = offer.textErg.map((t) => { const lvOz = d.lv.find((p) => ozKey(p.oz) === to.get(ozKey(t.oz)))?.oz; return lvOz ? { ...t, oz: lvOz } : t; });
  offer.ozZuordnung = matches.map((m) => ({ bieter: m.bieter, lv: m.lv, score: m.score }));
  const fmt = (m: { bieter: string; lv: string }) => `${m.bieter} → ${m.lv}`;
  // reine Schreibweise der OZ (führende Nullen) ist kein Hinweis wert; Zuordnung über Text/Menge schon
  const ueber = matches.filter((m) => m.art !== 'oz');
  if (ueber.length) offer.warnungen.push(`${ueber.length} Position(en) der Bieterdatei haben eine andere Ordnungszahl als das Soll-LV und wurden über Text bzw. Menge und Reihenfolge zugeordnet (z. B. ${ueber.slice(0, 3).map(fmt).join('; ')}).`);
  const unsicher = ueber.filter((m) => m.score < SICHER);
  if (unsicher.length) offer.warnungen.push(`Davon ${unsicher.length} mit geringer Übereinstimmung – bitte prüfen: ${unsicher.slice(0, 5).map(fmt).join('; ')}${unsicher.length > 5 ? ' …' : ''}.`);
  return matches;
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

