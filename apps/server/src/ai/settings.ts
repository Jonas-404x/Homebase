import { z } from 'zod';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import { DEFAULT_GEMINI_MODEL, MODEL_PATTERN } from './gemini.ts';

/**
 * Einstellungen → KI. Bewusst nicht in Prefs: die gehen per WebSocket an jeden Browser und in den Export.
 * Der Schlüssel liegt allein in settings.ai_api_key und verlässt den Server nur Richtung Google.
 */
export interface AiSettings {
  /** null = nie selbst geschaltet: dann an, sobald ein Schlüssel gesetzt ist */
  enabled: boolean | null;
  model: string;
  sendLogs: boolean;
  /** null = ohne Grenze */
  dailyLimit: number | null;
}

export const AI_DEFAULTS: AiSettings = { enabled: null, model: DEFAULT_GEMINI_MODEL, sendLogs: true, dailyLimit: 50 };

const SETTINGS_KEY = 'ai_settings';
const API_KEY = 'ai_api_key';

export const aiSettingsPatchSchema = z
  .object({
    enabled: z.boolean().nullable(),
    model: z.string().regex(MODEL_PATTERN),
    sendLogs: z.boolean(),
    dailyLimit: z.number().int().min(1).max(1000).nullable(),
  })
  .partial()
  .strict();

/** Google-Schlüssel sind kurze Zeichenketten ohne Leerzeichen; mehr prüfen wir nicht. */
const keySchema = z.string().trim().min(10).max(200).regex(/^[A-Za-z0-9_\-.]+$/);

export interface AiConfig {
  get(): AiSettings;
  update(patch: unknown): AiSettings;
  enabled(): boolean;
  hasKey(): boolean;
  /** Nur für den Anbieter. Nie an den Browser, nie ins Log. */
  key(): string | null;
  setKey(raw: unknown): void;
  clearKey(): void;
  onChange(cb: () => void): void;
}

export function createAiConfig(db: Db): AiConfig {
  const listeners: (() => void)[] = [];
  const changed = () => listeners.forEach((cb) => cb());
  const get = (): AiSettings => {
    const raw = db.getSetting(SETTINGS_KEY);
    if (!raw) return { ...AI_DEFAULTS };
    try {
      const r = aiSettingsPatchSchema.safeParse(JSON.parse(raw));
      return { ...AI_DEFAULTS, ...(r.success ? r.data : {}) };
    } catch {
      return { ...AI_DEFAULTS };
    }
  };
  const key = () => db.getSetting(API_KEY);
  return {
    get,
    update(patch) {
      const r = aiSettingsPatchSchema.safeParse(patch);
      if (!r.success) throw new MainframeError('invalid_input', 'Diese KI-Einstellung gibt es so nicht.', 400);
      const next = { ...get(), ...r.data };
      db.setSetting(SETTINGS_KEY, JSON.stringify(next));
      changed();
      return next;
    },
    enabled: () => {
      const s = get();
      return key() !== null && (s.enabled ?? true);
    },
    hasKey: () => key() !== null,
    key,
    setKey(raw) {
      const r = keySchema.safeParse(raw);
      if (!r.success) throw new MainframeError('invalid_input', 'Das sieht nicht wie ein Schlüssel aus.', 400);
      db.setSetting(API_KEY, r.data);
      changed();
    },
    clearKey() {
      db.deleteSetting(API_KEY);
      changed();
    },
    onChange: (cb) => void listeners.push(cb),
  };
}
