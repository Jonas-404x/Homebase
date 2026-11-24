export interface AdguardStats {
  queriesToday: number;
  blockedToday: number;
  blockedPercent: number;
  protectionEnabled: boolean;
}

export interface AdguardClient {
  stats(): Promise<AdguardStats>;
  setProtection(enabled: boolean): Promise<void>;
}

export function createAdguardClient(opts: { baseUrl: string; user: string; password: string; fetchImpl?: typeof fetch }): AdguardClient {
  const f = opts.fetchImpl ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.user}:${opts.password}`).toString('base64')}`;

  const call = async <T>(p: string, init: RequestInit = {}): Promise<T> => {
    const res = await f(`${opts.baseUrl}${p}`, {
      ...init,
      headers: { authorization: auth, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`AdGuard ${p}: HTTP ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  };

  return {
    async stats() {
      const [s, st] = await Promise.all([
        call<{ num_dns_queries: number; num_blocked_filtering: number }>('/control/stats'),
        call<{ protection_enabled: boolean }>('/control/status'),
      ]);
      const q = s.num_dns_queries ?? 0;
      const b = s.num_blocked_filtering ?? 0;
      return {
        queriesToday: q,
        blockedToday: b,
        blockedPercent: q > 0 ? Math.round((b / q) * 1000) / 10 : 0,
        protectionEnabled: Boolean(st.protection_enabled),
      };
    },
    async setProtection(enabled) {
      await call('/control/protection', { method: 'POST', body: JSON.stringify({ enabled }) });
    },
  };
}
