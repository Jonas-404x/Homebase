import { useEffect, useState } from 'react';
import type { AppUsage } from '@mainframe/shared';
import { api } from './client.ts';

const POLL_MS = 5000;

/** CPU, RAM und Speicher pro App, alle 5 Sekunden neu. null = noch nicht geladen. */
export function useAppUsage(): Map<string, AppUsage> | null {
  const [usage, setUsage] = useState<Map<string, AppUsage> | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Erst nach der Antwort neu fragen: eine langsame Messung staut sich so nicht auf.
    const load = async () => {
      try {
        const list = await api<AppUsage[]>('/api/apps/usage');
        if (!stop) setUsage(new Map(list.map((u) => [u.appId, u])));
      } catch {
        if (!stop) setUsage((u) => u ?? new Map());
      }
      if (!stop) timer = setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);
  return usage;
}
