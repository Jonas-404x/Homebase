import type { MainframeEvent } from '@mainframe/shared';

export interface EventLog {
  add(level: MainframeEvent['level'], text: string): MainframeEvent;
  /** Neueste zuerst. */
  list(): MainframeEvent[];
  onAdd(cb: (e: MainframeEvent) => void): () => void;
}

/** Protokoll von Mainframe im Speicher (Start, Anmeldungen, App-Aktionen, Fehler). */
export function createEventLog(max = 500): EventLog {
  const items: MainframeEvent[] = [];
  const listeners = new Set<(e: MainframeEvent) => void>();
  return {
    add(level, text) {
      const e = { at: Date.now(), level, text };
      items.push(e);
      if (items.length > max) items.splice(0, items.length - max);
      for (const l of listeners) l(e);
      return e;
    },
    list: () => [...items].reverse(),
    onAdd(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
