import { useCallback, useEffect, useState } from 'react';
import type { InstalledApp } from '@mainframe/shared';
import { api } from './client.ts';
import { useLive } from './live.tsx';

/** Installierte Apps: einmal laden, danach live über den WebSocket aktualisieren. */
export function useApps() {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);

  const reload = useCallback(async () => {
    try {
      setApps(await api<InstalledApp[]>('/api/apps'));
    } catch {
      setApps((a) => a ?? []);
    }
  }, []);

  useEffect(() => void reload(), [reload]);
  useLive('apps', useCallback((m) => setApps(m.data), []));

  return { apps, reload };
}
