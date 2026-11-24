import si from 'systeminformation';
import type { SystemStats } from '@mainframe/shared';

/** Der Teil von systeminformation, den wir brauchen (für Tests austauschbar). */
export interface SiLike {
  cpu(): Promise<{ manufacturer: string; brand: string; cores: number }>;
  currentLoad(): Promise<{ currentLoad: number }>;
  mem(): Promise<{ total: number; active: number }>;
  fsSize(): Promise<{ mount: string; size: number; used: number }[]>;
  cpuTemperature(): Promise<{ main: number | null }>;
  time(): { uptime: number };
  networkStats(): Promise<{ iface: string; rx_bytes: number; tx_bytes: number }[]>;
}

export type StatsProvider = () => Promise<SystemStats>;

const LOOPBACK = /^(lo|loopback)/i;

export function createStatsProvider(lib: SiLike = si as unknown as SiLike, now: () => number = Date.now): StatsProvider {
  let last: { at: number; rx: number; tx: number } | null = null;

  return async () => {
    const [cpu, load, mem, disks, temp, nets] = await Promise.all([
      lib.cpu(),
      lib.currentLoad(),
      lib.mem(),
      lib.fsSize(),
      lib.cpuTemperature(),
      lib.networkStats(),
    ]);

    const real = nets.filter((n) => !LOOPBACK.test(n.iface));
    const rx = real.reduce((s, n) => s + n.rx_bytes, 0);
    const tx = real.reduce((s, n) => s + n.tx_bytes, 0);
    const at = now();
    let network = { rxBytesPerSec: 0, txBytesPerSec: 0 };
    if (last && at > last.at) {
      const secs = (at - last.at) / 1000;
      network = {
        rxBytesPerSec: Math.max(0, Math.round((rx - last.rx) / secs)),
        txBytesPerSec: Math.max(0, Math.round((tx - last.tx) / secs)),
      };
    }
    last = { at, rx, tx };

    return {
      cpu: { model: `${cpu.manufacturer} ${cpu.brand}`.trim(), cores: cpu.cores, loadPercent: Math.round(load.currentLoad * 10) / 10 },
      memory: { totalBytes: mem.total, usedBytes: mem.active },
      disks: disks.filter((d) => d.size > 0).map((d) => ({ mount: d.mount, totalBytes: d.size, usedBytes: d.used })),
      temperatureC: temp.main !== null && temp.main > 0 ? temp.main : null,
      uptimeSeconds: lib.time().uptime,
      network,
    };
  };
}
