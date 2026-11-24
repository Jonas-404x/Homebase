import type { FastifyInstance } from 'fastify';
import type { WsHub } from '../ws/hub.ts';
import type { StatsProvider } from './stats.ts';

/** HTTP-Route für Stats und die Mess-Schleife, die nur läuft, solange jemand zuschaut. */
export function registerSystemRoutes(app: FastifyInstance, hub: WsHub, stats: StatsProvider, intervalMs: number): void {
  app.get('/api/system/stats', async () => stats());

  let timer: NodeJS.Timeout | null = null;
  const tick = async () => {
    try {
      hub.broadcast({ type: 'stats', data: await stats() });
    } catch (err) {
      app.log.warn({ err }, 'Stats konnten nicht gelesen werden');
    }
  };
  hub.onFirstClient(() => {
    void tick();
    timer = setInterval(tick, intervalMs);
  });
  hub.onNoClients(() => {
    if (timer) clearInterval(timer);
    timer = null;
  });
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
}
