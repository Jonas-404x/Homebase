import { describe, expect, it } from 'vitest';
import { cached } from '../src/system/details.ts';

describe('cached', () => {
  it('teilt eine laufende Abfrage und zählt die Haltezeit erst ab dem Ergebnis', async () => {
    let t = 0;
    let calls = 0;
    let finish: (v: number) => void = () => {};
    const get = cached(
      () => {
        calls++;
        return new Promise<number>((r) => (finish = r));
      },
      3000,
      () => t,
    );
    const a = get();
    t = 5000; // Abfrage dauert länger als die Haltezeit
    const b = get();
    expect(calls).toBe(1);
    finish(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    t = 7000; // 2 s nach dem Ergebnis: noch frisch
    await get();
    expect(calls).toBe(1);
    t = 8500;
    void get();
    expect(calls).toBe(2);
  });
});
