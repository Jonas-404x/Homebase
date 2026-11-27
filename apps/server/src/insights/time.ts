/** Uhrzeiten und Tage in der Zeitzone des Servers (dort, wo Jonas wohnt). */
const pad = (n: number) => String(n).padStart(2, '0');

export const hhmm = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const dayKey = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const minuteOfDay = (at: number) => {
  const d = new Date(at);
  return d.getHours() * 60 + d.getMinutes();
};

export const startOfDay = (at: number) => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const weekday = (at: number) => WEEKDAYS[new Date(at).getDay()]!;

/** "heute", "gestern" oder "am 24.11." */
export function dayLabel(at: number, now: number): string {
  if (dayKey(at) === dayKey(now)) return 'heute';
  if (dayKey(at) === dayKey(startOfDay(now) - 1)) return 'gestern';
  const d = new Date(at);
  return `am ${d.getDate()}.${d.getMonth() + 1}.`;
}
