import type { FastifyInstance } from 'fastify';
import { MainframeError } from '../errors.ts';
import type { Db } from '../db.ts';
import type { PrefsStore } from '../prefs/store.ts';
import type { WsHub } from '../ws/hub.ts';
import { cached, createSystemSource, type SystemSource } from './details.ts';
import type { EventLog } from './events.ts';
import { createHistory } from './history.ts';
import { createWarner } from './warnings.ts';
import type { StatsProvider } from './stats.ts';

export interface SystemRouteOptions {
  /** Fester Takt für Live-Werte (Tests). Ohne Angabe gilt die Einstellung liveIntervalSec. */
  intervalMs?: number;
  /** Takt für den Verlauf. 0 schaltet ihn ab. */
  historySampleMs?: number;
  db: Db;
  events?: EventLog;
  system?: SystemSource;
}

const HISTORY_MINUTES = new Set([1, 15, 60, 360, 1440, 4320, 10080]);
const TOP_PROCESSES = 15;

/** Stats per HTTP, Live-Schleife (nur solange jemand zuschaut) und Verlauf (läuft immer). */
export function registerSystemRoutes(app: FastifyInstance, hub: WsHub, stats: StatsProvider, prefs: PrefsStore, opts: SystemRouteOptions): void {
  const history = createHistory(opts.db);
  const source = opts.system ?? createSystemSource();
  const processes = cached(() => source.processes(), 3000);
  const warn = opts.events ? createWarner(opts.events) : null;
  app.get('/api/system/stats', async () => stats());
  app.get<{ Querystring: { minutes?: string; points?: string } }>('/api/system/history', async (req) => {
    const minutes = Number(req.query.minutes ?? 60);
    const points = Number(req.query.points ?? 120);
    if (!HISTORY_MINUTES.has(minutes)) throw new MainframeError('invalid_input', 'Diesen Zeitraum gibt es nicht.', 400);
    if (!Number.isInteger(points) || points < 2 || points > 500) throw new MainframeError('invalid_input', 'Punkte: 2 bis 500.', 400);
    return history.query(minutes, points);
  });
  const details = cached(() => source.details(), 3000);
  app.get('/api/system/details', async () => details());
  app.get<{ Querystring: { sort?: string } }>('/api/system/processes', async (req) => {
    const sort = req.query.sort ?? 'cpu';
    if (sort !== 'cpu' && sort !== 'memory') throw new MainframeError('invalid_input', 'Sortierung: cpu oder memory.', 400);
    const list = await processes();
    return [...list].sort((a, b) => (sort === 'cpu' ? b.cpuPercent - a.cpuPercent : b.memBytes - a.memBytes)).slice(0, TOP_PROCESSES);
  });

  const sampleMs = opts.historySampleMs ?? 10_000;
  const sampler =
    sampleMs > 0
      ? setInterval(async () => {
          try {
            const s = await stats();
            history.add(Date.now(), s);
            warn?.(s, prefs.get().thresholds);
          } catch {
            // Einzelne Aussetzer sind egal, der nächste Takt versucht es wieder.
          }
        }, sampleMs)
      : null;
  sampler?.unref();

  const interval = () => opts.intervalMs ?? prefs.get().liveIntervalSec * 1000;
  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    try {
      hub.broadcast({ type: 'stats', data: await stats() });
    } catch (err) {
      app.log.warn({ err }, 'Stats konnten nicht gelesen werden');
    }
  };
  const start = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, interval());
  };
  hub.onFirstClient(() => {
    void tick();
    start();
  });
  hub.onNoClients(() => {
    if (timer) clearInterval(timer);
    timer = null;
  });
  prefs.onChange(() => {
    if (timer) start();
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    if (sampler) clearInterval(sampler);
  });
}
