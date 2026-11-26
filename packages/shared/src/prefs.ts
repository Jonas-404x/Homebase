import { z } from 'zod';

export const CARD_IDS = ['cpu', 'memory', 'disk', 'temperature', 'network', 'uptime', 'adguard'] as const;
export type CardId = (typeof CARD_IDS)[number];

export const ACCENTS = ['orange', 'blue', 'teal', 'violet', 'pink', 'green'] as const;
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
  /** Zeitraum der kleinen Kurven auf den Karten. */
  historyMinutes: z.union([z.literal(1), z.literal(15), z.literal(60), z.literal(360)]),
  /** Standard-Zeitraum der großen Kurve in der Detailansicht. */
  detailMinutes: z.union([z.literal(1440), z.literal(15), z.literal(60), z.literal(360), z.literal(4320), z.literal(10080)]),
  /** Takt der Erreichbarkeits-Prüfung auf der Dienste-Seite. */
  checkIntervalSec: z.union([z.literal(60), z.literal(30), z.literal(300)]),
  /** Automatischer Netzwerk-Scan in Minuten, 0 = nur per Knopf. */
  scanMinutes: z.union([z.literal(60), z.literal(0), z.literal(15), z.literal(360)]),
  /** Automatischer Speedtest alle N Stunden, 0 = nur per Knopf. */
  speedtestHours: z.union([z.literal(24), z.literal(0), z.literal(6)]),
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
  accent: 'orange',
  density: 'normal',
  liveIntervalSec: 2,
  sizeUnits: 'si',
  netUnits: 'bytes',
  cards: CARD_IDS.map((id) => ({ id, visible: true })),
  thresholds: { memory: 90, disk: 90, temperature: 80 },
  historyMinutes: 1,
  detailMinutes: 1440,
  checkIntervalSec: 60,
  scanMinutes: 60,
  speedtestHours: 24,
};

/** Karten aus einer älteren oder neueren Version: bekannte in ihrer Reihenfolge behalten, fehlende sichtbar anhängen. */
function repairCards(raw: unknown): Prefs['cards'] {
  const known = new Set<string>(CARD_IDS);
  const out: Prefs['cards'] = [];
  if (Array.isArray(raw)) {
    for (const c of raw) {
      if (c && typeof c === 'object' && known.has((c as { id: string }).id) && !out.some((x) => x.id === (c as { id: string }).id)) {
        out.push({ id: (c as { id: CardId }).id, visible: (c as { visible?: unknown }).visible !== false });
      }
    }
  }
  for (const id of CARD_IDS) if (!out.some((c) => c.id === id)) out.push({ id, visible: true });
  return out;
}

/** Liest gespeicherte oder importierte Einstellungen. Fehlende oder ungültige Felder bekommen den Standardwert. */
export function parsePrefs(raw: unknown): Prefs {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = structuredClone(defaultPrefs) as Record<string, unknown>;
  for (const key of Object.keys(prefsShape) as (keyof typeof prefsShape)[]) {
    const r = prefsShape[key].safeParse(src[key]);
    if (r.success) out[key] = r.data;
    else if (key === 'cards') out.cards = repairCards(src.cards);
  }
  return out as Prefs;
}
