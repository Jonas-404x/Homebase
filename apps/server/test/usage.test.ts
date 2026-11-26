import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cpuPercent, diskByApp, dirSize, memBytes } from '../src/apps/usage.ts';

// Form wie eine echte Antwort von `docker stats` (gekürzt, Beispielwerte).
const sample = {
  cpu_stats: { cpu_usage: { total_usage: 3_801_253_000 }, system_cpu_usage: 47_030_290_000_000, online_cpus: 16 },
  precpu_stats: { cpu_usage: { total_usage: 3_800_253_000 }, system_cpu_usage: 47_030_190_000_000, online_cpus: 16 },
  memory_stats: { usage: 75_956_224, stats: { inactive_file: 27_041_792, anon: 45_596_672 } },
};

describe('Werte pro App', () => {
  it('rechnet die CPU-Last als Anteil am ganzen Rechner', () => {
    // 1 000 000 ns App-Zeit von 100 000 000 ns Gesamtzeit aller Kerne = 1 %
    expect(cpuPercent(sample)).toBe(1);
  });

  it('gibt beim ersten Messwert ohne Vorwert 0 statt NaN', () => {
    expect(cpuPercent({ ...sample, precpu_stats: {} })).toBe(0);
    expect(cpuPercent({})).toBe(0);
    expect(cpuPercent({ ...sample, precpu_stats: sample.cpu_stats })).toBe(0);
  });

  it('zählt beim RAM den wegwerfbaren Datei-Zwischenspeicher nicht mit', () => {
    expect(memBytes(sample)).toBe(75_956_224 - 27_041_792);
    expect(memBytes({ memory_stats: { usage: 1000, stats: { cache: 400 } } })).toBe(600);
    expect(memBytes({ memory_stats: { usage: 100, stats: { inactive_file: 400 } } })).toBe(0);
    expect(memBytes({})).toBe(0);
  });

  it('zählt Container-Schicht, Volumes des Compose-Projekts und den App-Ordner zusammen', () => {
    const df = {
      Containers: [
        { Labels: { 'mainframe.app': 'adguard' }, SizeRw: 8192 },
        { Labels: { 'mainframe.app': 'ntfy' }, SizeRw: 100 },
        { Labels: {}, SizeRw: 999 },
      ],
      Volumes: [
        { Labels: { 'com.docker.compose.project': 'mf-adguard' }, UsageData: { Size: 4_750_631 } },
        { Labels: { 'com.docker.compose.project': 'fremd' }, UsageData: { Size: 5 } },
        { Labels: null, UsageData: { Size: -1 } },
      ],
    };
    const dirs = new Map([['adguard', 1000], ['ntfy', 0]]);
    expect(diskByApp(df, ['adguard', 'ntfy'], dirs)).toEqual(new Map([['adguard', 8192 + 4_750_631 + 1000], ['ntfy', 100]]));
  });

  it('misst die Größe eines Ordners samt Unterordnern', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mf-size-'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'x'.repeat(100));
    await fs.mkdir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'sub', 'b.txt'), 'y'.repeat(50));
    expect(await dirSize(dir)).toBe(150);
    expect(await dirSize(path.join(dir, 'gibt-es-nicht'))).toBe(0);
  });
});
