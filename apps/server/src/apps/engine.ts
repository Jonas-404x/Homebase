import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppState, CatalogApp, InstalledApp } from '@mainframe/shared';
import { renderCompose, resolveValues } from '../catalog/render.ts';
import type { CatalogEntry } from '../catalog/loader.ts';
import type { Config } from '../config.ts';
import { MainframeError } from '../errors.ts';
import type { ComposeRunner } from './compose-runner.ts';
import type { DockerStatus } from './docker-status.ts';
import type { AppStateFile, StateStore } from './state-store.ts';

export interface AppHook {
  beforeUp?: (ctx: { appDataDir: string; values: Record<string, string> }) => Promise<void>;
}

export interface AppEngine {
  catalog(): CatalogApp[];
  list(): Promise<InstalledApp[]>;
  install(id: string, input: Record<string, unknown>): Promise<InstalledApp>;
  start(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  restart(id: string): Promise<void>;
  remove(id: string, opts: { deleteData: boolean }): Promise<void>;
  followLogs(id: string, onLine: (line: string) => void): Promise<() => void>;
  values(id: string): Promise<Record<string, string>>;
  dockerStatus(): Promise<{ ok: boolean; message: string | null }>;
  hooks: Map<string, AppHook>;
}

export const DOCKER_DOWN_MESSAGE = 'Docker läuft gerade nicht. Starte Docker Desktop und lad die Seite neu.';

/** Übersetzt typische docker-compose-Fehler in verständliche Sätze. */
export function explainComposeError(raw: string): string {
  if (/port is already allocated|ports are not available|address already in use|Only one usage of each socket/i.test(raw)) {
    const port = raw.match(/0\.0\.0\.0:(\d+)/)?.[1] ?? raw.match(/:(\d+)\b/)?.[1];
    return port ? `Port ${port} ist schon belegt. Nimm einen anderen Port.` : 'Ein Port ist schon belegt. Nimm einen anderen Port.';
  }
  const lastLine = raw.trim().split(/\r?\n/).at(-1) ?? raw;
  return `Das hat nicht geklappt: ${lastLine}`;
}

function deriveState(containers: { state: string }[] | undefined, lastError: string | null): AppState {
  const list = containers ?? [];
  if (list.some((c) => c.state === 'restarting')) return 'restarting';
  if (list.length > 0 && list.every((c) => c.state === 'running')) return 'running';
  if (lastError) return 'error';
  return 'stopped';
}

export function createAppEngine(deps: {
  config: Config;
  catalog: CatalogEntry[];
  compose: ComposeRunner;
  docker: DockerStatus;
  store: StateStore;
}): AppEngine {
  const { config, catalog, compose, docker, store } = deps;
  const hooks = new Map<string, AppHook>();
  const installing = new Set<string>();
  const appDir = (id: string) => path.join(config.dataRoot, 'apps', id);

  const entryOf = (id: string): CatalogEntry => {
    const e = catalog.find((c) => c.app.id === id);
    if (!e) throw new MainframeError('unknown_app', `Die App "${id}" gibt es nicht im Katalog.`, 404);
    return e;
  };

  const assertDocker = async () => {
    if (!(await docker.ping())) throw new MainframeError('docker_down', DOCKER_DOWN_MESSAGE, 503);
  };

  const installed = async (id: string): Promise<AppStateFile> => {
    const s = await store.get(id);
    if (!s) throw new MainframeError('not_installed', 'Diese App ist nicht installiert.', 404);
    return s;
  };

  const toInstalled = (s: AppStateFile, containers: Map<string, { state: string }[]> | null): InstalledApp => {
    const app = catalog.find((c) => c.app.id === s.id)?.app;
    const port = app?.webUi ? s.values[app.webUi.portKey] : undefined;
    const base = {
      id: s.id,
      name: app?.name ?? s.id,
      webUiUrl: app?.webUi && port ? `:${port}${app.webUi.path}` : null,
      installedAt: s.installedAt,
    };
    if (installing.has(s.id)) return { ...base, state: 'installing', error: null };
    if (!containers) return { ...base, state: 'error', error: DOCKER_DOWN_MESSAGE };
    const state = deriveState(containers.get(s.id), s.lastError);
    return { ...base, state, error: state === 'error' ? s.lastError : null };
  };

  const list = async (): Promise<InstalledApp[]> => {
    const states = await store.list();
    let containers: Map<string, { state: string }[]> | null = null;
    try {
      containers = await docker.containersByApp();
    } catch {
      containers = null;
    }
    return states.map((s) => toInstalled(s, containers));
  };

  const action = (fn: (dir: string) => Promise<void>) => async (id: string) => {
    const s = await installed(id);
    await assertDocker();
    try {
      await fn(appDir(id));
    } catch (err) {
      throw new MainframeError('action_failed', explainComposeError(err instanceof Error ? err.message : String(err)), 500);
    }
    if (s.lastError) await store.save({ ...s, lastError: null });
  };

  return {
    hooks,
    // Ports mit dem Standard, der in dieser Umgebung wirklich gilt (Dev: devDefault).
    catalog: () =>
      catalog.map((c) => ({
        ...c.app,
        ports: c.app.ports.map((p) => ({ ...p, default: config.dev && p.devDefault ? p.devDefault : p.default })),
      })),
    list,

    async install(id, input) {
      const entry = entryOf(id);
      if (await store.get(id)) throw new MainframeError('already_installed', `${entry.app.name} ist schon installiert.`, 409);
      await assertDocker();

      const values = resolveValues(entry.app, input, config.dev);
      const dir = appDir(id);
      const dataDir = path.join(dir, 'data');
      const existedBefore = await fs.stat(dir).then(() => true, () => false);
      await fs.mkdir(dataDir, { recursive: true });

      installing.add(id);
      try {
        await hooks.get(id)?.beforeUp?.({ appDataDir: dataDir, values });
        const yml = renderCompose(entry.composeTemplate, values, { appId: id, appDataDir: dataDir, dev: config.dev });
        await fs.writeFile(path.join(dir, 'docker-compose.yml'), yml);
        const state: AppStateFile = { id, values, installedAt: new Date().toISOString(), lastError: null };
        await store.save(state);
        try {
          await compose.up(dir);
        } catch (err) {
          const message = explainComposeError(err instanceof Error ? err.message : String(err));
          // Komplett zurückrollen, damit man direkt mit anderen Werten neu installieren kann.
          await compose.down(dir).catch(() => {});
          if (existedBefore) {
            await store.remove(id);
            await fs.rm(path.join(dir, 'docker-compose.yml'), { force: true });
          } else {
            await fs.rm(dir, { recursive: true, force: true });
          }
          throw new MainframeError('install_failed', message, 500);
        }
      } finally {
        installing.delete(id);
      }
      const now = (await list()).find((a) => a.id === id);
      return now!;
    },

    start: action((d) => compose.start(d)),
    stop: action((d) => compose.stop(d)),
    restart: action((d) => compose.restart(d)),

    async remove(id, opts) {
      await installed(id);
      await assertDocker();
      const dir = appDir(id);
      await compose.down(dir, { volumes: opts.deleteData }).catch(() => {});
      if (opts.deleteData) {
        await fs.rm(dir, { recursive: true, force: true });
      } else {
        await store.remove(id);
        await fs.rm(path.join(dir, 'docker-compose.yml'), { force: true });
      }
    },

    async followLogs(id, onLine) {
      await installed(id);
      await assertDocker();
      return docker.followLogs(id, onLine);
    },

    async values(id) {
      return (await installed(id)).values;
    },

    async dockerStatus() {
      const ok = await docker.ping();
      return { ok, message: ok ? null : DOCKER_DOWN_MESSAGE };
    },
  };
}
