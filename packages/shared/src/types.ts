import { z } from 'zod';

export interface SystemStats {
  cpu: { model: string; cores: number; loadPercent: number };
  memory: { totalBytes: number; usedBytes: number };
  disks: { mount: string; totalBytes: number; usedBytes: number }[];
  temperatureC: number | null;
  uptimeSeconds: number;
  network: { rxBytesPerSec: number; txBytesPerSec: number };
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

export const catalogAppSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    description: z.string(),
    icon: z.string(),
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
  error: string | null;
  /** Nur ":<port><pfad>" – den Host setzt der Browser davor (siehe apps/web/src/api/webUi.ts). */
  webUiUrl: string | null;
  installedAt: string;
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
  | { type: 'log'; appId: string; line: string };

export interface ApiError {
  code: string;
  message: string;
}
