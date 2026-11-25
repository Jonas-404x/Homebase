import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Prefs, PrefsPatch } from '@mainframe/shared';
import { api } from './client.ts';
import { useLive } from './live.tsx';

interface PrefsValue {
  /** null, solange die Einstellungen noch nicht geladen sind. */
  prefs: Prefs | null;
  update(patch: PrefsPatch): Promise<Prefs>;
}

const PrefsContext = createContext<PrefsValue>({
  prefs: null,
  update: async () => {
    throw new Error('PrefsProvider fehlt');
  },
});

function apply(p: Prefs) {
  const root = document.documentElement;
  root.dataset.accent = p.accent;
  root.dataset.density = p.density;
  document.title = p.deviceName;
}

/** Lädt die Einstellungen, hält sie live aktuell und setzt Akzentfarbe, Dichte und Titel. */
export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);

  const set = useCallback((p: Prefs) => {
    apply(p);
    setPrefs(p);
  }, []);

  useEffect(() => {
    api<Prefs>('/api/prefs')
      .then(set)
      .catch(() => {});
  }, [set]);

  useLive('prefs', useCallback((m) => set(m.data), [set]));

  const update = useCallback(
    async (patch: PrefsPatch) => {
      const next = await api<Prefs>('/api/prefs', { method: 'PUT', body: JSON.stringify(patch) });
      set(next);
      return next;
    },
    [set],
  );

  return <PrefsContext.Provider value={{ prefs, update }}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  return useContext(PrefsContext);
}
