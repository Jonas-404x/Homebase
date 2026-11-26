import type { Prefs } from './prefs.ts';
import { z } from 'zod';

export interface SystemStats {
  cpu: { model: string; cores: number; loadPercent: number };
  memory: { totalBytes: number; usedBytes: number };
  disks: { mount: string; totalBytes: number; usedBytes: number }[];
  temperatureC: number | null;
  uptimeSeconds: number;
  network: { rxBytesPerSec: number; txBytesPerSec: number };
}

/** Ein Punkt im Verlauf der Live-Werte (memory in Prozent). */
export interface HistoryPoint {
  at: number;
  cpu: number;
  memory: number;
  rx: number;
  tx: number;
  /** °C, null wenn das Gerät keine Temperatur liefert. */
  temp: number | null;
}

/** Mehr Infos für die Detailansicht (Klick auf eine Karte). */
export interface SystemDetails {
  cpu: { model: string; cores: number; physicalCores: number; speedGHz: number; perCore: number[] };
  memory: { totalBytes: number; usedBytes: number; freeBytes: number; cacheBytes: number; swapTotalBytes: number; swapUsedBytes: number };
  network: { iface: string; ip: string; speedMbit: number | null }[];
  temperature: { mainC: number | null; maxC: number | null; coresC: number[] };
}

/** Ein Programm in der Prozess-Liste (gleichnamige Prozesse zusammengefasst). */
export interface ProcessInfo {
  name: string;
  count: number;
  cpuPercent: number;
  memBytes: number;
}

export interface SystemInfo {
  hostname: string;
  platform: string;
  /** true nur auf dem Linux-Server (nicht im Dev-Modus am Windows-PC). */
  isServer: boolean;
  addresses: { iface: string; ip: string }[];
  port: number;
  version: string;
  mainframeUptimeSec: number;
  dataRoot: string;
  node: string;
}

export interface DockerUsageItem {
  count: number;
  bytes: number;
  reclaimableBytes: number;
}

export interface DockerUsage {
  images: DockerUsageItem;
  containers: DockerUsageItem;
  volumes: DockerUsageItem;
  buildCache: DockerUsageItem;
}

export interface MainframeEvent {
  at: number;
  level: 'info' | 'warn' | 'error';
  text: string;
}

const keySchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/);

export const catalogFieldSchema = z.object({
  key: keySchema,
  label: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'secret']),
  required: z.boolean(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  generate: z.literal('password').optional(),
});

export const catalogPortSchema = z.object({
  key: keySchema,
  label: z.string().min(1),
  container: z.number().int().min(1).max(65535),
  protocol: z.enum(['tcp', 'udp']),
  default: z.number().int().min(1).max(65535),
  devDefault: z.number().int().min(1).max(65535).optional(),
});

/** Symbole, die Katalog-Apps benutzen dürfen (die Weboberfläche kennt genau diese). */
export const APP_ICONS = ['shield', 'box', 'pickaxe', 'music', 'bot', 'activity', 'film', 'key', 'bell', 'house'] as const;
export type AppIconName = (typeof APP_ICONS)[number];

export const catalogAppSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string(),
    icon: z.enum(APP_ICONS),
    fields: z.array(catalogFieldSchema),
    ports: z.array(catalogPortSchema),
    webUi: z.object({ portKey: z.string(), path: z.string() }).optional(),
  })
  .superRefine((app, ctx) => {
    const keys = [...app.fields.map((f) => f.key), ...app.ports.map((p) => p.key)];
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) ctx.addIssue({ code: 'custom', message: `Schlüssel doppelt: ${dup}` });
    if (app.webUi && !app.ports.some((p) => p.key === app.webUi!.portKey)) {
      ctx.addIssue({ code: 'custom', message: `webUi.portKey unbekannt: ${app.webUi.portKey}` });
    }
  });

export type FieldType = z.infer<typeof catalogFieldSchema>['type'];
export type CatalogField = z.infer<typeof catalogFieldSchema>;
export type CatalogPort = z.infer<typeof catalogPortSchema>;
export type CatalogApp = z.infer<typeof catalogAppSchema>;

