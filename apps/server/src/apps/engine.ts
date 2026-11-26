import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppState, AppUsage, CatalogApp, InstalledApp } from '@mainframe/shared';
import { renderCompose, resolveValues } from '../catalog/render.ts';
import type { CatalogEntry } from '../catalog/loader.ts';
import type { Config } from '../config.ts';
import { MainframeError } from '../errors.ts';
import type { ComposeRunner } from './compose-runner.ts';
import type { AppInspect, DockerStatus, Health } from './docker-status.ts';
import { within } from '../util/within.ts';
import { diskByApp, dirSize } from './usage.ts';
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
  /** CPU, RAM und Speicher pro installierter App; ohne Docker eine leere Liste. */
  usage(): Promise<AppUsage[]>;
  /** Container-Zustand und letzte Log-Zeilen für die Diagnose. */
  inspect(id: string): Promise<AppInspect>;
  hooks: Map<string, AppHook>;
}

export const UNEXPECTED_EXIT_MESSAGE = 'Die App ist unerwartet beendet.';
/** Wie lange eine Docker-Abfrage höchstens dauern darf, bevor Docker als hängend gilt. */
const DOCKER_TIMEOUT_MS = 4000;

export const DOCKER_DOWN_MESSAGE = 'Docker läuft gerade nicht oder startet noch. Mainframe prüft das alle paar Sekunden von selbst.';

/** Übersetzt typische docker-compose-Fehler in verständliche Sätze. */
export function explainComposeError(raw: string): string {
  if (/port is already allocated|ports are not available|address already in use|Only one usage of each socket/i.test(raw)) {
    const port = raw.match(/0\.0\.0\.0:(\d+)/)?.[1] ?? raw.match(/:(\d+)\b/)?.[1];
    return port ? `Port ${port} ist schon belegt. Nimm einen anderen Port.` : 'Ein Port ist schon belegt. Nimm einen anderen Port.';
  }
  const lastLine = raw.trim().split(/\r?\n/).at(-1) ?? raw;
  return `Das hat nicht geklappt: ${lastLine}`;
}

type ContainerSummary = { state: string; health?: Health };

/** Schlechtester Healthcheck-Zustand aller Container; undefined, wenn keiner einen hat. */
function deriveHealth(containers: ContainerSummary[] | undefined): InstalledApp['health'] {
  const hs = (containers ?? []).map((c) => c.health).filter((h): h is NonNullable<Health> => Boolean(h));
  if (hs.includes('unhealthy')) return 'unhealthy';
  if (hs.includes('starting')) return 'starting';
  return hs.length > 0 ? 'healthy' : undefined;
}

