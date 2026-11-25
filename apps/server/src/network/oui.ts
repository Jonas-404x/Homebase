import fs from 'node:fs';
import path from 'node:path';

const OUI_URL = 'https://standards-oui.ieee.org/oui/oui.csv';

/** Liest die Hersteller-Liste der IEEE (CSV) in eine Tabelle „3CA62F“ → „AVM GmbH“. */
export function parseOui(csv: string): Map<string, string> {
  const map = new Map<string, string>();
  const line = /^MA-L,([0-9A-F]{6}),(?:"([^"]*)"|([^,\r\n]*))/gm;
  for (const m of csv.matchAll(line)) map.set(m[1]!, (m[2] ?? m[3] ?? '').trim());
  return map;
}

/**
 * Hersteller aus den ersten drei Bytes der MAC-Adresse. Die Liste wird beim ersten Scan einmal
 * von der IEEE geladen und im Datenordner gespeichert; klappt das nicht, bleibt der Hersteller leer.
 */
export function createOui(dataRoot: string, fetchFn: typeof fetch = fetch) {
  const file = path.join(dataRoot, 'oui.csv');
  let map: Map<string, string> | null = null;
  let loading: Promise<void> | null = null;
  return {
    ready(): Promise<void> {
      if (map) return Promise.resolve();
      loading ??= (async () => {
        try {
          if (!fs.existsSync(file)) {
            const res = await fetchFn(OUI_URL, { signal: AbortSignal.timeout(30_000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            fs.writeFileSync(file, await res.text());
          }
          map = parseOui(fs.readFileSync(file, 'utf8'));
        } catch {
          // Ohne Liste geht es auch, nur ohne Herstellernamen. Beim nächsten Scan neuer Versuch.
        } finally {
          loading = null;
        }
      })();
      return loading;
    },
    lookup: (mac: string): string | null => map?.get(mac.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase()) ?? null,
  };
}
