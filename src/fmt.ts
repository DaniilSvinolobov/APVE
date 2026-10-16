const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const fmtEur = (v: number | null | undefined) => (v == null || !isFinite(v) ? '–' : eur.format(v));
export const fmtNum = (v: number, d = 2) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
export const fmtPct = (v: number | null | undefined, d = 1) =>
  v == null || !isFinite(v) ? '–' : `${v > 0 ? '+' : ''}${fmtNum(v, d)} %`;
export const fmtDate = (iso: string) => {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
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
