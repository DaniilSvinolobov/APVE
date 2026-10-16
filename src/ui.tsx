import { useState, type ClipboardEventHandler, type ReactNode } from 'react';
import { fmtNum, parseNum } from './fmt';

export function NumInput(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  decimals?: number;
  placeholder?: string;
  suffix?: string;
  className?: string;
  onPaste?: ClipboardEventHandler<HTMLInputElement>;
  data?: Record<string, string | number>;
  label?: string;
}) {
  const { value, onChange, decimals = 2, placeholder, suffix, className = '', onPaste, data, label } = props;
  const [txt, setTxt] = useState<string | null>(null);
  const shown = txt ?? (value == null ? '' : fmtNum(value, decimals));
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return (
    <span className={`numwrap ${className}`}>
      <input
        {...dataAttrs}
        aria-label={label}
        inputMode="decimal"
        value={shown}
        placeholder={placeholder}
        onFocus={(e) => {
          const el = e.currentTarget;
          setTxt(value == null ? '' : String(value).replace('.', ','));
          requestAnimationFrame(() => el.select());
        }}
        onChange={(e) => {
          setTxt(e.target.value);
          onChange(parseNum(e.target.value));
        }}
        onBlur={() => setTxt(null)}
        onPaste={onPaste}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

export function Field(props: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${props.wide ? 'wide' : ''}`}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Seg<T extends string>(props: { value: T; onChange: (v: T) => void; options: { value: T; label: string; sub?: string }[] }) {
  return (
    <div className="seg" role="radiogroup">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          <b>{o.label}</b>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

export function Chip({ kind, children }: { kind: 'warn' | 'info' | 'bad' | 'ok'; children: ReactNode }) {
  return <span className={`chip ${kind}`}>{children}</span>;
}

export function Icon({ name }: { name: 'check' | 'plus' | 'trash' | 'print' | 'download' | 'upload' | 'sparkle' | 'alert' | 'arrow' | 'back' }) {
  const p: Record<string, string> = {
    check: 'M5 13l4 4L19 7',
    plus: 'M12 5v14M5 12h14',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3',
    print: 'M7 9V3h10v6M7 17H4v-6h16v6h-3M7 14h10v7H7z',
    download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14',
    upload: 'M12 16V5m0 0l-4 4m4-4l4 4M5 20h14',
    sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
    alert: 'M12 8v5m0 4h.01M10.3 4l-8 14a2 2 0 001.7 3h16a2 2 0 001.7-3l-8-14a2 2 0 00-3.4 0z',
    arrow: 'M5 12h14m-6-6l6 6-6 6',
    back: 'M19 12H5m6-6l-6 6 6 6',
  };
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={p[name]} />
    </svg>
  );
}
