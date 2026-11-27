import type { KioskSnapshot } from '@mainframe/shared';

/**
 * Anmelden mit dem Schlüssel aus „#key=…“. Der Schlüssel steht nur im Fragment (geht nie als URL an
 * den Server und in kein Log) und wird danach aus der Adresse entfernt.
 */
export async function kioskLogin(hash: string, fetchFn: typeof fetch = fetch): Promise<'ok' | 'invalid' | 'none'> {
  const key = new URLSearchParams(hash.replace(/^#/, '')).get('key');
  if (!key) return 'none';
  const res = await fetchFn('/api/kiosk/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
    credentials: 'same-origin',
  });
  if (res.status !== 204) return 'invalid';
  // Erst nach dem Anmelden entfernen: ist der Server beim Start noch nicht da, braucht das Neuladen den Schlüssel.
  history.replaceState(null, '', '/monitor');
  return 'ok';
}

export async function fetchKioskSnapshot(fetchFn: typeof fetch = fetch): Promise<KioskSnapshot | 'unauthorized'> {
  const res = await fetchFn('/api/kiosk/snapshot', { credentials: 'same-origin' });
  if (res.status === 401) return 'unauthorized';
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  return (await res.json()) as KioskSnapshot;
}

export function kioskSocketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/api/kiosk/ws`;
}
