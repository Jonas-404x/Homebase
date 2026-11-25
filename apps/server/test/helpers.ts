import type { FastifyInstance } from 'fastify';
import type { Config } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import type { AppDeps } from '../src/app.ts';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { dataRoot: '/tmp/mf-test', port: 0, dev: true, catalogDir: '/tmp/mf-catalog', webDistDir: null, ...overrides };
}

export function testDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  // Hintergrund-Prüfungen aus, damit kein Test das echte Netzwerk anfasst.
  return { config: testConfig(), db: openDb(':memory:'), checkIntervalMs: 0, scanIntervalMs: 0, internetIntervalMs: 0, ...overrides };
}

/** Holt "mf_session=…" aus einer Antwort. */
export function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [String(raw)];
  const c = list.find((v) => String(v).startsWith('mf_session='));
  if (!c) throw new Error('kein mf_session-Cookie');
  return String(c).split(';')[0]!;
}

/** Legt das Passwort fest und gibt das Session-Cookie zurück. */
export async function setupAndLogin(app: FastifyInstance, password = 'geheim123', username = 'jonas'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { username, password } });
  if (res.statusCode !== 204) throw new Error(`setup fehlgeschlagen: ${res.statusCode} ${res.body}`);
  return sessionCookie(res);
}
