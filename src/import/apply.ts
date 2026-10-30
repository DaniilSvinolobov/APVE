import { ozKey, type GaebDoc } from '../gaeb/gaeb';
import type { BidPos, Los, LvBefund, LvPos, Offer, State, ZusatzPos } from '../domain/types';
import { fmtEur, round2, uid } from '../domain/fmt';
import { bieterPq, losPositions, unterlageZeile, zusatzWert } from '../domain/calc';
import { gleicherBieter, kette, naechsteRunde } from '../domain/runden';
import { nachName, type ParsedBid } from './analyze';
import { matchPositions, SICHER } from './ozMatch';
import { applyKopf, kopfAusDoc, kopfMerge } from './kopfdaten';

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

/**
 * LV-Schätzpreise (EP) auf die OZ des Soll-LV legen. Die X82 stammt oft aus einem anderen Export als die X83
 * (andere OZ-Nullauffüllung, GAEB 90 ↔ XML) – Zuordnung daher wie bei den Bietern über OZ, sonst Text/Menge.
 */
export function schaetzPreise(lv: LvPos[], src: GaebDoc): Record<string, number> {
  const priced = src.positions.filter((p) => p.ep != null);
  const out: Record<string, number> = {};
  if (!priced.length) return out;
  const to = new Map(matchPositions(lv, priced).map((m) => [ozKey(m.bieter), ozKey(m.lv)]));
  for (const p of priced) { const k = to.get(ozKey(p.oz)); if (k && !(k in out)) out[k] = p.ep!; }
  return out;
}

const titleCase = (s: string) => {
  const t = s.trim();
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s/-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()).replace(/\bUnd\b/g, 'und');
};

/** Eigenes LV laden; `schaetz` (GAEB 82) liefert die LV-Schätzpreise je Position. */
export function applyLv(d: State, doc: GaebDoc, schaetz: GaebDoc | null = null, names = { lv: '', schaetz: '' }) {
  const old = new Map(d.lv.map((p) => [p.oz, p]));
  d.lv = doc.positions
    .filter((p) => p.menge != null || p.kurz)
    .map((p) => ({ oz: p.oz, kurz: p.kurz, lang: p.lang ? p.lang.slice(0, 600) : undefined, menge: old.get(p.oz)?.menge ?? p.menge, mengeOrig: p.menge, einheit: p.einheit, bedarf: p.bedarf }));
  const alt = { preise: d.schaetz ?? {}, name: d.lvInfo?.schaetz ?? '', lv: d.lvInfo?.lv ?? '' };
  d.schaetz = schaetzPreise(d.lv, schaetz ?? doc);
  let schaetzName = schaetz ? names.schaetz : names.lv;
  if (!schaetz && !Object.keys(d.schaetz).length && alt.name && alt.name !== alt.lv) {
    // neues LV ohne Preise: Schätzpreise aus der bereits geladenen X82 behalten, soweit die Positionen noch existieren
    const keys = new Set(d.lv.map((p) => ozKey(p.oz)));
    d.schaetz = Object.fromEntries(Object.entries(alt.preise).filter(([k]) => keys.has(k)));
    schaetzName = alt.name;
  }
  d.lvInfo = { ...d.lvInfo, lv: names.lv, schaetz: Object.keys(d.schaetz).length ? schaetzName : '' };
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
  // Maßnahme, Auftraggeber, Vergabenummer, Termine … aus dem Kopf der Datei und den Vorbemerkungen (nur leere Felder)
  applyKopf(d.project, kopfMerge(kopfAusDoc(doc), schaetz ? kopfAusDoc(schaetz) : {}));
}

/** Endsumme laut GAEB-Datei (Kopfsumme, sonst Summe der Titelsummen) und Summe der Positionen. */
export function summenCheck(doc: GaebDoc): { gaeb: number | null; positionen: number } {
  const titelSumme = round2(Object.entries(doc.totals).filter(([k]) => !k.includes('.')).reduce((a, [, v]) => a + v, 0));
  return { gaeb: doc.total.net || titelSumme || null, positionen: round2(doc.positions.reduce((a, p) => a + (p.gp ?? 0), 0)) };
}

