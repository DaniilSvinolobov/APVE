const nf = (d: number) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtNum = (v: number, d = 2) => nf(d).format(v);
export const fmtEur = (v: number | null | undefined) => (v == null || !isFinite(v) ? '–' : nf(2).format(v) + ' €');
/** "1.234,56 EUR" wie im Vergabevermerk */
export const fmtEUR = (v: number | null | undefined) => (v == null || !isFinite(v) ? '–' : nf(2).format(v) + ' EUR');
export const fmtPct = (v: number | null | undefined, d = 1) =>
  v == null || !isFinite(v) ? '–' : `${v > 0 ? '+' : ''}${nf(d).format(v)} %`;
export const fmtDate = (iso: string) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso || '–';
};
export const fmtDateTime = (iso: string) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return iso || '–';
  return `${m[3]}.${m[2]}.${m[1]}${m[4] ? `, ${m[4]}:${m[5]} Uhr` : ''}`;
};

export function parseNum(s: string): number | null {
  let t = s.replace(/[\s€%]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return isFinite(n) ? n : null;
}

export const uid = () => Math.random().toString(36).slice(2, 9);
export const round2 = (v: number) => Math.round(v * 100) / 100;

/** "a, b und c" */
export function listDe(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' und ' + items[items.length - 1];
}
