import type { InstalledApp, Prefs, ServiceStatus, SystemStats } from '@mainframe/shared';
import type { InsightsStore, IncidentRow } from './store.ts';
import { dayLabel, hhmm } from './time.ts';

/** Die feste Liste wirklich wichtiger Vorfälle (Pop-up). Abstürze einzelner Apps gehören nicht dazu. */
export type IncidentKind = 'docker' | 'disk' | 'temperature' | 'adguard';

export interface CurrentIncident {
  /** Gleicher Schlüssel = gleicher Vorfall (z. B. "disk:C:") */
  key: string;
  kind: IncidentKind;
  title: string;
  detail: string;
  /** Satzanfang für den Hinweis, wenn der Vorfall schon vorbei ist */
  pastTitle: string;
}

export interface IncidentInput {
  dockerOk: boolean;
  apps: InstalledApp[];
  services: ServiceStatus[];
  stats: SystemStats | null;
  thresholds: Prefs['thresholds'];
}

export const DISK_DANGER_PERCENT = 95;
/** „Gefährlich heiß“ liegt 10 °C über der Warnschwelle. */
export const TEMP_DANGER_OFFSET = 10;
const ADGUARD_ID = 'adguard';

/** Snap-Pakete unter Ubuntu sind schreibgeschützte Abbilder und immer zu 100 % voll; die zählen nicht. */
export const isDataMount = (mount: string) => !/^\/(snap|boot\/efi)(\/|$)/.test(mount);

export function evaluateIncidents(i: IncidentInput): CurrentIncident[] {
  const out: CurrentIncident[] = [];
  if (!i.dockerOk) {
    out.push({ key: 'docker', kind: 'docker', title: 'Docker läuft nicht', detail: 'Ohne Docker laufen keine Apps. Starte Docker Desktop oder den Rechner neu.', pastTitle: 'Docker lief' });
  }
  for (const d of i.stats?.disks ?? []) {
    if (d.totalBytes <= 0 || !isDataMount(d.mount)) continue;
    const pct = (d.usedBytes / d.totalBytes) * 100;
    if (pct >= DISK_DANGER_PERCENT) {
      out.push({ key: `disk:${d.mount}`, kind: 'disk', title: `Laufwerk ${d.mount} ist fast voll`, detail: `Zu ${Math.floor(pct)} % belegt. Apps können bald nichts mehr speichern. Lösch alte Dateien oder räum Docker auf.`, pastTitle: `Laufwerk ${d.mount} war` });
    }
  }
  const t = i.stats?.temperatureC ?? null;
  if (t !== null && t >= i.thresholds.temperature + TEMP_DANGER_OFFSET) {
    out.push({ key: 'temperature', kind: 'temperature', title: `Rechner ist gefährlich heiß: ${Math.round(t)} °C`, detail: 'Sorg sofort für Luft um den Rechner oder schalte ihn aus.', pastTitle: 'Der Rechner war' });
  }
  // AdGuard aus heißt: Container läuft nicht oder antwortet nicht. Selbst gestoppt zählt nicht, Schutz aus auch nicht (es antwortet ja).
  const ag = i.apps.find((a) => a.id === ADGUARD_ID);
  if (i.dockerOk && ag && ag.state !== 'stopped' && ag.state !== 'installing') {
    const answering = i.services.find((s) => s.id === `app:${ADGUARD_ID}`)?.up !== false;
    if (ag.state !== 'running' || !answering) {
      out.push({ key: 'adguard', kind: 'adguard', title: 'AdGuard ist aus', detail: 'Dann geht im ganzen Haus oft kein Internet. Starte AdGuard neu.', pastTitle: 'AdGuard war' });
    }
  }
  return out;
}

/** Ein Vorfall gilt erst als vorbei, wenn er so lange nicht mehr auftaucht (gegen Flackern). */
const CLOSE_AFTER_MS = 2 * 60_000;
/** … und erst als Vorfall, wenn er so lange ansteht. */
const OPEN_AFTER_MS = 2 * 60_000;
const PAST_HINT_MS = 24 * 60 * 60_000;

const PAST_VERB: Record<string, string> = { docker: 'nicht', adguard: 'aus', disk: 'fast voll', temperature: 'gefährlich heiß' };

export interface IncidentTracker {
  /** Gleicht die aktuellen Vorfälle mit den gespeicherten ab. changed = etwas wurde geöffnet oder geschlossen. */
  update(current: CurrentIncident[]): { changed: boolean };
}

export function createIncidentTracker(opts: { store: InsightsStore; now?: () => number; openAfterMs?: number }): IncidentTracker {
  const { store } = opts;
  const now = opts.now ?? Date.now;
  const openAfterMs = opts.openAfterMs ?? OPEN_AFTER_MS;
  const missingSince = new Map<string, number>();
  const presentSince = new Map<string, number>();

  const pastHint = (row: IncidentRow, closedAt: number) => {
    const minutes = Math.max(1, Math.round((closedAt - row.openedAt) / 60_000));
    store.putHint({
      id: `incident:${row.id}`,
      kind: 'past-incident',
      createdAt: closedAt,
      expiresAt: closedAt + PAST_HINT_MS,
      facts: {
        title: pastIncidentTitle({ pastTitle: String(row.facts.pastTitle ?? row.facts.title), kind: row.kind, openedAt: row.openedAt, minutes }, now()),
        detail: 'Das ist schon wieder vorbei. Schau kurz nach, ob alles wieder läuft.',
        pastTitle: String(row.facts.pastTitle ?? row.facts.title),
        incident: row.kind,
        openedAt: row.openedAt,
        at: hhmm(row.openedAt),
        minutes,
      },
    });
  };

  return {
    update(current) {
      let changed = false;
      const at = now();
      const open = new Map(store.openIncidents().map((r) => [r.key, r]));
      for (const c of current) {
        missingSince.delete(c.key);
        if (open.has(c.key)) continue;
        // Erst öffnen, wenn es eine Weile so bleibt: ein einzelner Aussetzer oder ein langsamer Start ist kein Vorfall.
        const since = presentSince.get(c.key) ?? at;
        presentSince.set(c.key, since);
        if (at - since < openAfterMs) continue;
        store.openIncident({ key: c.key, kind: c.kind, at: since, facts: { title: c.title, detail: c.detail, pastTitle: c.pastTitle } });
        presentSince.delete(c.key);
        changed = true;
      }
      for (const key of presentSince.keys()) if (!current.some((c) => c.key === key)) presentSince.delete(key);
      for (const [key, row] of open) {
        if (current.some((c) => c.key === key)) continue;
        const since = missingSince.get(key) ?? at;
        missingSince.set(key, since);
        if (at - since < CLOSE_AFTER_MS) continue;
        store.closeIncident(row.id, since);
        missingSince.delete(key);
        // Vorbei, bevor du hingeschaut hast: kein Pop-up mehr, sondern ein Hinweis.
        if (!row.seen) pastHint(row, since);
        changed = true;
      }
      return { changed };
    },
  };
}

/** Satz für einen vorbeigegangenen Vorfall, beim Anzeigen gebaut (sonst stimmt „heute“ nach Mitternacht nicht mehr). */
export function pastIncidentTitle(f: { pastTitle: string; kind: string; openedAt: number; minutes: number }, now: number): string {
  const duration = f.minutes === 1 ? '1 Minute' : `${f.minutes} Minuten`;
  return `${f.pastTitle} ${dayLabel(f.openedAt, now)} um ${hhmm(f.openedAt)} für ${duration} ${PAST_VERB[f.kind] ?? ''}`.trim();
}
