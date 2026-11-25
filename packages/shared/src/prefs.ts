import { z } from 'zod';

export const CARD_IDS = ['cpu', 'memory', 'disk', 'temperature', 'network', 'uptime', 'adguard'] as const;
export type CardId = (typeof CARD_IDS)[number];

export const ACCENTS = ['blue', 'teal', 'violet', 'pink', 'orange', 'green'] as const;
export type Accent = (typeof ACCENTS)[number];

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('de-DE', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const cardsSchema = z
  .array(z.object({ id: z.enum(CARD_IDS), visible: z.boolean() }).strict())
  .refine((cards) => cards.length === CARD_IDS.length && new Set(cards.map((c) => c.id)).size === CARD_IDS.length, {
    message: 'Jede Karte genau einmal',
  });

/** Alle allgemeinen Einstellungen von Mainframe. Jedes Feld hat einen Standardwert. */
export const prefsShape = {
  deviceName: z.string().trim().min(1).max(40),
  startPage: z.enum(['/', '/apps']),
  timeZone: z.string().refine(validTimeZone),
  sessionDays: z.union([z.literal(30), z.literal(7), z.literal(90)]),
  accent: z.enum(ACCENTS),
  density: z.enum(['normal', 'compact']),
  liveIntervalSec: z.union([z.literal(2), z.literal(1), z.literal(5)]),
  sizeUnits: z.enum(['si', 'iec']),
  netUnits: z.enum(['bytes', 'bits']),
  cards: cardsSchema,
  thresholds: z
    .object({
      memory: z.number().int().min(50).max(100),
      disk: z.number().int().min(50).max(100),
      temperature: z.number().int().min(50).max(100),
    })
    .strict(),
  historyMinutes: z.union([z.literal(60), z.literal(15), z.literal(360)]),
};

export const prefsSchema = z.object(prefsShape).strict();
export const prefsPatchSchema = prefsSchema.partial().strict();
export type Prefs = z.infer<typeof prefsSchema>;
export type PrefsPatch = z.infer<typeof prefsPatchSchema>;

export const defaultPrefs: Prefs = {
  deviceName: 'Mainframe',
  startPage: '/',
  timeZone: 'Europe/Berlin',
  sessionDays: 30,
  accent: 'blue',
  density: 'normal',
  liveIntervalSec: 2,
  sizeUnits: 'si',
  netUnits: 'bytes',
  cards: CARD_IDS.map((id) => ({ id, visible: true })),
  thresholds: { memory: 90, disk: 90, temperature: 80 },
  historyMinutes: 60,
};

/** Liest gespeicherte oder importierte Einstellungen. Fehlende oder ungültige Felder bekommen den Standardwert. */
export function parsePrefs(raw: unknown): Prefs {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = structuredClone(defaultPrefs) as Record<string, unknown>;
  for (const key of Object.keys(prefsShape) as (keyof typeof prefsShape)[]) {
    const r = prefsShape[key].safeParse(src[key]);
    if (r.success) out[key] = r.data;
  }
  return out as Prefs;
}
