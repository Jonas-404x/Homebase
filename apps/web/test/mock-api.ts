import { vi } from 'vitest';

type Handler = (body: unknown) => { status?: number; json?: unknown };

/** Ersetzt fetch durch eine Tabelle "METHODE /pfad" → Antwort. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = init?.body;
    // JSON-Bodies auslesen, Dateien (Uploads) unverändert lassen.
    if (typeof body === 'string') body = JSON.parse(body);
    const key = `${method} ${url.pathname}${url.search}`;
    calls.push({ method, path: `${url.pathname}${url.search}`, body });
    const h = routes[key] ?? routes[`${method} ${url.pathname}`];
    if (!h) return new Response(JSON.stringify({ code: 'not_found', message: key }), { status: 404 });
    const r = h(body);
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.json ?? {}), { status });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}
