import si from 'systeminformation';
import type { ProcessInfo, SystemDetails } from '@mainframe/shared';

/** Quelle für Detailansicht und Prozess-Liste (für Tests austauschbar). */
export interface SystemSource {
  details(): Promise<SystemDetails>;
  /** Alle Programme, gleichnamige Prozesse zusammengefasst, unsortiert. */
  processes(): Promise<ProcessInfo[]>;
}

/** Leerlauf-Pseudoprozesse, die sonst ganz oben stehen würden. */
const IGNORE = new Set(['system idle process', 'idle', '']);

const round1 = (v: number) => Math.round(v * 10) / 10;

export function createSystemSource(lib: typeof si = si): SystemSource {
  return {
    async details() {
      const [cpu, load, mem, nets, temp] = await Promise.all([lib.cpu(), lib.currentLoad(), lib.mem(), lib.networkInterfaces(), lib.cpuTemperature()]);
      const list = Array.isArray(nets) ? nets : [nets];
      const valid = (v: number | null | undefined) => (typeof v === 'number' && v > 0 ? round1(v) : null);
      return {
        cpu: {
          model: `${cpu.manufacturer} ${cpu.brand}`.trim(),
          cores: cpu.cores,
          physicalCores: cpu.physicalCores,
          speedGHz: cpu.speed,
          perCore: load.cpus.map((c) => round1(c.load)),
        },
        memory: {
          totalBytes: mem.total,
          usedBytes: mem.active,
          freeBytes: mem.available,
          cacheBytes: mem.buffcache,
          swapTotalBytes: mem.swaptotal,
          swapUsedBytes: mem.swapused,
        },
        network: list
          .filter((n) => !n.internal && n.ip4 && n.operstate !== 'down')
          .map((n) => ({ iface: n.ifaceName || n.iface, ip: n.ip4, speedMbit: typeof n.speed === 'number' && n.speed > 0 ? n.speed : null })),
        temperature: { mainC: valid(temp.main), maxC: valid(temp.max), coresC: (temp.cores ?? []).filter((c) => c > 0).map(round1) },
      };
    },
    async processes() {
      const { list } = await lib.processes();
      const byName = new Map<string, ProcessInfo>();
      for (const p of list) {
        const name = p.name.replace(/\.exe$/i, '');
        if (IGNORE.has(name.toLowerCase())) continue;
        const e = byName.get(name) ?? { name, count: 0, cpuPercent: 0, memBytes: 0 };
        e.count++;
        e.cpuPercent += p.cpu;
        e.memBytes += (p.memRss ?? 0) * 1024;
        byName.set(name, e);
      }
      return [...byName.values()].map((e) => ({ ...e, cpuPercent: round1(e.cpuPercent) }));
    },
  };
}

/**
 * Hält ein Ergebnis `ms` lang, damit mehrere Zuschauer die teure Abfrage nicht vervielfachen.
 * Eine laufende Abfrage wird geteilt; die Haltezeit zählt erst ab ihrem Ergebnis.
 */
export function cached<T>(fn: () => Promise<T>, ms: number, now: () => number = Date.now): () => Promise<T> {
  let value: { at: number | null; p: Promise<T> } | null = null;
  return () => {
    if (value && (value.at === null || now() - value.at < ms)) return value.p;
    const entry: { at: number | null; p: Promise<T> } = { at: null, p: fn() };
    value = entry;
    entry.p.then(
      () => {
        entry.at = now();
      },
      () => {
        if (value === entry) value = null;
      },
    );
    return entry.p;
  };
}
