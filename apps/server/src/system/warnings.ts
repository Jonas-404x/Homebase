import type { Prefs, SystemStats } from '@mainframe/shared';
import type { EventLog } from './events.ts';

/** Abstand unter der Schwelle, ab dem wieder gewarnt werden darf (damit es bei 89/90/89/90 nicht flattert). */
const REARM = 2;

/**
 * Schreibt ein Ereignis, wenn ein Laufwerk zu voll oder die Temperatur zu hoch wird.
 * Pro Überschreitung genau einmal; erst wenn der Wert wieder deutlich darunter war, erneut.
 */
export function createWarner(events: EventLog) {
  const active = new Set<string>();
  const check = (key: string, value: number, threshold: number, text: () => string) => {
    if (value >= threshold) {
      if (!active.has(key)) {
        active.add(key);
        events.add('warn', text());
      }
    } else if (value < threshold - REARM) {
      active.delete(key);
    }
  };
  return (s: SystemStats, t: Prefs['thresholds']) => {
    for (const d of s.disks) {
      if (d.totalBytes <= 0) continue;
      const pct = (d.usedBytes / d.totalBytes) * 100;
      check(`disk:${d.mount}`, pct, t.disk, () => `Laufwerk ${d.mount} ist zu ${Math.round(pct)} % voll`);
    }
    if (s.temperatureC !== null) {
      const c = s.temperatureC;
      check('temp', c, t.temperature, () => `Temperatur zu hoch: ${Math.round(c)} °C`);
    }
  };
}
