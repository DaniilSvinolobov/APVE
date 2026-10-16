import type { State } from './types';
import { FORMAL_CHECKS } from './types';
import { computeAll, lineTotal } from './calc';

const q = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const n = (v: number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

export function downloadFile(name: string, data: string, type: string) {
  const blob = new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Excel-kompatibler Preisspiegel (CSV, Semikolon, UTF-8 mit BOM). */
export function exportPreisspiegel(s: State) {
  const res = computeAll(s, FORMAL_CHECKS.map((c) => c.id));
  const lines: string[] = [];
  lines.push(['Preisspiegel', s.project.titel].map(q).join(';'));
  lines.push(['Vergabe-Nr.', s.project.nummer].map(q).join(';'));
  lines.push('');
  if (s.project.mode === 'lv') {
    lines.push(['Pos.', 'Leistung', 'Menge', 'Einheit', ...s.bidders.flatMap((b) => [`${b.name} EP`, `${b.name} GP`])].map(q).join(';'));
    for (const p of s.positions) {
      lines.push([
        q(p.nr), q(p.text + (p.bedarf ? ' (Bedarfsposition)' : '')), n(p.menge), q(p.einheit),
        ...s.bidders.flatMap((b) => { const ep = s.prices[p.id]?.[b.id] ?? null; return [n(ep), n(lineTotal(p.menge, ep))]; }),
      ].join(';'));
    }
    lines.push('');
  }
  const row = (label: string, f: (r: (typeof res)[number]) => string) => lines.push([q(label), ...res.map((r) => f(r))].join(';'));
  lines.push(['', ...res.map((r) => q(r.bidder.name))].join(';'));
  row('Summe netto', (r) => n(r.brutto));
  row('Nachlass %', (r) => n(r.bidder.nachlass));
  row('Angebotssumme netto', (r) => n(r.net));
  row(`Angebotssumme brutto (${s.project.mwst} % MwSt.)`, (r) => n(r.gross));
  row('Rang', (r) => String(r.rank ?? ''));
  return downloadFile(`Preisspiegel_${s.project.nummer || 'Vergabe'}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

export function exportJson(s: State) {
  downloadFile(`Vergabe_${s.project.nummer || 'Datensicherung'}.json`, JSON.stringify(s, null, 2), 'application/json');
}
