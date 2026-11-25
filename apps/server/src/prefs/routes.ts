import type { FastifyInstance } from 'fastify';
import type { WsHub } from '../ws/hub.ts';
import type { PrefsStore } from './store.ts';

export function registerPrefsRoutes(app: FastifyInstance, prefs: PrefsStore, hub: WsHub): void {
  prefs.onChange((data) => hub.broadcast({ type: 'prefs', data }));
  app.get('/api/prefs', async () => prefs.get());
  app.put('/api/prefs', async (req) => prefs.update(req.body));
}