/** Fügt ein analysiertes Angebot in den State ein; `ersetzt`: liefert die Preise dieses vorhandenen Angebots (`nach` = Preisdatei nachgereicht am). */
export function applyOffer(d: State, parsed: ParsedBid, sigFound = parsed.sig, ersetzt?: { alt: Offer; nach: string | null }) {
  const { offer, doc } = parsed;
  if (!d.lv.length && doc.positions.length) {
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
  offer.check = offer.preisQuelle === 'keine' || !offer.quelle ? undefined : { ...summenCheck(doc), pdf: offer.check?.pdf };
  zuordnen(d, offer);
  offer.lose = loseOf(d, offer);
  const preise = d.lv.every((p) => p.bedarf || (offer.prices[ozKey(p.oz)]?.ep ?? 0) !== 0 || !offer.lose.some((id) => { const l = d.lose.find((x) => x.id === id); return !!l && (!l.oz || p.oz.startsWith(l.oz + '.')); }));
  if (!ersetzt) verknuepfen(d, offer, doc);
  // Vollständigkeitsprüfung nur für Hauptangebote – die Unterlagen einer Nachverhandlung ergänzen das Hauptangebot, sie ersetzen es nicht
  if (!offer.basis && !ersetzt?.alt.basis) autoPruef(d, offer, sigFound, preise);
  if (ersetzt) uebernehmen(d, offer, ersetzt.alt, ersetzt.nach, true);
  else if (!offer.basis && offer.runde === 1) ersetzeOhnePreise(d, offer);
  if (!offer.nr || d.offers.some((o) => o.nr === offer.nr)) offer.nr = Math.max(0, ...d.offers.map((o) => o.nr)) + 1;
  d.offers.push(offer);
  d.offers.sort((a, b) => a.nr - b.nr);
}

/**
 * Nachverhandlung erkennen und mit dem Hauptangebot desselben Bieters verknüpfen. Anzeichen: Ordner/Datei „Nachverhandlung“
 * (runde > 1), vorgegebenes Hauptangebot (`basis`), Angebotsdatum nach der Eröffnung oder ein bereits eingelesenes
 * Angebot desselben Bieters (außer einem Platzhalter ohne Preise – den ersetzt das neue Angebot, siehe ersetzeOhnePreise).
 * Das Hauptangebot und seine Unterlagen bleiben unverändert.
 */
function verknuepfen(d: State, offer: Offer, doc: GaebDoc) {
  const haupt = offer.basis ? d.offers.find((o) => o.id === offer.basis) : d.offers.find((o) => !o.basis && o !== offer && gleicherBieter(o.firma, offer.firma));
  const eroeff = d.project.eroeffnung.slice(0, 10);
  const spaet = !!eroeff && !!offer.datum && offer.datum > eroeff;
  const ausdruecklich = offer.runde > 1 || !!offer.basis || spaet;
  if (!(ausdruecklich || (haupt && haupt.preisQuelle !== 'keine'))) return;
  const warn = (t: string) => { if (!offer.warnungen.includes(t)) offer.warnungen.push(t); };
  if (!haupt) {
    // spät eingegangen, aber kein Angebot dieses Bieters vorhanden: ein (ggf. verspätetes) Hauptangebot, keine Nachverhandlung
    delete offer.basis;
    if (offer.runde > 1) warn('Als Nachverhandlung erkannt, aber kein Hauptangebot dieses Bieters gefunden – bitte unten zuordnen oder als Hauptangebot führen.');
    return;
  }
  const vorher = kette(d, haupt).pop()!;
  offer.basis = haupt.id;
  offer.runde = naechsteRunde(d, haupt);
  offer.firma = haupt.firma;
  if (!offer.ort) offer.ort = haupt.ort;
  // gleiche Preise zeigt die Karte ohnehin an; nur ohne Hinweis auf eine Nachverhandlung könnte es ein doppeltes Einlesen sein
  if (!ausdruecklich && offer.quelle && vorher.bidPos?.length && !preisAbweichungen(vorher.bidPos, doc).length)
    warn(`Die Einheitspreise sind identisch mit Angebot Nr. ${vorher.nr}. Falls versehentlich doppelt eingelesen: diese Nachverhandlung entfernen.`);
}

/**
 * Wird für einen Bieter, der bisher ohne Preise angelegt war, die Preisdatei nachgereicht (Ordner erneut eingelesen),
 * ersetzt das neue Angebot den Platzhalter: Nummer, Runde, Eingaben von Hand und Markierungen „nachgereicht“ bleiben.
 */
function ersetzeOhnePreise(d: State, offer: Offer) {
  const alt = d.offers.find((o) => o.preisQuelle === 'keine' && !o.basis && o !== offer && gleicherBieter(o.firma, offer.firma));
  if (!alt) return;
  uebernehmen(d, offer, alt, '', false);
}

const PREIS_ZEILE = /preise vollständig|gaeb/;
const GAEB_KAT = 'Preisdatei (GAEB)';

/**
 * Das neue Angebot tritt an die Stelle von `alt`: Nummer, Runde, Eingaben von Hand und Markierungen „nachgereicht“ bleiben.
 * `nach` ≠ null = Preisdatei nachgereicht am ('' = unbekannt); `gleich` = auch Kennung, Datum, Nachlass usw. bleiben
 * (Preisdatei direkt beim Angebot ergänzt), die automatisch vorbelegte Vollständigkeitsprüfung außer der Preiszeile ebenfalls.
 */
function uebernehmen(d: State, offer: Offer, alt: Offer, nach: string | null, gleich: boolean) {
  d.offers.splice(d.offers.indexOf(alt), 1);
  offer.nr = alt.nr;
  offer.runde = alt.runde;
  if (alt.basis) offer.basis = alt.basis; else delete offer.basis;
  if (alt.ort && (gleich || !offer.ort)) offer.ort = alt.ort;
  if (gleich) {
    Object.assign(offer, { id: alt.id, firma: alt.firma, datum: alt.datum || offer.datum, nachlass: alt.nachlass, nachlassLose: alt.nachlassLose, skonto: alt.skonto, status: alt.status, statusGrund: alt.statusGrund, nebenangebot: alt.nebenangebot, kiDocs: alt.kiDocs, eignung: alt.eignung });
    if (offer.check && alt.check?.pdf) offer.check = { ...offer.check, pdf: alt.check.pdf };
    offer.warnungen = [...offer.warnungen, ...alt.warnungen.filter((w) => !ZUORD_WARN.test(w) && !/Keine auswertbaren Preise|GAEB-Datei des Bieters enthält keine Preise|aus dem PDF|Kein Soll-LV/.test(w) && !offer.warnungen.includes(w))];
  }
  const preisZeile = (id: string) => PREIS_ZEILE.test(d.unterlagen.find((u) => u.id === id)?.label.toLowerCase() ?? '');
  for (const [id, p] of Object.entries(alt.pruef)) if (p.k !== 'auto' || (gleich && !preisZeile(id))) offer.pruef[id] = p;
  if (nach != null) for (const u of d.unterlagen) {
    if (PREIS_ZEILE.test(u.label.toLowerCase()) && alt.pruef[u.id]?.k !== 'user') offer.pruef[u.id] = { s: 'nach', d: nach, n: alt.preisQuelle === 'pdf' ? 'Die GAEB-Preisdatei wurde nachgereicht; ihre Preise stimmen mit dem bepreisten LV (PDF) des Angebots überein.' : 'Die Preisdatei wurde nachgereicht (Angebot zunächst ohne lesbare Preise eingelesen). Bitte mit dem eingereichten Angebot abgleichen: Durch die Nachreichung dürfen sich die Preise nicht ändern (§ 15 Abs. 3 VOB/A); fehlende Preisangaben dürfen nur in engen Grenzen nachgefordert werden (§ 16a VOB/A).', k: 'auto' };
  }
  for (const f of alt.dateien) {
    const neu = offer.dateien.find((x) => x.name === f.name);
    if (!neu) offer.dateien.push(f);
    else if (f.nach != null && neu.nach == null) neu.nach = f.nach;
  }
  offer.nachforderung = [...new Set([...offer.nachforderung, ...alt.nachforderung])];
  pruefNachDateien(d, offer);
}

/** Positionen (OZ der Bieterdatei), deren Einheitspreis von `ref` (gespeicherte Bieterpositionen) abweicht oder die nur in einer der beiden vorkommen. */
export function preisAbweichungen(ref: { oz: string; ep: number | null }[] | undefined, doc: GaebDoc): string[] {
  const alt = new Map((ref ?? []).map((p) => [ozKey(p.oz), p.ep]));
  const neu = new Set(doc.positions.map((p) => ozKey(p.oz)));
  const diff = doc.positions.filter((p) => !alt.has(ozKey(p.oz)) || Math.abs((alt.get(ozKey(p.oz)) ?? 0) - (p.ep ?? 0)) > 0.005).map((p) => p.oz);
  return [...diff, ...(ref ?? []).filter((p) => !neu.has(ozKey(p.oz))).map((p) => p.oz)];
}

/**
 * GAEB-Preisdatei, die bei einem Angebot unter „Unterlagen“ ergänzt wird und dessen Preise liefert
 * (bisher ohne GAEB-Preise oder mit dem Angebot eingereicht). `nach` = nachgereicht am, null = mit dem Angebot.
 * Eine Nachreichung ändert das Angebot nicht – Abweichungen werden vorher in der Oberfläche geprüft.
 */
export function preisdateiUebernehmen(d: State, altId: string, parsed: ParsedBid, nach: string | null) {
  const alt = d.offers.find((o) => o.id === altId);
  if (!alt) return;
  parsed.offer.firma = alt.firma;
  if (alt.ort) parsed.offer.ort = alt.ort;
  applyOffer(d, parsed, false, { alt, nach });
}

const ZUORD_WARN = /Ordnungszahl als das Soll-LV|geringer Übereinstimmung|nicht im Soll-LV|des Soll-LV sind in der Bieterdatei nicht bepreist/;

const loseOf = (d: State, offer: Offer) => d.lose.filter((l) => losPositions(d, l).some((p) => (offer.prices[ozKey(p.oz)]?.ep ?? 0) !== 0)).map((l) => l.id);

/** Gibt es Bieterpositionen ohne LV-Position oder LV-Positionen ohne Bieterpreis? */
function hatLuecken(d: State, offer: Offer) {
  const known = new Set(d.lv.map((p) => ozKey(p.oz)));
  return Object.keys(offer.prices).some((k) => !known.has(k)) || (offer.zusatz?.length ?? 0) > 0 || d.lv.some((p) => !p.bedarf && offer.prices[ozKey(p.oz)]?.ep == null);
}

/**
 * Bieterpreise dem Soll-LV zuordnen und die Hinweise dazu erzeugen. Kann jederzeit erneut laufen
 * (z. B. wenn das LV erst nach den Angeboten geladen wird): Ausgangspunkt sind die gespeicherten Bieterpositionen.
 * Positionen, die im Soll-LV nicht vorkommen, gehen nicht verloren: sie werden als Zusatzpositionen geführt und mitgewertet.
 */
export function zuordnen(d: State, offer: Offer) {
  const bid = offer.bidPos ?? [];
  offer.warnungen = offer.warnungen.filter((w) => !ZUORD_WARN.test(w));
  offer.ozZuordnung = undefined;
  offer.prices = Object.fromEntries(bid.map((p) => [ozKey(p.oz), { ep: p.ep, gp: p.gp }]));
  const zugeordnet = mapToLv(d, offer, bid);
  const known = new Set(d.lv.map((p) => ozKey(p.oz)));
  const toKey = new Map(zugeordnet.map((m) => [ozKey(m.bieter), ozKey(m.lv)]));
  const neu = bid.filter((p) => !known.has(toKey.get(ozKey(p.oz)) ?? ozKey(p.oz)));
  offer.zusatz = neu.map((p): ZusatzPos => ({ oz: p.oz, kurz: p.kurz, einheit: p.einheit, menge: p.menge ?? (p.ep && p.gp != null ? Math.round((p.gp / p.ep) * 1000) / 1000 : null), ep: p.ep, gp: p.gp, bedarf: p.bedarf }));
  for (const k of Object.keys(offer.prices)) if (!known.has(k)) delete offer.prices[k]; // nur LV-Schlüssel; Zusatzpositionen stehen in offer.zusatz
  if (neu.length) {
    const wert = round2(offer.zusatz.filter((z) => !z.bedarf).reduce((a, z) => a + zusatzWert(z), 0));
    const liste = neu.slice(0, 5).map((p) => `${p.oz}${p.kurz ? ' ' + p.kurz.slice(0, 40) : ''}`).join('; ');
    offer.warnungen.push(`${neu.length} Position(en) der Bieterdatei stehen nicht im Soll-LV (neu, Wert ${fmtEur(wert)}, in der Angebotssumme enthalten): ${liste}${neu.length > 5 ? ' …' : ''}.`);
  }
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

const matches = (label: string, list: string[]) => {
  const num = label.match(/\b(\d{3})\b/)?.[1];
  if (num) return list.some((n) => new RegExp(`(^|\\D)${num}(\\D|$)`).test(n) || (SYN[num]?.test(n) ?? false));
  const words = label.toLowerCase().split(/[^a-zäöüß]+/).filter((w) => w.length >= 9);
  return words.length > 0 && list.some((n) => words.some((w) => n.includes(w)));
};

/** Unterlage wurde nachgereicht (von Hand markiert oder aus einem Ordner „Nachforderung“). */
export const istNach = (x: Offer['dateien'][number]) => x.nach != null || x.kat === 'Nachforderung';

/** Prüfzeilen, die nicht aus den Unterlagen-Dateien folgen (Unterschrift, Preise, Frist). */
const SONDERZEILE = /unterschrieben|signiert|preise vollständig|gaeb|fristgerecht/;

/** Vollständigkeitsprüfung aus vorhandenen Dateien vorbelegen. */
function autoPruef(d: State, offer: Offer, sigFound: boolean, preise: boolean) {
  const set = (id: string) => { offer.pruef[id] = { s: 'ok', d: '', k: 'auto' }; };
  for (const u of d.unterlagen) {
    const l = u.label.toLowerCase();
    if (/unterschrieben|signiert/.test(l)) { if (sigFound) set(u.id); }
    else if (/preise vollständig|gaeb/.test(l)) {
      if (offer.preisQuelle === 'keine') offer.pruef[u.id] = { s: 'fehlt', d: '', n: 'Im Angebotsordner liegt keine GAEB-Preisdatei, und aus den PDF-Dateien waren keine Preise lesbar.', k: 'auto' };
      else if (offer.preisQuelle === 'pdf') offer.pruef[u.id] = { s: 'pdf', d: '', n: 'Die GAEB-Datei des Bieters enthält keine Preise; das bepreiste LV liegt nur als PDF vor. Die Preise wurden aus dem PDF gelesen und sind zu prüfen.', k: 'auto' };
      else if (preise) set(u.id);
    }
  }
  pruefNachDateien(d, offer);
}

/**
 * Prüfzeilen aus den Unterlagen des Angebots vorbelegen (vorhanden / nachgereicht). Läuft erneut, wenn Dateien
 * hinzukommen oder entfernt werden; nur automatisch gesetzte Einträge ändern sich, Eingaben von Hand und KI bleiben.
 */
export function pruefNachDateien(d: State, offer: Offer) {
  const names = offer.dateien.filter((x) => !istNach(x)).map((x) => x.name.toLowerCase());
  const nach = offer.nachforderung.map((n) => n.toLowerCase());
  const datum = (label: string) => offer.dateien.find((x) => istNach(x) && x.nach && matches(label, [nachName(x.name).toLowerCase()]))?.nach ?? '';
  const frei = (id: string) => !offer.pruef[id] || offer.pruef[id].k === 'auto';
  const setNach = (id: string, label: string) => { offer.pruef[id] = { s: 'nach', d: datum(label) || (offer.pruef[id]?.s === 'nach' ? offer.pruef[id].d : ''), k: 'auto' }; };
  for (const u of d.unterlagen) {
    if (SONDERZEILE.test(u.label.toLowerCase()) || !frei(u.id)) continue;
    if (matches(u.label, nach)) setNach(u.id, u.label);
    else if (matches(u.label, names)) offer.pruef[u.id] = { s: 'ok', d: '', k: 'auto' };
    else delete offer.pruef[u.id];
  }
  // nachgereichte GAEB-Preisdatei (Nachforderung) → Prüfzeile „Preise vollständig (GAEB)“
  const gaeb = offer.dateien.find((x) => x.kat === GAEB_KAT && istNach(x));
  if (gaeb) for (const u of d.unterlagen) if (PREIS_ZEILE.test(u.label.toLowerCase()) && frei(u.id)) offer.pruef[u.id] = { s: 'nach', d: gaeb.nach ?? '', n: (offer.pruef[u.id]?.s === 'nach' ? offer.pruef[u.id].n : undefined) ?? `GAEB-Preisdatei „${gaeb.name}“ nachgereicht.`, k: 'auto' };
  // nachgereichte Unterlagen ohne passende Zeile → neue Prüfzeile
  for (const n of offer.nachforderung) {
    if (d.unterlagen.some((u) => matches(u.label, [n.toLowerCase()]))) continue;
    const label = n.replace(/\s+/g, ' ').trim();
    if (!label) continue;
    const row = d.unterlagen.find((u) => u.label === label) ?? { id: uid(), label };
    if (!d.unterlagen.includes(row)) d.unterlagen.push(row);
    if (frei(row.id)) setNach(row.id, n);
  }
  pqErsetzt124(d, offer);
}

const PQ_HINWEIS = 'Bieter präqualifiziert';

/**
 * Präqualifizierte Bieter weisen die Eignung über den Eintrag im PQ-Verzeichnis nach (§ 6b VOB/A); die Eigenerklärung
 * zur Eignung (VVB 124) entfällt dann und gehört nicht in die Nachforderung. Ein beigefügtes 124 bleibt „vorhanden“,
 * Eingaben von Hand bleiben unangetastet. Ohne PQ-Nummer wird die Kennzeichnung wieder aufgehoben.
 */
export function pqErsetzt124(d: State, offer: Offer) {
  const z = unterlageZeile(d, '124');
  if (!z) return;
  const cur = offer.pruef[z.id];
  const pq = bieterPq(offer);
  const vonPq = cur?.k === 'auto' && cur.s === 'entf' && !!cur.n?.startsWith(PQ_HINWEIS);
  if (!pq) { if (vonPq) delete offer.pruef[z.id]; return; }
  if (cur && (cur.k === 'user' || cur.s === 'ok' || cur.s === 'nach')) return;
  offer.pruef[z.id] = { s: 'entf', d: '', n: `${PQ_HINWEIS} (PQ-Nr. ${pq}) – Eigenerklärung zur Eignung entfällt.`, k: 'auto' };
}

/** Datei als nachgereicht markieren (`nach` = Datum, '' = unbekannt) oder die Markierung aufheben. */
export function setNachgereicht(d: State, offer: Offer, name: string, nach: string | null) {
  const f = offer.dateien.find((x) => x.name === name);
  if (!f) return;
  const n = nachName(name);
  if (nach == null) delete f.nach; else f.nach = nach;
  if (f.kat === GAEB_KAT) { pruefNachDateien(d, offer); return; } // gehört zur Prüfzeile „Preise vollständig (GAEB)“, siehe pruefNachDateien
  if (istNach(f)) { if (!offer.nachforderung.includes(n)) offer.nachforderung.push(n); }
  else if (!offer.dateien.some((x) => istNach(x) && nachName(x.name) === n)) offer.nachforderung = offer.nachforderung.filter((x) => x !== n);
  pruefNachDateien(d, offer);
}

/** Unterlagen zu einem Angebot hinzufügen (gleichnamige Dateien werden ersetzt); `nach` ≠ null = nachgereicht am. */
export function addDateien(d: State, offer: Offer, files: { name: string; kat: string }[], nach: string | null) {
  for (const f of files) {
    offer.dateien = offer.dateien.filter((x) => x.name !== f.name);
    offer.dateien.push({ ...f });
    setNachgereicht(d, offer, f.name, nach);
  }
}

/** Eine Unterlage aus dem Angebot entfernen, samt der Befunde, die sich auf sie beziehen. */
export function removeDatei(d: State, offer: Offer, name: string) {
  const n = nachName(name);
  offer.dateien = offer.dateien.filter((x) => x.name !== name);
  if (!offer.dateien.some((x) => istNach(x) && nachName(x.name) === n)) offer.nachforderung = offer.nachforderung.filter((x) => x !== n);
  offer.lvPdf = offer.lvPdf?.filter((l) => l.name !== name);
  offer.kiDocs = offer.kiDocs?.filter((k) => k.datei.split('/').pop() !== name);
  if (offer.check?.pdf?.datei === name) offer.check = { ...offer.check, pdf: undefined };
  pruefNachDateien(d, offer);
}

/** LV-Schätzpreise (GAEB 82) zum geladenen LV ergänzen bzw. ersetzen. */
export function applySchaetz(d: State, doc: GaebDoc, name: string) {
  d.schaetz = schaetzPreise(d.lv, doc);
  d.lvInfo = { ...d.lvInfo, schaetz: Object.keys(d.schaetz).length ? name : '' };
  applyKopf(d.project, { kostenDatum: kopfAusDoc(doc).kostenDatum });
}

export function removeSchaetz(d: State) {
  const name = d.lvInfo?.schaetz;
  d.schaetz = {};
  d.lvInfo = { ...d.lvInfo, schaetz: '' };
  // beim PDF nur den Preis-Befund entfernen, der Abgleich mit dem LV bleibt
  d.lvPruef = d.lvPruef?.filter((b) => !b.datei || b.datei !== name || (b.quelle === 'pdf' && !b.text.includes('LV-Schätzpreise aus dem PDF')));
}

/** Eigenes LV entfernen; Lose und Angebote bleiben, die Angebote werden beim nächsten LV neu zugeordnet. */
export function removeLv(d: State) {
  d.lv = [];
  d.titles = {};
  d.schaetz = {};
  d.lvInfo = { lv: '', schaetz: '', pdfs: [] };
  d.lvPruef = [];
}

/** Befunde eines LV-PDF erkennen (ältere Befunde tragen den Dateinamen nur im Text). */
export const vonPdf = (b: LvBefund, name: string) => b.quelle === 'pdf' && (b.datei ? b.datei === name : b.text.startsWith(name));

/**
 * Nachverhandlung zu einem Hauptangebot einlesen: eigenes Angebot (eigene Preise, eigener Nachlass, eigene Unterlagen),
 * verknüpft über `basis`. Das Hauptangebot und seine Unterlagen bleiben unverändert.
 */
export function nachverhandlungAnfuegen(d: State, hauptId: string, parsed: ParsedBid) {
  const h = d.offers.find((o) => o.id === hauptId);
  if (!h) return;
  parsed.offer.basis = h.id;
  parsed.offer.firma = h.firma;
  applyOffer(d, parsed, false);
}

/** Preise eines Angebots als GAEB-Dokument – für eine Nachverhandlung ohne Preisdatei (Preise der vorigen Runde gelten als bestätigt). */
export function preiseAlsDoc(o: Pick<Offer, 'firma' | 'bidPos'>): GaebDoc {
  return { format: 'X', phase: 84, projekt: '', bezeichnung: '', auftraggeber: '', bieter: o.firma, datum: '', titles: {}, positions: (o.bidPos ?? []).map((p) => ({ ...p })), totals: {}, total: { net: null, gross: null } };
}
