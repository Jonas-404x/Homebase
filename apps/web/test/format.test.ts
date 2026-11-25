import { describe, expect, it } from 'vitest';
import { rate, size, usedOfTotal } from '../src/format.ts';

describe('Einheiten', () => {
  it('Netzwerk in Bytes oder Bits', () => {
    expect(rate(125000)).toBe('125 kB/s');
    expect(rate(2_500_000)).toBe('2,5 MB/s');
    expect(rate(125000, 'bits')).toBe('1,0 Mbit/s');
    expect(rate(12500, 'bits')).toBe('100 kbit/s');
  });

  it('Speichergrößen in GB oder GiB', () => {
    expect(size(1_000_000_000)).toBe('1,0 GB');
    expect(size(1073741824, 'iec')).toBe('1,0 GiB');
    expect(size(512 * 1024 ** 2, 'iec')).toBe('512 MiB');
    expect(size(350_000_000)).toBe('350 MB');
    expect(usedOfTotal(4e9, 8e9)).toBe('4,0 / 8,0 GB');
    expect(usedOfTotal(4 * 1024 ** 3, 8 * 1024 ** 3, 'iec')).toBe('4,0 / 8,0 GiB');
  });
});
