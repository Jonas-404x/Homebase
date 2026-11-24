import { describe, expect, it } from 'vitest';
import { createStatsProvider, type SiLike } from '../src/system/stats.ts';

function fakeSi(opts: { temp: number; rx: number[]; tx: number[] }): SiLike {
  let call = 0;
  return {
    cpu: async () => ({ manufacturer: 'Intel', brand: 'Core i5-7500', cores: 4 }),
    currentLoad: async () => ({ currentLoad: 12.345 }),
    mem: async () => ({ total: 8e9, active: 3.2e9 }),
    fsSize: async () => [
      { mount: '/', size: 256e9, used: 40e9 },
      { mount: '/leer', size: 0, used: 0 },
    ],
    cpuTemperature: async () => ({ main: opts.temp }),
    time: () => ({ uptime: 3600 }),
    networkStats: async () => {
      const i = call++;
      return [
        { iface: 'eth0', rx_bytes: opts.rx[i]!, tx_bytes: opts.tx[i]! },
        { iface: 'lo', rx_bytes: 999999, tx_bytes: 999999 },
      ];
    },
  };
}

describe('createStatsProvider', () => {
  it('mappt die Werte von systeminformation', async () => {
    const stats = await createStatsProvider(fakeSi({ temp: 41, rx: [0], tx: [0] }), () => 0)();
    expect(stats.cpu).toEqual({ model: 'Intel Core i5-7500', cores: 4, loadPercent: 12.3 });
    expect(stats.memory).toEqual({ totalBytes: 8e9, usedBytes: 3.2e9 });
    expect(stats.disks).toEqual([{ mount: '/', totalBytes: 256e9, usedBytes: 40e9 }]);
    expect(stats.temperatureC).toBe(41);
    expect(stats.uptimeSeconds).toBe(3600);
  });

  it('liefert null, wenn keine Temperatur verfügbar ist (Windows)', async () => {
    const stats = await createStatsProvider(fakeSi({ temp: -1, rx: [0], tx: [0] }), () => 0)();
    expect(stats.temperatureC).toBeNull();
  });

  it('berechnet die Netzwerkrate aus der Zählerdifferenz ohne Loopback', async () => {
    let t = 0;
    const provider = createStatsProvider(fakeSi({ temp: 40, rx: [1000, 5000], tx: [500, 1500] }), () => t);
    const first = await provider();
    expect(first.network).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 });
    t = 2000;
    const second = await provider();
    expect(second.network).toEqual({ rxBytesPerSec: 2000, txBytesPerSec: 500 });
  });
});
