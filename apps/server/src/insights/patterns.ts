import type { HistoryPoint } from '@mainframe/shared';
import type { AppEvent, DiskRow, Facts } from './store.ts';
import { isDataMount } from './incidents.ts';
import { dayKey, minuteOfDay, startOfDay, weekday } from './time.ts';

export type HintKind = 'restart-pattern' | 'memory-rise' | 'disk-fill' | 'night-spike' | 'past-incident';

/** Ein Hinweis aus den Regeln: fester Text plus Zahlen, aus denen die KI ihren Satz baut. */
export interface Hint {
  id: string;
  kind: HintKind;
  title: string;
  detail: string;
  facts: Facts;
}

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_MIN = 60;
const MIN_DAYS = 3;
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (minute: number) => `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;

/** Eine App startet an mindestens 3 von 7 Tagen im selben 1-Stunden-Fenster neu (nur von selbst, nicht durch dich). */
export function detectRestartPatterns(events: AppEvent[], names: Map<string, string>, now: number): Hint[] {
  const from = now - 7 * DAY;
  const byApp = new Map<string, AppEvent[]>();
  for (const e of events) {
    if (e.at < from || e.at > now || (e.kind !== 'restart' && e.kind !== 'crash')) continue;
    byApp.set(e.appId, [...(byApp.get(e.appId) ?? []), e]);
  }
  const hints: Hint[] = [];
  for (const [appId, list] of byApp) {
    // Jedes Ereignis ist einmal der Anfang eines Fensters; das Fenster mit den meisten Tagen gewinnt.
    let best: { start: number; days: Set<string>; first: number } | null = null;
    for (const anchor of list) {
      const start = minuteOfDay(anchor.at);
      const days = new Set<string>();
      let first = Infinity;
      for (const e of list) {
        const offset = (minuteOfDay(e.at) - start + 1440) % 1440;
        if (offset < WINDOW_MIN) {
          days.add(dayKey(e.at));
          first = Math.min(first, e.at);
        }
      }
      if (!best || days.size > best.days.size) best = { start, days, first };
    }
    if (!best || best.days.size < MIN_DAYS) continue;
    const name = names.get(appId) ?? appId;
    const hour = Math.round((best.start + WINDOW_MIN / 2) / 60) % 24;
    hints.push({
      id: `pattern:restart:${appId}`,
      kind: 'restart-pattern',
      title: `${name} startet oft gegen ${hour} Uhr neu`,
      detail: `An ${best.days.size} der letzten 7 Tage zwischen ${clock(best.start)} und ${clock(best.start + WINDOW_MIN)} Uhr, zuerst am ${weekday(best.first)}.`,
      facts: { app: name, days: best.days.size, from: clock(best.start), to: clock(best.start + WINDOW_MIN), since: weekday(best.first) },
    });
  }
  return hints;
}

/** Tagesmittel des Arbeitsspeichers (lokale Tage), ohne den laufenden Tag. */
export function dailyAverages(points: HistoryPoint[], now: number): { day: string; memory: number }[] {
  const today = startOfDay(now);
  const sums = new Map<string, { sum: number; n: number }>();
  for (const p of points) {
    if (p.at >= today) continue;
    const k = dayKey(p.at);
    const s = sums.get(k) ?? { sum: 0, n: 0 };
    s.sum += p.memory;
    s.n += 1;
    sums.set(k, s);
  }
  return [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, s]) => ({ day, memory: Math.round((s.sum / s.n) * 10) / 10 }));
}

/** Der Tagesdurchschnitt steigt 3 Tage in Folge und liegt mindestens 10 Prozentpunkte höher als am ersten Tag. */
export function detectMemoryRise(days: { day: string; memory: number }[]): Hint[] {
  if (days.length < 4) return [];
  const last = days.slice(-4);
  for (let i = 1; i < last.length; i++) if (last[i]!.memory <= last[i - 1]!.memory) return [];
  const a = last[0]!.memory;
  const b = last[3]!.memory;
  if (b - a < 10) return [];
  return [{
    id: 'pattern:memory',
    kind: 'memory-rise',
    title: 'Arbeitsspeicher steigt seit Tagen',
    detail: `Im Schnitt von ${Math.round(a)} % auf ${Math.round(b)} % in 3 Tagen. Schau, welche App immer mehr braucht.`,
    facts: { from: Math.round(a), to: Math.round(b), days: 3 },
  }];
}

/** Wächst die Belegung im Tempo der letzten 7 Tage weiter, ist das Laufwerk in weniger als 14 Tagen voll. */
export function detectDiskFill(rows: DiskRow[], now: number): Hint[] {
  const byMount = new Map<string, DiskRow[]>();
  for (const r of rows) if (r.at >= now - 7 * DAY && r.at <= now && isDataMount(r.mount)) byMount.set(r.mount, [...(byMount.get(r.mount) ?? []), r]);
  const hints: Hint[] = [];
  byMount.forEach((list, mount) => {
    list.sort((x, y) => x.at - y.at);
    const first = list[0]!;
    const last = list.at(-1)!;
    if (last.at - first.at < DAY) return;
    const perMs = (last.used - first.used) / (last.at - first.at);
    if (perMs <= 0 || last.total <= 0) return;
    const daysLeft = (last.total - last.used) / perMs / DAY;
    if (daysLeft >= 14) return;
    const d = Math.max(0, Math.floor(daysLeft));
    hints.push({
      id: `pattern:disk:${mount}`,
      kind: 'disk-fill',
      title: `Laufwerk ${mount} füllt sich`,
      detail: d < 1 ? 'Wenn es so weitergeht, ist es in weniger als einem Tag voll.' : `Wenn es so weitergeht, ist es in etwa ${d} Tagen voll.`,
      facts: { daysLeft: d, usedPercent: Math.round((last.used / last.total) * 100) },
    });
  });
  return hints;
}
