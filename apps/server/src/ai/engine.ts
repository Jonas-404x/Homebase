import type { Db } from '../db.ts';
import type { InsightsStore } from '../insights/store.ts';
import { createBudget } from './budget.ts';
import { knownIds, remapTexts, type IdMap } from './facts.ts';
import { parseAiTexts } from './schema.ts';
import type { AiConfig } from './settings.ts';
import { AI_ERROR_TEXT, AiError, type AiErrorCode, type AiFacts, type AiProvider, type AiTexts } from './types.ts';

const MIN = 60_000;
/** Nach einer Änderung so lange warten, ob sich noch mehr ändert. */
export const DEBOUNCE_MS = 2 * MIN;
/** Ändert sich ständig etwas, wird spätestens nach dieser Zeit trotzdem gefragt. */
const MAX_WAIT_MS = 10 * MIN;
/** So lange gelten KI-Texte; danach einmal neu fragen, wenn das Problem noch ansteht. */
export const TEXT_TTL_MS = 6 * 60 * MIN;
/** Nach Fehler oder HTTP 429 frühestens so viel später wieder. */
export const BACKOFF_MS = 10 * MIN;
/** Kopfsatz, wenn alles läuft: höchstens so lange gültig (dann beim Öffnen einmal neu). */
export const CALM_TTL_MS = 60 * MIN;
/** Muster und Nacht-Spitzen höchstens so oft. */
export const HINTS_EVERY_MS = 6 * 60 * MIN;

export interface StatusSnapshot {
  fingerprint: string;
  base: string;
  facts: AiFacts;
  idMap: IdMap;
  /** Gibt es Probleme, Warnungen oder offene Vorfälle? */
  issues: boolean;
  /** Alles läuft: dann gibt es nur einen freundlichen Kopfsatz, und nur, wenn jemand die Übersicht offen hat. */
  calm?: boolean;
}

export interface HintSnapshot {
  facts: AiFacts;
  idMap: IdMap;
  /** Fingerabdruck pro Hinweis (echte ID) aus seinem Inhalt */
  fingerprints: Record<string, string>;
}

export interface AiState {
  lastOkAt: number | null;
  /** Der letzte Fehler in einfachen Worten; null nach Erfolg */
  lastError: string | null;
  lastErrorAt: number | null;
}

export interface AiEngine {
  observeStatus(s: StatusSnapshot): void;
  observeHints(s: HintSnapshot): void;
  /** Fertige Texte für den aktuellen Zustand; null, wenn keine passen (dann gelten die festen Texte). */
  statusTexts(base: string): AiTexts | null;
  hintTexts(): Record<string, string>;
  state(): AiState;
  usedToday(): number;
  /** Knopf „Jetzt testen“: eine kleine Anfrage, zählt zur Tagesgrenze. */
  test(): Promise<{ ok: boolean; message: string }>;
  stop(): void;
}

interface StatusCache {
  base: string;
  texts: AiTexts;
}
interface HintsCache {
  /** Für welchen Inhalt der Text geschrieben wurde, pro Hinweis */
  fps: Record<string, string>;
  texts: Record<string, string>;
}

const STATE_KEY = 'ai_state';

