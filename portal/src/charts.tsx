// Small, dependency-free charts in the app's colours.

type Point = { day: string; a: number; b?: number };

const fmtDay = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Area chart for a daily series. `a` is the main line (teal), `b` an optional second (marigold). */
export function AreaChart({ data, aLabel, bLabel, height = 220 }: { data: Point[]; aLabel: string; bLabel?: string; height?: number }) {
  const W = 640, H = height, L = 34, R = 22, T = 10, B = 26;
  if (data.length === 0) return <p className="muted small">No data yet.</p>;
  const max = Math.max(1, ...data.map((p) => Math.max(p.a, p.b ?? 0)));
  const nice = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const x = (i: number) => L + (data.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (data.length - 1));
  const y = (v: number) => T + (H - T - B) * (1 - v / nice);
  const line = (k: 'a' | 'b') => data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y((p[k] ?? 0) as number).toFixed(1)}`).join(' ');
  const area = `${line('a')} L${x(data.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, nice / 2, nice];
  const every = Math.max(1, Math.ceil(data.length / 6));
  const total = (k: 'a' | 'b') => data.reduce((s, p) => s + ((p[k] ?? 0) as number), 0);
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`${aLabel}: ${total('a')} over ${data.length} days${bLabel ? `. ${bLabel}: ${total('b')}` : ''}.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text className="axis" x={L - 6} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {data.map((p, i) => (i % every === 0 || i === data.length - 1) && (
          <text key={p.day} className="axis" x={x(i)} y={H - 6} textAnchor="middle">{fmtDay(p.day)}</text>
        ))}
        <path d={area} fill="rgba(14,149,148,.14)" />
        <path d={line('a')} fill="none" stroke="#0e9594" strokeWidth={2.5} strokeLinejoin="round" />
        {bLabel && <path d={line('b')} fill="none" stroke="#eab04e" strokeWidth={2.5} strokeLinejoin="round" strokeDasharray="6 5" />}
      </svg>
      <figcaption className="row small muted" style={{ gap: 18, marginTop: 6 }}>
        <span><span style={{ display: 'inline-block', width: 14, height: 3, background: '#0e9594', verticalAlign: 'middle', marginRight: 6 }} />{aLabel}</span>
        {bLabel && <span><span style={{ display: 'inline-block', width: 14, height: 3, background: '#eab04e', verticalAlign: 'middle', marginRight: 6 }} />{bLabel}</span>}
      </figcaption>
    </figure>
  );
}

/** Horizontal bars for a ranked list. */
export function HBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      {rows.map((r) => (
        <div className="hbar" key={r.label}>
          <span>{r.label}</span>
          <div className="track"><div className="fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
          <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{r.value.toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
}