function deriveState(containers: { state: string }[] | undefined, s: AppStateFile): { state: AppState; error: string | null } {
  const list = containers ?? [];
  if (list.some((c) => c.state === 'restarting')) return { state: 'restarting', error: null };
  if (list.length > 0 && list.every((c) => c.state === 'running')) return { state: 'running', error: null };
  if (s.lastError) return { state: 'error', error: s.lastError };
  // Nur was du selbst angehalten hast, ist "gestoppt"; sonst ist die App abgestürzt oder nach einem Neustart nicht hochgekommen.
  if (s.stoppedByUser) return { state: 'stopped', error: null };
  return { state: 'error', error: UNEXPECTED_EXIT_MESSAGE };
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
  // App-IDs landen in Dateipfaden: nur das Katalog-Format zulassen (kein "..", kein "/").
  const checkId = (id: string) => {
    if (!/^[a-z0-9-]+$/.test(id)) throw new MainframeError('unknown_app', 'Diese App gibt es nicht.', 404);
    return id;
  };
  const appDir = (id: string) => path.join(config.dataRoot, 'apps', checkId(id));

  const entryOf = (id: string): CatalogEntry => {
    const e = catalog.find((c) => c.app.id === id);
    if (!e) throw new MainframeError('unknown_app', `Die App "${id}" gibt es nicht im Katalog.`, 404);
    return e;
  };

  const assertDocker = async () => {
    if (!(await docker.ping())) throw new MainframeError('docker_down', DOCKER_DOWN_MESSAGE, 503);
  };

  const installed = async (id: string): Promise<AppStateFile> => {
    const s = await store.get(checkId(id));
    if (!s) throw new MainframeError('not_installed', 'Diese App ist nicht installiert.', 404);
    return s;
  };

  const toInstalled = (s: AppStateFile, containers: Map<string, ContainerSummary[]> | null): InstalledApp => {
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
    const { state, error } = deriveState(containers.get(s.id), s);
    const health = state === 'running' ? deriveHealth(containers.get(s.id)) : undefined;
    return { ...base, state, ...(health ? { health } : {}), error };
  };

  // Speicherbelegung ist langsam zu ermitteln (docker df, Ordner durchgehen): höchstens einmal pro Minute,
  // nie zweimal gleichzeitig, und eine Abfrage wartet höchstens kurz darauf (sonst alter Wert oder keiner).
  let disk: { at: number; ids: string; map: Map<string, number> } | null = null;
  let diskJob: Promise<void> | null = null;
  const refreshDisk = (ids: string[]): Promise<void> => {
    diskJob ??= (async () => {
      try {
        const df = await within(docker.df(), null, 30_000);
        if (!df) return;
        const dirs = new Map(await Promise.all(ids.map(async (id) => [id, await dirSize(appDir(id))] as const)));
        disk = { at: Date.now(), ids: ids.join(','), map: diskByApp(df, ids, dirs) };
      } catch {
        // alter Wert bleibt
      } finally {
        diskJob = null;
      }
    })();
    return diskJob;
  };
  const diskCached = async (ids: string[]): Promise<Map<string, number> | null> => {
    const fresh = disk !== null && disk.ids === ids.join(',') && Date.now() - disk.at < 60_000;
    if (!fresh) await within(refreshDisk(ids), undefined, 2000);
    return disk?.map ?? null;
  };

  const list = async (): Promise<InstalledApp[]> => {
    const states = await store.list();
    // Ein hängendes Docker zählt wie ein gestopptes: die Liste kommt trotzdem.
    const containers = await within<Map<string, ContainerSummary[]> | null>(docker.containersByApp(), null, DOCKER_TIMEOUT_MS);
    return states.map((s) => toInstalled(s, containers));
  };

  // stoppedByUser: true = du hältst die App an (schon vorher merken, damit sie währenddessen nicht als abgestürzt gilt).
  const action = (fn: (dir: string) => Promise<void>, stoppedByUser: boolean) => async (id: string) => {
    let s = await installed(id);
    await assertDocker();
    if (stoppedByUser && !s.stoppedByUser) {
      s = { ...s, stoppedByUser: true };
      await store.save(s);
    }
    try {
      await fn(appDir(id));
    } catch (err) {
      throw new MainframeError('action_failed', explainComposeError(err instanceof Error ? err.message : String(err)), 500);
    }
    if (s.lastError || Boolean(s.stoppedByUser) !== stoppedByUser) await store.save({ ...s, lastError: null, stoppedByUser });
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

    start: action((d) => compose.start(d), false),
    stop: action((d) => compose.stop(d), true),
    restart: action((d) => compose.restart(d), false),

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

    async usage() {
      const ids = (await store.list()).map((s) => s.id);
      if (ids.length === 0) return [];
      const live = await within<Map<string, { cpuPercent: number; memBytes: number }> | null>(docker.usage(), null, DOCKER_TIMEOUT_MS);
      if (!live) return [];
      const disk = await diskCached(ids);
      return ids.map((id) => ({
        appId: id,
        cpuPercent: live.get(id)?.cpuPercent ?? 0,
        memBytes: live.get(id)?.memBytes ?? 0,
        diskBytes: disk?.get(id) ?? null,
      }));
    },

    async inspect(id) {
      await installed(id);
      return docker.inspect(id);
    },
  };
}
