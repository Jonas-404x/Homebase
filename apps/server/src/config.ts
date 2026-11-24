import path from 'node:path';
import { HomebaseError } from './errors.ts';

export interface Config {
  dataRoot: string;
  port: number;
  dev: boolean;
  catalogDir: string;
  webDistDir: string | null;
}

/** Wurzel des Repos (apps/server/src → ../../..). */
export const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dev = env.HOMEBASE_DEV === '1';

  let port = dev ? 8787 : 80;
  if (env.HOMEBASE_PORT !== undefined) {
    port = Number(env.HOMEBASE_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new HomebaseError('config_invalid', `HOMEBASE_PORT ist kein gültiger Port: ${env.HOMEBASE_PORT}`);
    }
  }

  const dataRoot = path.resolve(env.HOMEBASE_DATA_ROOT ?? (dev ? path.join(repoRoot, '.data') : '/srv/homebase'));
  const catalogDir = path.resolve(env.HOMEBASE_CATALOG_DIR ?? path.join(repoRoot, 'catalog'));
  const webDistDir = env.HOMEBASE_WEB_DIST ? path.resolve(env.HOMEBASE_WEB_DIST) : null;

  return { dataRoot, port, dev, catalogDir, webDistDir };
}
