import os from 'node:os';
import type { StatusItem, StatusReport } from '@mainframe/shared';
import type { AppInspect } from '../apps/docker-status.ts';
import type { AppEngine } from '../apps/engine.ts';
import type { Db } from '../db.ts';
import type { AiEngine } from '../ai/engine.ts';
import { aiCard, baseFingerprint, buildHintFacts, buildStatusFacts, type AppLogFacts } from '../ai/facts.ts';
import type { AiConfig } from '../ai/settings.ts';
import { collectStatus } from '../status/collect.ts';
import { gatherStatus, type Gathered, type StatusSources } from '../status/routes.ts';
import { within } from '../util/within.ts';
import { createIncidentTracker, evaluateIncidents, pastIncidentTitle, type IncidentKind } from './incidents.ts';
import { detectNightSpikes, nightWindow, NIGHT_END_HOUR } from './night.ts';
import { dailyAverages, detectDiskFill, detectMemoryRise, detectRestartPatterns, type Hint, type HintKind } from './patterns.ts';
import { createRecorder, type UserAction } from './recorder.ts';
import { buildBlocklist, isMinecraft, minecraftOnline } from './scrub.ts';
import type { AiOverview } from '../ai/types.ts';
import type { HintRow, InsightsStore } from './store.ts';
import { dayKey, minuteOfDay } from './time.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const INSPECT_TIMEOUT_MS = 4000;
const NIGHT_KEY = 'insights_night_day';

export interface Insights {
  /** Ein Durchgang: Verlauf schreiben, Vorfälle abgleichen, Muster suchen, die KI füttern. */
  tick(): Promise<void>;
  /** Hängt Hinweise, offene Vorfälle und fertige KI-Texte an den Bericht der Regeln. Wartet nie. */
  decorate(report: StatusReport): StatusReport;
  markIncidentSeen(id: number): boolean;
  dismissHint(id: string): boolean;
  userAction(appId: string, action: UserAction): void;
  stop(): void;
}

const fromRow = (r: HintRow): Hint => {
  const { title, detail, ...facts } = r.facts;
  return { id: r.id, kind: r.kind as HintKind, title: String(title ?? ''), detail: String(detail ?? ''), facts };
};

const METRIC_PAGE: Record<string, string> = { cpu: '/details/cpu', memory: '/details/memory', temp: '/details/temperature' };

function hintItem(h: Hint): StatusItem {
  const base = { id: h.id, level: 'info' as const, title: h.title, detail: h.detail };
  switch (h.kind) {
    case 'restart-pattern':
      return { ...base, source: 'pattern', to: '/apps', diagnose: h.id.slice('pattern:restart:'.length) };
    case 'memory-rise':
      return { ...base, source: 'pattern', to: '/details/memory', diagnose: 'system' };
    case 'disk-fill':
      return { ...base, source: 'pattern', to: null, diagnose: 'system' };
    case 'night-spike':
      return { ...base, source: 'night', to: METRIC_PAGE[String(h.facts.metric)] ?? null, diagnose: null, dismissible: true };
    case 'past-incident':
      return { ...base, source: 'incident', to: null, diagnose: null, dismissible: true };
  }
}

/** Harmlose Eckdaten für den Kopfsatz, wenn alles läuft: grob gerundet, keine Namen. */
function overviewOf(g: Gathered, inspects: Map<string, AppInspect | null>): AiOverview | undefined {
  if (!g.stats) return undefined;
  const ten = (v: number) => Math.round(v / 10) * 10;
  const mem = g.stats.memory.totalBytes > 0 ? (g.stats.memory.usedBytes / g.stats.memory.totalBytes) * 100 : 0;
  const counts = g.apps.filter((a) => isMinecraft(a.id)).map((a) => minecraftOnline(inspects.get(a.id)?.logs ?? [])).filter((n): n is number => n !== null);
  return {
    uptimeHours: Math.round(g.stats.uptimeSeconds / 3600),
    runningApps: g.apps.filter((a) => a.state === 'running').length,
    cpuPercent: ten(g.stats.cpu.loadPercent),
    memoryPercent: ten(mem),
    ...(counts.length > 0 ? { minecraftPlayers: counts.reduce((x, y) => x + y, 0) } : {}),
  };
}

