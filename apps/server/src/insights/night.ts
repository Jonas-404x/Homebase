import type { HistoryPoint, Prefs } from '@mainframe/shared';
import type { Hint } from './patterns.ts';
import type { UsageRow } from './store.ts';
import { dayKey, hhmm, startOfDay } from './time.ts';

const MIN = 60_000;
/** Wie lange ein Wert mindestens über der Schwelle liegen muss. */
const MIN_SPIKE_MS = 10 * MIN;
/** Fehlen länger Messwerte, ist die Spitze dort unterbrochen. */
const MAX_GAP_MS = 2 * MIN;
/** Für den Prozessor gibt es keine Warnschwelle, dort gilt fest 90 %. */
export const NIGHT_CPU_PERCENT = 90;
export const NIGHT_END_HOUR = 7;

export interface NightWindow {
  start: number;
  end: number;
  day: string;
}

/** 0 bis 7 Uhr des Tages, in dem `now` liegt. */
export function nightWindow(now: number): NightWindow {
  const start = startOfDay(now);
  const end = new Date(start);
  end.setHours(NIGHT_END_HOUR);
  return { start, end: end.getTime(), day: dayKey(now) };
}

type Metric = 'cpu' | 'memory' | 'temp';
const LABEL: Record<Metric, { noun: string; unit: string }> = {
  cpu: { noun: 'der Prozessor', unit: ' %' },
  memory: { noun: 'der Arbeitsspeicher', unit: ' %' },
  temp: { noun: 'die Temperatur', unit: ' °C' },
};

/** Zeiträume in der Nacht, in denen ein Wert mindestens 10 Minuten über seiner Schwelle lag; je Wert die längste Spitze. */
export function detectNightSpikes(
  points: HistoryPoint[],
  usage: UsageRow[],
  thresholds: Prefs['thresholds'],
  names: Map<string, string>,
  win: NightWindow,
): Hint[] {
  const night = points.filter((p) => p.at >= win.start && p.at < win.end).sort((a, b) => a.at - b.at);
  const limits: Record<Metric, number> = { cpu: NIGHT_CPU_PERCENT, memory: thresholds.memory, temp: thresholds.temperature };
  const hints: Hint[] = [];
  for (const metric of ['cpu', 'memory', 'temp'] as Metric[]) {
    let best: { from: number; to: number; max: number } | null = null;
    let run: { from: number; to: number; max: number } | null = null;
    const close = () => {
      if (run && run.to - run.from >= MIN_SPIKE_MS && (!best || run.to - run.from > best.to - best.from)) best = run;
      run = null;
    };
    for (const p of night) {
      const v = p[metric];
      if (v === null || v < limits[metric]) {
        close();
        continue;
      }
      if (run && p.at - run.to > MAX_GAP_MS) close();
      run = run ? { from: run.from, to: p.at, max: Math.max(run.max, v) } : { from: p.at, to: p.at, max: v };
    }
    close();
    if (!best) continue;
    const spike: { from: number; to: number; max: number } = best;
    const minutes = Math.round((spike.to - spike.from) / MIN);
    const top = topApp(usage, spike.from, spike.to, metric === 'memory' ? 'mem' : 'cpu');
    const topName = top ? (names.get(top) ?? top) : null;
    const { noun, unit } = LABEL[metric];
    const max = Math.round(spike.max);
    hints.push({
      id: `night:${win.day}:${metric}`,
      kind: 'night-spike',
      title: `Heute Nacht: ${noun.split(' ')[1]} ${minutes} Minuten bei ${max}${unit}`,
      detail: `Um ${hhmm(spike.from)} war ${noun} ${minutes} Minuten bei bis zu ${max}${unit}${topName ? `, vor allem ${topName}` : ''}.`,
      facts: { metric, at: hhmm(spike.from), minutes, max, unit: unit.trim(), ...(topName ? { app: topName } : {}) },
    });
  }
  return hints;
}

/** Die App mit dem höchsten Mittelwert im Zeitraum (Messung alle 5 Minuten, deshalb etwas Rand). */
function topApp(usage: UsageRow[], from: number, to: number, field: 'cpu' | 'mem'): string | null {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const u of usage) {
    if (u.at < from - 5 * MIN || u.at > to + 5 * MIN) continue;
    const s = sums.get(u.appId) ?? { sum: 0, n: 0 };
    s.sum += u[field];
    s.n += 1;
    sums.set(u.appId, s);
  }
  let best: { id: string; avg: number } | null = null;
  for (const [id, s] of sums) {
    const avg = s.sum / s.n;
    if (avg > 0 && (!best || avg > best.avg)) best = { id, avg };
  }
  return best?.id ?? null;
}
