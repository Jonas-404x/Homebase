/** Macht aus einem User-Agent einen lesbaren Gerätenamen wie „Safari auf iPhone“. */
export function describeDevice(ua: string): string {
  if (!ua) return 'Unbekanntes Gerät';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS/.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS/.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  if (!os && !browser) return 'Unbekanntes Gerät';
  if (!os) return browser!;
  if (!browser) return os;
  return `${browser} auf ${os}`;
}
