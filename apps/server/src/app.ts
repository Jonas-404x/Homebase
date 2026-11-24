import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ApiError } from '@homebase/shared';
import { registerAuthGuard } from './auth/plugin.ts';
import { registerAuthRoutes } from './auth/routes.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { HomebaseError } from './errors.ts';

export interface AppDeps {
  config: Config;
  db: Db;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.dev ? false : { level: 'info' } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HomebaseError) {
      return reply.code(err.status).send({ code: err.code, message: err.message } satisfies ApiError);
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ code: 'invalid_request', message: 'Die Anfrage war ungültig.' } satisfies ApiError);
    }
    req.log.error(err);
    return reply.code(500).send({ code: 'internal', message: 'Da ist was schiefgelaufen.' } satisfies ApiError);
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerAuthGuard(app, deps.db);
  registerAuthRoutes(app, deps.db);

  return app;
}
