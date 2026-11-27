import { describe, expect, it } from 'vitest';
import type { InstalledApp, StatusReport } from '@mainframe/shared';
import { barCells, createFlashDetector, findProblems, fmtBytes, fmtRate, fmtUptime, levels, type Problem } from '../src/monitor/model.ts';

const t = { memory: 90, disk: 90, temperature: 80 };
const app = (id: string, over: Partial<InstalledApp> = {}): InstalledApp => ({
  id, name: id, state: 'running', error: null, webUiUrl: null, installedAt: '2026-11-01', ...over,
});
const p = (key: string): Problem => ({ key, name: key, reason: '' });
const count = (cells: string[], c: string) => cells.filter((x) => x === c).length;

describe('barCells', () => {
  it('halb voll, alles grün', () => {
    const c = barCells(50, 70, 90, 10);
    expect(count(c, 'g')).toBe(5);
    expect(count(c, 'off')).toBe(5);
  });
  it('fast voll: grün, orange, rot', () => {
    const c = barCells(95, 70, 90, 10);
    expect([count(c, 'g'), count(c, 'o'), count(c, 'r'), count(c, 'off')]).toEqual([7, 2, 1, 0]);
  });
  it('begrenzt auf 0 bis 100', () => {
    expect(count(barCells(-5, 70, 90, 10), 'off')).toBe(10);
    expect(count(barCells(140, 70, 90, 10), 'off')).toBe(0);
  });
});

describe('levels', () => {
  it('Speicher: ab Grenze orange, 7 Punkte drüber rot', () => {
    expect(levels('memory', t)).toEqual({ warnAt: 90, redAt: 97 });
  });
  it('rot höchstens bei 98', () => {
    expect(levels('memory', { ...t, memory: 95 })).toEqual({ warnAt: 95, redAt: 98 });
  });
  it('Temperatur: 8 Grad drüber rot', () => {
    expect(levels('temperature', t)).toEqual({ warnAt: 80, redAt: 88 });
  });
  it('CPU fest 70/90', () => {
    expect(levels('cpu', t)).toEqual({ warnAt: 70, redAt: 90 });
  });
});

describe('findProblems', () => {
  it('abgestürzte App, kranke App, ausgefallener Dienst', () => {
    const list = findProblems(
      [app('minecraft', { state: 'error', error: 'exit 137' }), app('jelly', { health: 'unhealthy' }), app('ok')],
      [{ id: 'router', name: 'Router', reason: 'Antwortet nicht' }],
      null,
    );
    expect(list.map((x) => x.key)).toEqual(['app:minecraft', 'app:jelly', 'service:router']);
    expect(list[0]!.reason).toBe('exit 137');
  });
  it('Status „problem“ ohne andere Probleme gibt den Ersatz-Schlüssel', () => {
    const status: StatusReport = { level: 'problem', summary: 'Docker läuft nicht', items: [] };
    expect(findProblems([], [], status)).toEqual([{ key: 'status', name: 'system', reason: 'Docker läuft nicht' }]);
  });
  it('Status „problem“ mit App-Fehler: kein Ersatz-Schlüssel', () => {
    const status: StatusReport = { level: 'problem', summary: 'x', items: [] };
    expect(findProblems([app('a', { state: 'error' })], [], status).map((x) => x.key)).toEqual(['app:a']);
  });
  it('gestoppte Apps sind kein Problem', () => {
    expect(findProblems([app('a', { state: 'stopped' })], [], null)).toEqual([]);
  });
});

describe('createFlashDetector', () => {
  it('beim ersten Mal nie, danach nur neue Probleme', () => {
    const f = createFlashDetector();
    expect(f.next([p('app:a')], 0)).toBeNull();
    expect(f.next([p('app:a')], 1000)).toBeNull();
    expect(f.next([p('app:a'), p('app:b')], 2000)).toEqual([p('app:b')]);
  });
  it('leer, dann ein Fehler: blitzt', () => {
    const f = createFlashDetector();
    f.next([], 0);
    expect(f.next([p('app:a')], 1000)).toEqual([p('app:a')]);
  });
  it('kurz weg (Docker-Aussetzer) und wieder da: kein neuer Blitz', () => {
    const f = createFlashDetector();
    f.next([], 0);
    f.next([p('app:a')], 1000);
    f.next([], 2000);
    expect(f.next([p('app:a')], 32_000)).toBeNull();
  });
  it('länger als 2 Minuten weg und wieder da: blitzt erneut', () => {
    const f = createFlashDetector();
    f.next([], 0);
    f.next([p('app:a')], 1000);
    f.next([], 2000);
    f.next([], 200_000);
    expect(f.next([p('app:a')], 200_001)).toEqual([p('app:a')]);
  });
  it('der Ersatz-Schlüssel „status“ blitzt nie', () => {
    const f = createFlashDetector();
    f.next([], 0);
    expect(f.next([p('status')], 1000)).toBeNull();
  });
});

describe('Formate', () => {
  it('fmtBytes', () => {
    expect(fmtBytes(62 * 2 ** 20)).toBe('62M');
    expect(fmtBytes(2.9 * 2 ** 30)).toBe('2.9G');
    expect(fmtBytes(1.3 * 2 ** 40)).toBe('1.3T');
    expect(fmtBytes(512)).toBe('512B');
  });
  it('fmtUptime', () => {
    expect(fmtUptime(3 * 86400 + 4 * 3600 + 12 * 60)).toBe('3d 04:12');
    expect(fmtUptime(3 * 3600 + 5 * 60)).toBe('03:05');
  });
  it('fmtRate in MB/s mit einer Nachkommastelle', () => {
    expect(fmtRate(2.4 * 1024 * 1024)).toBe('2.4');
    expect(fmtRate(0)).toBe('0.0');
  });
});
