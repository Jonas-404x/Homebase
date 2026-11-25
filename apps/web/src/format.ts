export type SizeUnits = 'si' | 'iec';
export type NetUnits = 'bytes' | 'bits';

const num = (v: number, digits = 1) =>
  v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const percent = (v: number) => `${num(v)} %`;

const scale = (units: SizeUnits) =>
  units === 'iec'
    ? { g: 1024 ** 3, m: 1024 ** 2, t: 1024 ** 4, gl: 'GiB', ml: 'MiB', tl: 'TiB' }
    : { g: 1e9, m: 1e6, t: 1e12, gl: 'GB', ml: 'MB', tl: 'TB' };

/** Eine Größe wie „1,0 GB“, „512 MiB“ oder „1,9 TB“. */
export function size(bytes: number, units: SizeUnits = 'si'): string {
  const s = scale(units);
  if (bytes >= s.t * 10) return `${num(bytes / s.t)} ${s.tl}`;
  if (bytes >= s.g) return `${num(bytes / s.g)} ${s.gl}`;
  return `${num(bytes / s.m, 0)} ${s.ml}`;
}

/** „3,2 / 7,8 GB“ (beide Werte in der Einheit des Gesamtwerts). */
export function usedOfTotal(used: number, total: number, units: SizeUnits = 'si'): string {
  const s = scale(units);
  return `${num(used / s.g)} / ${num(total / s.g)} ${s.gl}`;
}

export function rate(bytesPerSec: number, units: NetUnits = 'bytes'): string {
  if (units === 'bits') {
    const bits = bytesPerSec * 8;
    if (bits >= 1e6) return `${num(bits / 1e6)} Mbit/s`;
    return `${num(bits / 1e3, 0)} kbit/s`;
  }
  if (bytesPerSec >= 1e6) return `${num(bytesPerSec / 1e6)} MB/s`;
  return `${num(bytesPerSec / 1e3, 0)} kB/s`;
}

export function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} ${d === 1 ? 'Tag' : 'Tage'}, ${h} Std.`;
  if (h > 0) return `${h} Std., ${m} Min.`;
  return `${m} Min.`;
}

export const count = (v: number) => v.toLocaleString('de-DE');

/** Datum und Uhrzeit in der eingestellten Zeitzone, z. B. „25.11., 14:03“. */
export function dateTime(ms: number, timeZone?: string): string {
  return new Date(ms).toLocaleString('de-DE', { timeZone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
