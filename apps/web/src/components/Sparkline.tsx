export interface ChartPoint {
  at: number;
  v: number;
}

/**
 * Kleine Verlaufskurve. Punkte liegen nach ihrer Zeit, rechts ist der neueste Punkt,
 * links der Beginn von `windowMs`. `max` fest (z. B. 100 für Prozent), sonst der größte Wert.
 */
export function Sparkline({ points, windowMs, max, label }: { points: ChartPoint[]; windowMs: number; max?: number; label: string }) {
  const to = points.length ? Math.max(...points.map((p) => p.at)) : 0;
  const from = to - windowMs;
  const shown = points.filter((p) => p.at >= from).sort((a, b) => a.at - b.at);
  if (shown.length < 2) return <div className="sparkline skeleton" aria-hidden="true" />;
  const top = Math.max(max ?? 0, ...shown.map((p) => p.v), 1);
  const w = 100;
  const h = 32;
  const pts = shown.map((p) => `${(((p.at - from) / windowMs) * w).toFixed(2)},${(h - (Math.max(0, p.v) / top) * (h - 2) - 1).toFixed(2)}`);
  const line = pts.join(' ');
  const first = pts[0]!.split(',')[0];
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polygon className="sparkline-area" points={`${first},${h} ${line} ${w},${h}`} />
      <polyline className="sparkline-line" points={line} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
