import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_LABEL } from './docker-status.ts';

/** Ausschnitt aus der Antwort von `docker stats` (einmalig, stream: false). */
export interface StatsLike {
  cpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  precpu_stats?: { cpu_usage?: { total_usage?: number }; system_cpu_usage?: number };
  memory_stats?: { usage?: number; stats?: Record<string, number | undefined> };
}

/** Ausschnitt aus `docker system df`. */
export interface DfLike {
  Containers?: { Labels?: Record<string, string | undefined> | null; SizeRw?: number }[];
  Volumes?: { Labels?: Record<string, string | undefined> | null; UsageData?: { Size?: number } | null }[];
}

/** Compose-Projektname, unter dem Mainframe eine App startet. */
export const composeProject = (appId: string) => `mf-${appId}`;

/**
 * CPU-Last als Anteil am ganzen Rechner in Prozent (eine Nachkommastelle).
 * system_cpu_usage zählt alle Kerne zusammen, deshalb nicht noch mit der Kernzahl malnehmen.
 */
export function cpuPercent(s: StatsLike): number {
  const cpu = (s.cpu_stats?.cpu_usage?.total_usage ?? 0) - (s.precpu_stats?.cpu_usage?.total_usage ?? 0);
  const sys = (s.cpu_stats?.system_cpu_usage ?? 0) - (s.precpu_stats?.system_cpu_usage ?? 0);
  // Ohne Vorwert (erster Messwert) fehlt precpu_stats: dann gibt es keine Last zu berechnen.
  if (!s.precpu_stats?.system_cpu_usage || sys <= 0 || cpu <= 0) return 0;
  return Math.round((cpu / sys) * 1000) / 10;
}

/** RAM ohne den Datei-Zwischenspeicher, den das System jederzeit freigeben kann (wie `docker stats`). */
export function memBytes(s: StatsLike): number {
  const usage = s.memory_stats?.usage ?? 0;
  const st = s.memory_stats?.stats ?? {};
  const cache = st.inactive_file ?? st.total_inactive_file ?? st.cache ?? 0;
  return Math.max(0, usage - cache);
}

/** Belegter Speicher pro App: Container-Schicht + Volumes des Compose-Projekts + App-Ordner. */
export function diskByApp(df: DfLike, appIds: string[], dirSizes: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of appIds) out.set(id, dirSizes.get(id) ?? 0);
  for (const c of df.Containers ?? []) {
    const id = c.Labels?.[APP_LABEL];
    if (id && out.has(id)) out.set(id, out.get(id)! + Math.max(0, c.SizeRw ?? 0));
  }
  for (const v of df.Volumes ?? []) {
    const project = v.Labels?.['com.docker.compose.project'];
    const id = appIds.find((a) => composeProject(a) === project);
    if (id) out.set(id, out.get(id)! + Math.max(0, v.UsageData?.Size ?? 0));
  }
  return out;
}

/** Größe eines Ordners samt Unterordnern; ein fehlender Ordner zählt 0. Symbolische Links werden nicht verfolgt. */
export async function dirSize(dir: string): Promise<number> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await fs.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}