export function createAiEngine(opts: {
  db: Db;
  store: InsightsStore;
  config: AiConfig;
  providerFor: (apiKey: string, model: string) => AiProvider;
  onTexts?: () => void;
  now?: () => number;
  debounceMs?: number;
  /** Hat gerade jemand die Übersicht offen? Nur dann wird der Kopfsatz für „alles läuft“ geholt. */
  isWatched?: () => boolean;
}): AiEngine {
  const { db, store, config } = opts;
  const now = opts.now ?? Date.now;
  const debounceMs = opts.debounceMs ?? DEBOUNCE_MS;
  const budget = createBudget(db, now);
  let latest: StatusSnapshot | null = null;
  let pending: { fingerprint: string; since: number; timer: NodeJS.Timeout } | null = null;
  let backoffUntil = 0;
  let busy = false;
  let provider: { key: string; model: string; p: AiProvider } | null = null;

  const readState = (): AiState => {
    try {
      return { lastOkAt: null, lastError: null, lastErrorAt: null, ...(JSON.parse(db.getSetting(STATE_KEY) ?? '{}') as Partial<AiState>) };
    } catch {
      return { lastOkAt: null, lastError: null, lastErrorAt: null };
    }
  };
  const writeState = (s: AiState) => db.setSetting(STATE_KEY, JSON.stringify(s));
  const ok = () => writeState({ ...readState(), lastOkAt: now(), lastError: null, lastErrorAt: null });
  const fail = (code: AiErrorCode) => {
    writeState({ ...readState(), lastError: AI_ERROR_TEXT[code], lastErrorAt: now() });
    if (code !== 'limit') backoffUntil = now() + BACKOFF_MS;
  };

  const getProvider = (): AiProvider | null => {
    const key = config.key();
    if (!key) return null;
    const model = config.get().model;
    // Den Anbieter behalten, solange Schlüssel und Modell gleich sind (er merkt sich z. B., ob das Schema geht).
    if (!provider || provider.key !== key || provider.model !== model) provider = { key, model, p: opts.providerFor(key, model) };
    return provider.p;
  };

  /** Eine Anfrage mit allen Sicherungen. null = nicht gefragt oder fehlgeschlagen. */
  const ask = async (facts: AiFacts, idMap: IdMap): Promise<AiTexts | null> => {
    const p = getProvider();
    if (!p || busy || now() < backoffUntil) return null;
    if (!budget.tryConsume(config.get().dailyLimit)) {
      fail('limit');
      return null;
    }
    busy = true;
    try {
      const raw = await p.summarize(facts);
      const parsed = parseAiTexts(raw, knownIds(idMap));
      if (!parsed) {
        fail('bad_response');
        return null;
      }
      ok();
      return remapTexts(parsed, idMap);
    } catch (err) {
      fail(err instanceof AiError ? err.code : 'network');
      return null;
    } finally {
      busy = false;
    }
  };

  const readCache = <T>(scope: string): { fingerprint: string; at: number; value: T } | null => {
    const row = store.getCache(scope);
    if (!row) return null;
    try {
      return { fingerprint: row.fingerprint, at: row.at, value: JSON.parse(row.json) as T };
    } catch {
      return null;
    }
  };

  // Eine Zeile pro Fingerabdruck: springt eine App zwischen zwei Fehlerbildern hin und her, wird nicht jedes Mal neu gefragt.
  const statusScope = (fingerprint: string) => `status:${fingerprint}`;
  const ttl = (s: StatusSnapshot) => (s.issues ? TEXT_TTL_MS : CALM_TTL_MS);
  const freshStatus = (s: StatusSnapshot) => {
    const c = store.getCache(statusScope(s.fingerprint));
    return c !== null && now() - c.at < ttl(s);
  };
  /** Soll für diesen Zustand gefragt werden? Probleme immer; „alles läuft“ nur, wenn jemand hinschaut. */
  const wanted = (s: StatusSnapshot) => s.issues || (Boolean(s.calm) && (opts.isWatched?.() ?? true));

  const clearPending = () => {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  };

  const fire = async () => {
    pending = null;
    const s = latest;
    if (!s || !wanted(s) || !config.enabled() || freshStatus(s)) return;
    const waitBackoff = backoffUntil - now();
    if (waitBackoff > 0) {
      schedule(s.fingerprint, waitBackoff);
      return;
    }
    // Logzeilen-Schalter gilt sofort, auch für Fakten, die vor dem Ausschalten gesammelt wurden.
    const facts = config.get().sendLogs ? s.facts : { ...s.facts, cards: s.facts.cards.map(({ logLines: _drop, ...c }) => c) };
    const texts = await ask(facts, s.idMap);
    if (!texts) return;
    store.putCache(statusScope(s.fingerprint), { fingerprint: s.fingerprint, at: now(), json: JSON.stringify({ base: s.base, texts } satisfies StatusCache) });
    store.pruneCache('status:', now() - TEXT_TTL_MS);
    opts.onTexts?.();
  };

  const schedule = (fingerprint: string, ms: number) => {
    const since = pending?.since ?? now();
    clearPending();
    const timer = setTimeout(() => void fire(), ms);
    timer.unref?.();
    pending = { fingerprint, since, timer };
  };

  return {
    observeStatus(s) {
      latest = s;
      if (!wanted(s) || !config.enabled() || freshStatus(s)) {
        clearPending();
        return;
      }
      if (pending?.fingerprint === s.fingerprint) return;
      const waited = pending ? now() - pending.since : 0;
      schedule(s.fingerprint, waited >= MAX_WAIT_MS ? 0 : debounceMs);
    },

    observeHints(s) {
      const ids = Object.values(s.idMap.hints);
      if (ids.length === 0 || !config.enabled()) return;
      const cache = readCache<HintsCache>('hints');
      const fps = cache?.value.fps ?? {};
      // Nur fragen, wenn ein Hinweis neu ist oder sich sein Inhalt geändert hat – und höchstens alle 6 Stunden.
      if (!ids.some((id) => fps[id] !== s.fingerprints[id])) return;
      if (cache && now() - cache.at < HINTS_EVERY_MS) return;
      void ask(s.facts, s.idMap).then((texts) => {
        if (!texts) return;
        // Texte zu Hinweisen, die es noch gibt und die sich nicht geändert haben, behalten; neue dazu.
        const keep = (id: string) => ids.includes(id) && fps[id] === s.fingerprints[id];
        const value: HintsCache = {
          fps: Object.fromEntries([...Object.entries(fps).filter(([id]) => keep(id) && cache?.value.texts[id] !== undefined), ...Object.keys(texts.hints).map((id) => [id, s.fingerprints[id]!])]),
          texts: { ...Object.fromEntries(Object.entries(cache?.value.texts ?? {}).filter(([id]) => keep(id))), ...texts.hints },
        };
        // Auch wenn die KI für manche Hinweise nichts Brauchbares geschickt hat: der Zeitpunkt zählt, nach 6 Stunden geht es noch mal.
        store.putCache('hints', { fingerprint: 'hints', at: now(), json: JSON.stringify(value) });
        opts.onTexts?.();
      });
    },

    statusTexts(base) {
      if (!latest || !config.enabled()) return null;
      const c = readCache<StatusCache>(statusScope(latest.fingerprint));
      if (!c || c.value.base !== base || now() - c.at >= ttl(latest)) return null;
      return c.value.texts;
    },

    hintTexts() {
      if (!config.enabled()) return {};
      const c = readCache<HintsCache>('hints');
      return c?.value.texts ?? {};
    },

    state: readState,
    usedToday: () => budget.used(),

    async test() {
      if (!config.hasKey()) return { ok: false, message: AI_ERROR_TEXT.no_key };
      const saved = backoffUntil;
      backoffUntil = 0; // Den Knopf drückst du selbst: kein Warten auf die Pause nach einem Fehler.
      const texts = await ask({ scope: 'test', cards: [], incidents: [], hints: [] }, { cards: {}, hints: {}, popups: {} });
      if (texts) return { ok: true, message: texts.headline ?? 'Die KI ist verbunden.' };
      if (backoffUntil === 0) backoffUntil = saved;
      return { ok: false, message: readState().lastError ?? AI_ERROR_TEXT.network };
    },

    stop: clearPending,
  };
}
