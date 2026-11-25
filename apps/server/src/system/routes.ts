import type { FastifyInstance } from 'fastify';
import { MainframeError } from '../errors.ts';
import type { PrefsStore } from '../prefs/store.ts';
import type { WsHub } from '../ws/hub.ts';
import { createHistory } from './history.ts';
import type { StatsProvider } from './stats.ts';

export interface SystemRouteOptions {
  /** Fester Takt für Live-Werte (Tests). Ohne Angabe gilt die Einstellung liveIntervalSec. */
  intervalMs?: number;
  /** Takt für den Verlauf. 0 schaltet ihn ab. */
  historySampleMs?: number;
}

const HISTORY_MINUTES = new Set([15, 60, 360]);

/** Stats per HTTP, Live-Schleife (nur solange jemand zuschaut) und Verlauf (läuft immer). */
export function registerSystemRoutes(app: FastifyInstance, hub: WsHub, stats: StatsProvider, prefs: PrefsStore, opts: SystemRouteOptions = {}): void {
  const history = createHistory();
  app.get('/api/system/stats', async () => stats());
  app.get<{ Querystring: { minutes?: string } }>('/api/system/history', async (req) => {
    const minutes = Number(req.query.minutes ?? 60);
    if (!HISTORY_MINUTES.has(minutes)) throw new MainframeError('invalid_input', 'Zeitraum: 15, 60 oder 360 Minuten.', 400);
    return history.query(minutes);
  });

  const sampleMs = opts.historySampleMs ?? 5000;
  const sampler =
    sampleMs > 0
      ? setInterval(async () => {
          try {
            history.add(Date.now(), await stats());
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