export function createInsights(opts: {
  db: Db;
  store: InsightsStore;
  sources: StatusSources;
  engine?: AppEngine;
  ai: AiEngine;
  config: AiConfig;
  /** Neue Vorfälle, Hinweise oder KI-Texte: offene Browser bekommen die Übersicht neu. */
  push: () => void;
  intervalMs: number;
  /** Wie lange ein Vorfall anstehen muss, bevor er zählt (Tests: 0). */
  incidentOpenAfterMs?: number;
  hostname?: string;
  now?: () => number;
}): Insights {
  const { db, store, sources, engine, ai, config } = opts;
  const now = opts.now ?? Date.now;
  const hostname = opts.hostname ?? os.hostname();
  const recorder = createRecorder({ store, now });
  const tracker = createIncidentTracker({ store, now, openAfterMs: opts.incidentOpenAfterMs });
  let patterns: Hint[] = [];
  let patternsAt = -Infinity;
  let prunedAt = -Infinity;
  let running = false;

  const allHints = (): Hint[] => [...patterns, ...store.activeHints(now()).map((r) => {
    const h = fromRow(r);
    if (h.kind !== 'past-incident' || typeof r.facts.openedAt !== 'number') return h;
    const f = { pastTitle: String(r.facts.pastTitle ?? ''), kind: String(r.facts.incident ?? ''), openedAt: r.facts.openedAt, minutes: Number(r.facts.minutes ?? 1) };
    return { ...h, title: pastIncidentTitle(f, now()) };
  })];

  const recomputePatterns = (names: Map<string, string>) => {
    const t = now();
    const memory = dailyAverages(db.queryStats(t - 8 * DAY, t, 8 * 24), t);
    patterns = [
      ...detectRestartPatterns(store.events(t - 7 * DAY), names, t),
      ...detectMemoryRise(memory),
      ...detectDiskFill(store.disk(t - 7 * DAY), t),
    ];
    patternsAt = t;
  };

  /** Einmal am Tag ab 7 Uhr: was war heute Nacht? */
  const checkNight = (names: Map<string, string>): boolean => {
    const t = now();
    if (minuteOfDay(t) < NIGHT_END_HOUR * 60 || db.getSetting(NIGHT_KEY) === dayKey(t)) return false;
    db.setSetting(NIGHT_KEY, dayKey(t));
    const win = nightWindow(t);
    const points = db.queryStats(win.start, win.end, Math.ceil((win.end - win.start) / 10_000));
    const usage = store.usage(win.start - 5 * MIN, win.end + 5 * MIN);
    const found = detectNightSpikes(points, usage, sources.prefs.get().thresholds, names, win);
    for (const h of found) store.putHint({ id: h.id, kind: h.kind, createdAt: t, expiresAt: t + DAY, facts: { title: h.title, detail: h.detail, ...h.facts } });
    return found.length > 0;
  };

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const g = await gatherStatus(sources);
      const report = collectStatus(g.input);
      const t = now();
      const names = new Map(g.apps.map((a) => [a.id, a.name]));

      const inspects = new Map<string, AppInspect | null>();
      if (engine && g.dockerOk) {
        await Promise.all(g.apps.map(async (a) => inspects.set(a.id, await within(engine.inspect(a.id).catch(() => null), null, INSPECT_TIMEOUT_MS))));
      }
      // Ohne Docker sieht jede App abgestürzt aus; das ist ein Docker-Vorfall, kein Absturz jeder App.
      if (g.dockerOk) recorder.observeApps(g.apps, inspects);
      else recorder.reset();
      if (engine && g.dockerOk && recorder.usageDue()) recorder.sampleUsage(await within(engine.usage().catch(() => []), [], INSPECT_TIMEOUT_MS));
      if (g.stats) recorder.sampleDisks(g.stats);
      if (t - prunedAt >= HOUR) {
        store.prune(t);
        prunedAt = t;
      }

      // Startest du AdGuard gerade selbst neu, ist das kein Vorfall.
      const current = evaluateIncidents({ dockerOk: g.dockerOk, apps: g.apps, services: g.services, stats: g.stats, thresholds: g.input.thresholds })
        .filter((c) => !(c.kind === 'adguard' && recorder.byUser('adguard')));
      // Keine Messwerte heißt nicht „wieder gut“: offene Platten- und Temperatur-Vorfälle bleiben, bis eine Messung das Gegenteil zeigt.
      if (!g.stats) {
        for (const i of store.openIncidents()) {
          if (i.kind !== 'disk' && i.kind !== 'temperature') continue;
          current.push({ key: i.key, kind: i.kind, title: String(i.facts.title ?? ''), detail: String(i.facts.detail ?? ''), pastTitle: String(i.facts.pastTitle ?? '') });
        }
      }
      const { changed } = tracker.update(current);
      if (t - patternsAt >= HOUR) recomputePatterns(names);
      const night = checkNight(names);

      if (config.enabled()) {
        // Sperrliste: Geräte, eigener Hostname, dein Benutzername, der KI-Schlüssel und geheime Werte der Apps (z. B. Passwörter).
        const secrets = [db.getSetting('admin_user'), config.key()].filter((v): v is string => Boolean(v));
        if (engine) {
          const secretFields = new Map(engine.catalog().map((c) => [c.id, c.fields.filter((f) => f.type === 'secret').map((f) => f.key)]));
          for (const a of g.apps) {
            const keys = secretFields.get(a.id) ?? [];
            if (keys.length === 0) continue;
            const values = await within(engine.values(a.id).catch(() => ({}) as Record<string, string>), {} as Record<string, string>, INSPECT_TIMEOUT_MS);
            for (const k of keys) if (values[k]) secrets.push(String(values[k]));
          }
        }
        const ctx = { blocklist: [...buildBlocklist(sources.devices(), hostname), ...secrets], players: [] };
        const apps = new Map<string, AppLogFacts>();
        for (const a of g.apps) {
          const info = inspects.get(a.id) ?? null;
          const failed = info?.containers.find((c) => c.state !== 'running' && c.exitCode !== 0);
          apps.set(a.id, { name: a.name, state: a.state, exitCode: failed ? failed.exitCode : null, logs: info?.logs ?? [] });
        }
        const incidents = store.openIncidents().filter((i) => !i.seen).map((i) => ({ id: String(i.id), key: i.key, title: String(i.facts.title ?? ''), detail: String(i.facts.detail ?? '') }));
        const sf = buildStatusFacts({ items: report.items, apps, incidents, ctx, sendLogs: config.get().sendLogs, overview: overviewOf(g, inspects) });
        const issues = sf.facts.cards.length > 0 || incidents.length > 0;
        ai.observeStatus({ fingerprint: sf.fingerprint, base: sf.base, facts: sf.facts, idMap: sf.idMap, issues, calm: !issues && report.level === 'ok' });
        const hints = allHints();
        if (hints.length > 0) ai.observeHints(buildHintFacts(hints, ctx));
      }
      if (changed || night) opts.push();
    } finally {
      running = false;
    }
  };

  const timer = opts.intervalMs > 0 ? setInterval(() => void tick().catch(() => {}), opts.intervalMs) : null;
  timer?.unref();
  // Erster Durchgang kurz nach dem Start, damit Vorfälle nicht erst nach einem vollen Takt auffallen.
  const first = opts.intervalMs > 0 ? setTimeout(() => void tick().catch(() => {}), Math.min(5000, opts.intervalMs)) : null;
  first?.unref();

  return {
    tick,
    decorate(report) {
      const texts = ai.statusTexts(baseFingerprint(report.items));
      const hintTexts = ai.hintTexts();
      const items = report.items.map((i) => {
        const t = aiCard(i) ? texts?.cards[i.id] : undefined;
        return t ? { ...i, ai: t } : i;
      });
      const hints = allHints().map((h) => {
        const item = hintItem(h);
        const text = hintTexts[h.id];
        return text ? { ...item, ai: { title: h.title, detail: text } } : item;
      });
      const incidents = store
        .openIncidents()
        .filter((i) => !i.seen)
        .map((i) => ({
          id: i.id,
          kind: i.kind as IncidentKind,
          title: String(i.facts.title ?? ''),
          detail: String(i.facts.detail ?? ''),
          ai: texts?.popups[String(i.id)] ?? null,
          openedAt: i.openedAt,
        }));
      // Kopfsatz auch, wenn alles läuft (bis die Antwort da ist, gilt der feste Text).
      return { ...report, items: [...items, ...hints], aiSummary: texts?.headline ?? null, incidents };
    },
    markIncidentSeen(id) {
      const ok = store.incident(id) !== null && store.markSeen(id);
      if (ok) opts.push();
      return ok;
    },
    dismissHint(id) {
      const ok = store.dismissHint(id);
      if (ok) opts.push();
      return ok;
    },
    userAction: (appId, action) => recorder.userAction(appId, action),
    stop() {
      if (timer) clearInterval(timer);
      if (first) clearTimeout(first);
      ai.stop();
    },
  };
}
