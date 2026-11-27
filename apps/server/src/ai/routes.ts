import type { FastifyInstance } from 'fastify';
import type { AiSettingsView } from '@mainframe/shared';
import { MainframeError } from '../errors.ts';
import type { AiEngine } from './engine.ts';
import type { AiConfig } from './settings.ts';

const limited = {
  rateLimit: {
    max: 5,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new MainframeError('too_many_attempts', 'Zu viele Versuche, warte kurz.', 429),
  },
};

/** Einstellungen → KI. Der Schlüssel geht nur hinein, nie heraus. */
export function registerAiRoutes(app: FastifyInstance, opts: { config: AiConfig; ai: AiEngine; onChange: () => void }): void {
  const { config, ai } = opts;
  const view = (): AiSettingsView => {
    const s = config.get();
    return {
      enabled: config.enabled(),
      enabledSetting: s.enabled,
      model: s.model,
      sendLogs: s.sendLogs,
      dailyLimit: s.dailyLimit,
      hasKey: config.hasKey(),
      usedToday: ai.usedToday(),
      ...ai.state(),
    };
  };

  app.get('/api/ai/settings', async () => view());

  app.patch('/api/ai/settings', async (req) => {
    config.update(req.body);
    opts.onChange();
    return view();
  });

  app.put<{ Body: { key?: unknown } }>('/api/ai/key', { config: limited }, async (req, reply) => {
    config.setKey(req.body?.key);
    opts.onChange();
    return reply.code(204).send();
  });

  app.delete('/api/ai/key', async (_req, reply) => {
    config.clearKey();
    opts.onChange();
    return reply.code(204).send();
  });

  app.post('/api/ai/test', { config: limited }, async () => ai.test());
}
