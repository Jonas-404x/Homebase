import path from 'node:path';
import { MainframeError } from './errors.ts';

export interface Config {
  dataRoot: string;
  port: number;
  dev: boolean;
  catalogDir: string;
  webDistDir: string | null;
  /** Ordner, der als Netzwerkfreigabe sichtbar wird. */
  shareRoot: string;
  /** Einhängepunkt der Festplatte, auf der shareRoot liegt. */
  shareMount: string;
}

/** Wurzel des Repos (apps/server/src → ../../..). */
export const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dev = env.MAINFRAME_DEV === '1';

  let port = dev ? 8787 : 80;
  if (env.MAINFRAME_PORT !== undefined) {
    port = Number(env.MAINFRAME_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new MainframeError('config_invalid', `MAINFRAME_PORT ist kein gültiger Port: ${env.MAINFRAME_PORT}`);
    }
  }

  const dataRoot = path.resolve(env.MAINFRAME_DATA_ROOT ?? (dev ? path.join(repoRoot, '.data') : '/srv/mainframe'));
  const catalogDir = path.resolve(env.MAINFRAME_CATALOG_DIR ?? path.join(repoRoot, 'catalog'));
  const webDistDir = env.MAINFRAME_WEB_DIST ? path.resolve(env.MAINFRAME_WEB_DIST) : null;

  const shareRoot = path.posix.resolve(env.MAINFRAME_SHARE_ROOT ?? '/mnt/hdd/Mainframe');
  const shareMount = path.posix.resolve(env.MAINFRAME_SHARE_MOUNT ?? '/mnt/hdd');

  return { dataRoot, port, dev, catalogDir, webDistDir, shareRoot, shareMount };
}