export type AppState = 'installing' | 'running' | 'stopped' | 'restarting' | 'error';

export interface InstalledApp {
  id: string;
  name: string;
  state: AppState;
  /** Gesundheit laut Healthcheck der Container; fehlt, wenn die App keinen hat. */
  health?: 'healthy' | 'unhealthy' | 'starting';
  error: string | null;
  /** Nur ":<port><pfad>" – den Host setzt der Browser davor (siehe apps/web/src/api/webUi.ts). */
  webUiUrl: string | null;
  installedAt: string;
}

/** CPU, RAM und belegter Speicher einer installierten App. */
export interface AppUsage {
  appId: string;
  /** Anteil an der CPU des ganzen Rechners in Prozent. */
  cpuPercent: number;
  memBytes: number;
  /** Container-Schicht + Volumes + App-Ordner; null, solange unbekannt. */
  diskBytes: number | null;
}

/** Ein Eingabefeld einer installierten App mit seinem Wert (z. B. Benutzername und Passwort). */
export interface AppCredential {
  key: string;
  label: string;
  value: string;
  secret: boolean;
}

export type WsMessage =
  | { type: 'stats'; data: SystemStats }
  | { type: 'apps'; data: InstalledApp[] }
  | { type: 'log'; appId: string; line: string }
  | { type: 'prefs'; data: Prefs }
  | { type: 'event'; data: MainframeEvent };

export interface ApiError {
  code: string;
  message: string;
}

/** Eigener Link auf der Dienste-Seite (z. B. die Router-Oberfläche). */
export interface ServiceLink {
  id: string;
  name: string;
  /** http(s)://… oder tcp://host:port */
  url: string;
  createdAt: number;
}

/** Ein Dienst mit seinem Prüf-Stand. */
export interface ServiceStatus {
  id: string;
  name: string;
  url: string;
  kind: 'app' | 'link';
  /** null = noch nicht geprüft */
  up: boolean | null;
  ms: number | null;
  /** Warum der Dienst nicht funktioniert, z. B. "Antwortet mit Fehler 404"; null wenn er läuft oder unbekannt */
  reason: string | null;
  /** App ist gestoppt, wird dann nicht geprüft */
  stopped: boolean;
  /** Verfügbarkeit in Prozent, null = keine Prüfungen im Zeitraum */
  uptime24h: number | null;
  uptime7d: number | null;
  /** 48 Abschnitte über 24 Stunden, Anteil erfolgreicher Prüfungen 0 bis 1 */
  bars: (number | null)[];
}

/** Ein Gerät im Heimnetz. */
export interface DeviceInfo {
  mac: string;
  ip: string;
  hostname: string | null;
  vendor: string | null;
  /** Zufällige (private) MAC-Adresse, typisch für Handys und Tablets */
  randomMac: boolean;
  name: string;
  note: string;
  known: boolean;
  firstSeen: number;
  lastSeen: number;
  /** Beim letzten Scan gesehen */
  online: boolean;
}

export interface SpeedtestResult {
  at: number;
  downMbps: number;
  upMbps: number;
  pingMs: number;
}

export interface Outage {
  from: number;
  /** null = dauert noch an */
  to: number | null;
  minutes: number;
}

export interface InternetStatus {
  /** null = noch keine Probe */
  online: boolean | null;
  lastProbe: number | null;
  outages: Outage[];
  speedtests: SpeedtestResult[];
  running: boolean;
}

/** Ein Punkt der Statusübersicht: problem = rot, warn = gelb, info = grau (zählt nicht). */
export interface StatusItem {
  id: string;
  level: 'problem' | 'warn' | 'info';
  title: string;
  detail: string;
  /** Seite in Mainframe, auf der man es beheben kann */
  to: string | null;
  /** App-ID für die Diagnose oder "system"; null = keine Diagnose */
  diagnose: string | null;
}

export interface StatusReport {
  level: 'ok' | 'warn' | 'problem';
  summary: string;
  items: StatusItem[];
}
