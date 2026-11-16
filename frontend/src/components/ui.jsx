import { useEffect } from 'react';

export const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' }) : '');

export const CATEGORY_LABELS = {
  web_development: 'Website', software_development: 'Software', kuccps: 'KUCCPS', academic_guidance: 'Academic', technical_support: 'Tech support',
  business_inquiry: 'Business', partnership: 'Partnership', personal: 'Personal', general_conversation: 'General', other: 'Other',
};

export function Pill({ tone = 'plain', children }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Stat({ label, value, hint, tone }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: `var(--${tone})` } : undefined}>{value ?? '—'}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Field({ label, help, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {help && <div className="help">{help}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="grid cols-4">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton" />)}</div>;
}

export function ErrorNote({ error }) {
  return error ? <div className="error">⚠ {error.message}</div> : null;
}

export function Toast({ message, onDone }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return message ? <div className="toast" role="status">{message}</div> : null;
}

export const stateTone = (s) => ({ connected: 'ok', connecting: 'warn', qr_pending: 'warn', reconnecting: 'warn', disconnected: 'bad', logged_out: 'bad', failed: 'bad', replaced: 'bad', error: 'bad' }[s] || 'plain');

/** Dependency-free charts so the bundle stays small. */
export function BarList({ rows, labelKey, valueKey, format = (v) => v }) {
  const max = Math.max(1, ...rows.map((r) => r[valueKey]));
  if (!rows.length) return <div className="empty">No data yet</div>;
  return rows.map((r) => (
    <div className="bar-row" key={r[labelKey]}>
      <span className="clip" style={{ maxWidth: 150 }} title={format(r[labelKey])}>{format(r[labelKey])}</span>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${(r[valueKey] / max) * 100}%` }} /></div>
      <b>{r[valueKey]}</b>
    </div>
  ));
}

export function LineChart({ points, series }) {
  const W = 640; const H = 190; const P = 28;
  if (!points.length) return <div className="empty">No data yet</div>;
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p[s.key] || 0)));
  const x = (i) => P + (points.length === 1 ? (W - 2 * P) / 2 : (i * (W - 2 * P)) / (points.length - 1));
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Line chart">
      {[0, 0.5, 1].map((t) => <line key={t} x1={P} x2={W - P} y1={y(max * t)} y2={y(max * t)} stroke="rgba(255,255,255,.08)" />)}
      <text x={4} y={y(max) + 4} fill="#8d9a94" fontSize="11">{max}</text>
      {series.map((s) => {
        const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p[s.key] || 0)}`).join(' ');
        return (
          <g key={s.key}>
            <path d={d} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p[s.key] || 0)} r="3" fill={s.color}><title>{`${p.day}: ${p[s.key] || 0} ${s.label}`}</title></circle>)}
          </g>
        );
      })}
      {points.map((p, i) => (i % Math.ceil(points.length / 7) === 0 ? <text key={i} x={x(i)} y={H - 6} fill="#8d9a94" fontSize="10" textAnchor="middle">{p.day.slice(5)}</text> : null))}
    </svg>
  );
}

export const icons = {
  grid: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>,
  link: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="7" y="2" width="10" height="20" rx="3" /><path d="M11 18h2" /></svg>,
  chat: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.7 7L3 21l2-6A8 8 0 1 1 21 12z" /></svg>,
  inbox: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></svg>,
  chart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></svg>,
  gear: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
};
