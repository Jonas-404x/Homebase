import { parsePrefs, prefsPatchSchema, type Prefs } from '@mainframe/shared';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';

const KEY = 'prefs';

export interface PrefsStore {
  get(): Prefs;
  /** Prüft die Änderung, mischt sie in die gespeicherten Werte und gibt das Ergebnis zurück. */
  update(patch: unknown): Prefs;
  /** Ersetzt alles (z. B. beim Import). Ungültiges wird zu Standardwerten. */
  replace(raw: unknown): Prefs;
  onChange(cb: (p: Prefs) => void): () => void;
}

export function createPrefsStore(db: Db): PrefsStore {
  const listeners = new Set<(p: Prefs) => void>();
  const read = (): Prefs => {
    const raw = db.getSetting(KEY);
    if (!raw) return parsePrefs({});
    try {
      return parsePrefs(JSON.parse(raw));
    } catch {
      return parsePrefs({});
    }
  };
  const write = (p: Prefs) => {
    db.setSetting(KEY, JSON.stringify(p));
    for (const l of listeners) l(p);
    return p;
  };
  return {
    get: read,
    update(patch) {
      const r = prefsPatchSchema.safeParse(patch);
      if (!r.success) throw new MainframeError('invalid_input', 'Diese Einstellung gibt es so nicht.', 400);
      return write({ ...read(), ...r.data });
    },
    replace: (raw) => write(parsePrefs(raw)),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
