/** Kleine Verlaufskurve. `max` fest (z. B. 100 für Prozent), sonst der größte Wert. */
export function Sparkline({ values, max, label }: { values: number[]; max?: number; label: string }) {
  if (values.length < 2) return <div className="sparkline sparkline-empty" aria-hidden="true" />;
  const top = Math.max(max ?? 0, ...values, 1);
  const w = 100;
  const h = 32;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(2)},${(h - (Math.max(0, v) / top) * (h - 2) - 1).toFixed(2)}`);
  const line = pts.join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polygon className="sparkline-area" points={`0,${h} ${line} ${w},${h}`} />
      <polyline className="sparkline-line" points={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
