import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { InstalledApp, ServiceStatus } from '@mainframe/shared';
import type { AppEngine } from '../apps/engine.ts';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import type { PrefsStore } from '../prefs/store.ts';
import type { EventLog } from '../system/events.ts';
import { createChecker, type Target } from './checker.ts';
import { createServiceStore } from './store.ts';

const DAY = 24 * 3600_000;
const KEEP = 7 * DAY;
const BARS = 48;

function checkName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (name.length < 1 || name.length > 40) throw new MainframeError('invalid_input', 'Name: 1 bis 40 Zeichen.', 400);
  return name;
}

function checkLinkUrl(raw: unknown): string {
  const url = typeof raw === 'string' ? raw.trim() : '';
  let u: URL | null = null;
  try {
    u = url.length <= 300 ? new URL(url) : null;
  } catch {
    u = null;
  }
  const ok = u && ((u.protocol === 'http:' || u.protocol === 'https:') ? Boolean(u.hostname) : u.protocol === 'tcp:' && Boolean(u.hostname) && Number(u.port) > 0);
  if (!ok) throw new MainframeError('invalid_input', 'Adresse: http://…, https://… oder tcp://rechner:port', 400);
  return url;
}

/** Was am Container schon ohne Netzprüfung als gestört erkennbar ist. */
function containerProblem(a: InstalledApp): string | null {
  if (a.state === 'restarting') return 'Container startet ständig neu';
  if (a.state === 'error') return 'Container gestoppt';
  if (a.health === 'unhealthy') return 'Container meldet „ungesund“';
  return null;
}

const percent = (s: { total: number; ok: number }) => (s.total === 0 ? null : Math.round((s.ok / s.total) * 1000) / 10);

/** Dienste-Seite: installierte Apps und eigene Links, regelmäßig auf Erreichbarkeit geprüft. */
export function registerServiceRoutes(app: FastifyInstance, opts: { db: Db; prefs: PrefsStore; events?: EventLog; engine?: AppEngine; intervalMs?: number }): { list: () => Promise<ServiceStatus[]> } {
  const store = createServiceStore(opts.db);

  const all = async (): Promise<(Target & { stopped: boolean; pending: boolean })[]> => {
    const apps = opts.engine ? await opts.engine.list().catch(() => []) : [];
    return [
      ...apps
        .filter((a) => a.webUiUrl)
        .map((a) => ({
          id: `app:${a.id}`,
          name: a.name,
          url: `http://127.0.0.1${a.webUiUrl}`,
          kind: 'app' as const,
          stopped: a.state === 'stopped',
          blocked: containerProblem(a),
          // Healthcheck noch nicht durch: weder "funktioniert" noch "kaputt", sondern noch offen.
          pending: a.state === 'running' && a.health === 'starting',
        })),
      ...store.listLinks().map((l) => ({ id: `link:${l.id}`, name: l.name, url: l.url, kind: 'link' as const, stopped: false, blocked: null, pending: false })),
    ];
  };
  const checker = createChecker({ store, events: opts.events, targets: async () => (await all()).filter((t) => !t.stopped) });

  const list = async (): Promise<ServiceStatus[]> => {
    const now = Date.now();
    return (await all()).map((t) => {
      const last = t.stopped ? null : store.last(t.id);
      // Ein gestörter Container zählt sofort, nicht erst nach der nächsten Prüfrunde.
      const up = t.stopped || (t.pending && !t.blocked) ? null : t.blocked ? false : last ? last.ok : null;
      return {
        id: t.id,
        name: t.name,
        url: t.url,
        kind: t.kind,
        up,
        ms: up ? (last?.ms ?? null) : null,
        reason: up !== false ? null : (t.blocked ?? checker.reason(t.id)),
        stopped: t.stopped,
        uptime24h: percent(store.summary(t.id, now - DAY)),
        uptime7d: percent(store.summary(t.id, now - KEEP)),
        bars: store.bars(t.id, now - DAY, now, BARS),
      };
    });
  };
  app.get('/api/services', list);

  // Prüfen im Hintergrund; ein Fehler (z. B. Datenbank beim Beenden schon zu) darf den Server nicht beenden.
  const recheck = () => void checker.runOnce().catch(() => {});

  app.post<{ Body: { name?: unknown; url?: unknown } }>('/api/services/links', async (req, reply) => {
    const link = { id: randomBytes(6).toString('hex'), name: checkName(req.body?.name), url: checkLinkUrl(req.body?.url), createdAt: Date.now() };
    store.addLink(link);
    recheck();
    return reply.code(201).send(link);
  });

  app.patch<{ Params: { id: string }; Body: { name?: unknown; url?: unknown } }>('/api/services/links/:id', async (req, reply) => {
    const patch = {
      ...(req.body?.name !== undefined ? { name: checkName(req.body.name) } : {}),
      ...(req.body?.url !== undefined ? { url: checkLinkUrl(req.body.url) } : {}),
    };
    const before = store.listLinks().find((l) => l.id === req.params.id);
    if (!store.updateLink(req.params.id, patch)) throw new MainframeError('not_found', 'Diesen Link gibt es nicht.', 404);
    if (patch.url !== undefined && patch.url !== before?.url) {
      store.clearChecks(`link:${req.params.id}`);
      checker.forget(`link:${req.params.id}`);
      recheck();
    }
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string } }>('/api/services/links/:id', async (req, reply) => {
    if (!store.deleteLink(req.params.id)) throw new MainframeError('not_found', 'Diesen Link gibt es nicht.', 404);
    store.clearChecks(`link:${req.params.id}`);
    return reply.code(204).send();
  });

  // Regelmäßige Prüfung, Takt aus den Einstellungen; 0 schaltet sie ab (Tests).
  const interval = () => opts.intervalMs ?? opts.prefs.get().checkIntervalSec * 1000;
  let timer: NodeJS.Timeout | null = null;
  const start = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (interval() <= 0) return;
    timer = setInterval(() => {
      recheck();
      try {
        store.prune(Date.now() - KEEP);
      } catch {
        // nächste Runde
      }
    }, interval());
    timer.unref();
  };
  start();
  opts.prefs.onChange(start);
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
  return { list };
}
