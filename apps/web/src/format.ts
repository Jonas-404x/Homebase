const GB = 1024 ** 3;

const num = (v: number, digits = 1) =>
  v.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const percent = (v: number) => `${num(v)} %`;

export const gb = (bytes: number) => num(bytes / GB);

export const usedOfTotal = (used: number, total: number) => `${gb(used)} / ${gb(total)} GB`;

export function rate(bytesPerSec: number): string {
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
