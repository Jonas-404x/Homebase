import { lookup } from 'node:dns/promises';
import type { Prefs, ServiceStatus, SystemStats } from '@mainframe/shared';
import type { AppEngine } from '../apps/engine.ts';
import { MainframeError } from '../errors.ts';
import { probe } from '../internet/watcher.ts';
import { checkUrl, type CheckResult } from '../services/checker.ts';
import { within } from '../util/within.ts';
import type { AppFacts } from './app.ts';
import type { SystemFacts } from './system.ts';

export interface DiagnoseDeps {
  probe: () => Promise<CheckResult>;
  lookup: (host: string) => Promise<void>;
  checkUrl: (url: string) => Promise<CheckResult>;
}

export const realDiagnoseDeps: DiagnoseDeps = {
  probe,
  lookup: async (host) => { await lookup(host); },
  checkUrl,
};

interface Sources {
  engine?: AppEngine;
  stats: () => Promise<SystemStats>;
  services: () => Promise<ServiceStatus[]>;
  thresholds: () => Prefs['thresholds'];
  deps: DiagnoseDeps;
}

const SOURCE_TIMEOUT_MS = 5000;
const TIMEOUT: CheckResult = { ok: false, ms: null, reason: 'Zeitüberschreitung' };

export async function gatherAppFacts(id: string, src: Sources): Promise<AppFacts> {
  const engine = src.engine;
  if (!engine) throw new MainframeError('not_installed', 'Diese App ist nicht installiert.', 404);
  const statsPromise = within(src.stats(), null, SOURCE_TIMEOUT_MS);
  const [apps, docker] = await Promise.all([
    within(engine.list(), [], SOURCE_TIMEOUT_MS),
    within(engine.dockerStatus(), { ok: false, message: null }, SOURCE_TIMEOUT_MS),
  ]);
  const app = apps.find((a) => a.id === id);
  if (!app) throw new MainframeError('not_installed', 'Diese App ist nicht installiert.', 404);
  const [inspect, usage, web, stats] = await Promise.all([
    docker.ok ? within(engine.inspect(id), null, SOURCE_TIMEOUT_MS) : null,
    docker.ok ? within(engine.usage(), [], SOURCE_TIMEOUT_MS).then((all) => all.find((u) => u.appId === id) ?? null) : null,
    docker.ok && app.webUiUrl && app.state === 'running'
      ? within(src.deps.checkUrl(`http://127.0.0.1${app.webUiUrl}`), TIMEOUT, SOURCE_TIMEOUT_MS)
      : null,
    statsPromise,
  ]);
  return { app, dockerOk: docker.ok, inspect, web, stats, thresholds: src.thresholds(), usage };
}

export async function gatherSystemFacts(src: Sources): Promise<SystemFacts> {
  const [docker, apps, services, internet, dns, stats] = await Promise.all([
    src.engine ? within(src.engine.dockerStatus(), { ok: false, message: null }, SOURCE_TIMEOUT_MS) : null,
    src.engine ? within(src.engine.list(), [], SOURCE_TIMEOUT_MS) : [],
    within(src.services(), [], SOURCE_TIMEOUT_MS),
    within(src.deps.probe(), TIMEOUT, SOURCE_TIMEOUT_MS),
    within(src.deps.lookup('cloudflare.com').then(
      () => ({ ok: true, reason: null }),
      (err: unknown) => ({ ok: false, reason: (err as { code?: string } | null)?.code ?? 'Fehler' }),
    ), { ok: false, reason: 'Zeitüberschreitung' }, 3000),
    within(src.stats(), null, SOURCE_TIMEOUT_MS),
  ]);
  return { dockerOk: docker?.ok ?? null, apps, services, internet, dns, stats, thresholds: src.thresholds() };
}
