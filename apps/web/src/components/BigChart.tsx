import { useRef, useState, type PointerEvent } from 'react';

export interface BigSeries {
  name: string;
  /** CSS-Klasse für die Farbe (z. B. chart-a, chart-b). */
  tone: 'a' | 'b';
  values: (number | null)[];
}

const W = 600;
const H = 220;

function niceTop(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function timeLabel(at: number, long: boolean, timeZone: string): string {
  const opts: Intl.DateTimeFormatOptions = long ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' };
  return new Date(at).toLocaleString('de-DE', { ...opts, timeZone });
}

/**
 * Große Verlaufskurve mit Achsen. Fährt man mit Maus oder Finger darüber, steht oben der Wert
 * an dieser Stelle. Punkte liegen nach Zeit (`times`), Lücken (null) unterbrechen die Linie.
 */
export function BigChart({
  times,
  series,
  from,
  to,
  max,
  format,
  label,
  timeZone,
}: {
  times: number[];
  series: BigSeries[];
  from: number;
  to: number;
  max?: number;
  format: (v: number) => string;
  label: string;
  timeZone: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const span = Math.max(1, to - from);
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const top = max ?? niceTop(Math.max(...all, 0) * 1.1);
  const x = (at: number) => ((at - from) / span) * W;
  const y = (v: number) => H - (Math.max(0, Math.min(v, top)) / top) * H;
  const long = span > 26 * 3600_000;
  // Nach dem Antippen kann die nächste Abfrage weniger Punkte bringen.
  const hi = hover !== null && hover < times.length ? hover : null;
  /** Längere Pause ohne Werte (PC aus, Neustart): dort keine Linie ziehen. */
  const maxGap = 3 * Math.max(10_000, span / 240);
  const joined = (values: (number | null)[], i: number) =>
    i > 0 && i < values.length && values[i] != null && values[i - 1] != null && times[i]! - times[i - 1]! <= maxGap;

  const path = (values: (number | null)[]) => {
    let d = '';
    values.forEach((v, i) => {
      if (v == null) return;
      d += `${joined(values, i) ? 'L' : 'M'}${x(times[i]!).toFixed(1)},${y(v).toFixed(1)} `;
    });
    return d.trim();
  };
  /** Punkte ohne Nachbarn (z. B. der erste Messwert) wären als Linie unsichtbar. */
  const isolated = (values: (number | null)[]) =>
    values.flatMap((v, i) => (v != null && !joined(values, i) && !joined(values, i + 1) ? [i] : []));

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || times.length === 0) return;
    const at = from + ((e.clientX - box.left) / box.width) * span;
    let best = 0;
    for (let i = 1; i < times.length; i++) if (Math.abs(times[i]! - at) < Math.abs(times[best]! - at)) best = i;
    setHover(best);
  };

  const ticks = [0, 1, 2, 3].map((i) => from + (span * i) / 3);

  return (
    <figure className="big-chart">
      <div className="big-chart-readout" aria-live="off">
        {hi !== null ? (
          <>
            <span className="hint">{timeLabel(times[hi]!, long, timeZone)}</span>
            {series.map((s) => (
              <span key={s.name} className={`big-chart-key chart-${s.tone}`}>
                {series.length > 1 && `${s.name} `}
                <strong>{s.values[hi] == null ? '–' : format(s.values[hi]!)}</strong>
              </span>
            ))}
          </>
        ) : (
          <span className="hint">Mit Maus oder Finger über die Kurve fahren für genaue Werte.</span>
        )}
      </div>
      <div className="big-chart-body">
        <div className="big-chart-y" aria-hidden="true">
          <span>{format(top)}</span>
          <span>{format(top / 2)}</span>
          <span>{format(0)}</span>
        </div>
        <div
          ref={ref}
          className="big-chart-plot"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
            {[0, 0.5, 1].map((f) => (
              <line key={f} className="big-chart-grid" x1={0} x2={W} y1={H * f} y2={H * f} vectorEffect="non-scaling-stroke" />
            ))}
            {series.map((s) => (
              <path key={s.name} className={`big-chart-line chart-${s.tone}`} d={path(s.values)} vectorEffect="non-scaling-stroke" />
            ))}
            {series.flatMap((s) =>
              isolated(s.values).map((i) => {
                const px = x(times[i]!);
                const py = y(s.values[i]!);
                return <line key={`${s.name}-${i}`} className={`big-chart-dot chart-${s.tone}`} x1={px} x2={px} y1={py} y2={py} vectorEffect="non-scaling-stroke" />;
              }),
            )}
          </svg>
          {hi !== null && <div className="big-chart-cursor" style={{ left: `${(x(times[hi]!) / W) * 100}%` }} aria-hidden="true" />}
        </div>
      </div>
      <div className="big-chart-x" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t}>{timeLabel(t, long, timeZone)}</span>
        ))}
      </div>
    </figure>
  );
}
