import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBudget } from '../src/ai/budget.ts';
import { createAiEngine, type StatusSnapshot } from '../src/ai/engine.ts';
import { createAiConfig } from '../src/ai/settings.ts';
import { AiError, type AiFacts, type AiProvider } from '../src/ai/types.ts';
import { openDb, type Db } from '../src/db.ts';
import { createInsightsStore } from '../src/insights/store.ts';

const MIN = 60_000;
const KEY = 'test-key-not-real-0000';

const facts: AiFacts = { scope: 'status', overall: 'problem', cards: [{ id: 'c1', level: 'problem', title: 't', detail: 'd' }], incidents: [], hints: [] };
const snap = (fingerprint: string, over: Partial<StatusSnapshot> = {}): StatusSnapshot => ({
  fingerprint, base: 'base', facts, idMap: { cards: { c1: 'app:jellyfin' }, hints: {}, popups: {} }, issues: true, ...over,
});
const answer = { headline: 'Jellyfin stürzt ab.', cards: [{ id: 'c1', title: 'Jellyfin stürzt ab', text: 'Vermutlich fehlt etwas.' }] };

function setup(db: Db = openDb(':memory:'), behave: () => Promise<unknown> = async () => answer) {
  const config = createAiConfig(db);
  const calls: AiFacts[] = [];
  const provider: AiProvider = { summarize: async (f) => (calls.push(f), behave()) };
  const onTexts = vi.fn();
  const engine = createAiEngine({ db, store: createInsightsStore(db), config, providerFor: () => provider, onTexts });
  return { db, config, calls, engine, onTexts };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date(2026, 10, 26, 10, 0));
});
afterEach(() => vi.useRealTimers());

describe('AI engine', () => {
  it('fragt ohne Schlüssel nie', async () => {
    const { engine, calls } = setup();
    engine.observeStatus(snap('a'));
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(calls).toHaveLength(0);
    expect(engine.statusTexts('base')).toBeNull();
  });

  it('wartet 2 Minuten ab und fragt bei schnellen Änderungen nur einmal', async () => {
    const { engine, config, calls, onTexts } = setup();
    config.setKey(KEY);
    engine.observeStatus(snap('a'));
    await vi.advanceTimersByTimeAsync(MIN);
    engine.observeStatus(snap('b'));
    await vi.advanceTimersByTimeAsync(MIN + 59_000);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    expect(onTexts).toHaveBeenCalledTimes(1);
    expect(engine.statusTexts('base')?.cards).toEqual({ 'app:jellyfin': { title: 'Jellyfin stürzt ab', detail: 'Vermutlich fehlt etwas.' } });
    // Andere Basis (Karte hat sich geändert) oder anderer Fingerabdruck: keine alten Texte.
    expect(engine.statusTexts('other')).toBeNull();
    engine.observeStatus(snap('c'));
    expect(engine.statusTexts('base')).toBeNull();
  });

  it('eine App, die eine Stunde lang zwischen zwei Fehlerbildern springt, kostet höchstens zwei Anfragen', async () => {
    const { engine, config, calls } = setup();
    config.setKey(KEY);
    for (let i = 0; i < 20; i++) {
      engine.observeStatus(snap(i % 2 === 0 ? 'restarting' : 'error'));
      await vi.advanceTimersByTimeAsync(3 * MIN);
    }
    expect(calls).toHaveLength(2);
  });

  it('fragt nicht, wenn alles läuft', async () => {
    const { engine, config, calls } = setup();
    config.setKey(KEY);
    engine.observeStatus(snap('a', { issues: false }));
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(calls).toHaveLength(0);
  });

  it('fragt nach einem Neustart von Mainframe nicht neu, wenn der Zustand gleich ist, nach 6 Stunden aber einmal', async () => {
    const db = openDb(':memory:');
    const first = setup(db);
    first.config.setKey(KEY);
    first.engine.observeStatus(snap('a'));
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(first.calls).toHaveLength(1);
    first.engine.stop();

    const second = setup(db);
    second.engine.observeStatus(snap('a'));
    expect(second.engine.statusTexts('base')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(second.calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(6 * 60 * MIN);
    expect(second.engine.statusTexts('base')).toBeNull(); // abgelaufen
    second.engine.observeStatus(snap('a'));
    await vi.advanceTimersByTimeAsync(3 * MIN);
    second.engine.observeStatus(snap('a'));
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(second.calls).toHaveLength(1);
  });

  it('wartet nach einem Fehler 10 Minuten, zählt die Anfrage trotzdem und verrät keinen Rohtext', async () => {
    const { engine, config, calls, db } = setup(undefined, async () => { throw new AiError('rate_limit'); });
    config.setKey(KEY);
    engine.observeStatus(snap('a'));
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(calls).toHaveLength(1);
    expect(engine.state().lastError).toBe('Google meldet zu viele Anfragen. Mainframe versucht es später wieder.');
    for (let i = 0; i < 16; i++) {
      engine.observeStatus(snap('a'));
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(calls).toHaveLength(1); // 8 Minuten später: noch Pause
    for (let i = 0; i < 10; i++) {
      engine.observeStatus(snap('a'));
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(calls).toHaveLength(2);
    expect(createBudget(db).used()).toBe(2);
  });

  it('hält die Tagesgrenze ein und kennt "ohne Grenze"', async () => {
    const { engine, config, calls } = setup();
    config.setKey(KEY);
    config.update({ dailyLimit: 2 });
    for (const fp of ['a', 'b', 'c']) {
      engine.observeStatus(snap(fp));
      await vi.advanceTimersByTimeAsync(3 * MIN);
    }
    expect(calls).toHaveLength(2);
    expect(engine.state().lastError).toBe('Die Tagesgrenze ist erreicht. Ab Mitternacht geht es weiter.');
    expect(engine.usedToday()).toBe(2);
    config.update({ dailyLimit: null });
    engine.observeStatus(snap('d'));
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(calls).toHaveLength(3);
  });

  it('zählt ab Mitternacht neu', () => {
    const db = openDb(':memory:');
    const b = createBudget(db);
    expect(b.tryConsume(1)).toBe(true);
    expect(b.tryConsume(1)).toBe(false);
    vi.setSystemTime(new Date(2026, 10, 27, 0, 1));
    expect(b.tryConsume(1)).toBe(true);
  });

  it('verwirft eine kaputte Antwort und zeigt dann die festen Texte', async () => {
    const { engine, config } = setup(undefined, async () => ({ cards: 'kaputt' }));
    config.setKey(KEY);
    engine.observeStatus(snap('a'));
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(engine.statusTexts('base')).toBeNull();
    expect(engine.state().lastError).toBe('Die Antwort der KI war unbrauchbar.');
  });

  it('Hinweise: nur bei neuen Hinweisen und höchstens alle 6 Stunden', async () => {
    const { engine, config, calls } = setup(undefined, async () => ({ hints: [{ id: 'h1', text: 'Speicher wächst.' }, { id: 'h2', text: 'Nachts heiß.' }] }));
    config.setKey(KEY);
    const content: Record<string, string> = {};
    const hints = (...ids: string[]) => ({
      facts: { ...facts, scope: 'hints' as const },
      idMap: { cards: {}, popups: {}, hints: Object.fromEntries(ids.map((id, i) => [`h${i + 1}`, id])) },
      fingerprints: Object.fromEntries(ids.map((id) => [id, content[id] ?? 'v1'])),
    });
    engine.observeHints(hints('pattern:memory'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(engine.hintTexts()).toEqual({ 'pattern:memory': 'Speicher wächst.' });
    engine.observeHints(hints('pattern:memory'));
    engine.observeHints(hints('pattern:memory', 'night:x'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 6 * 60 * MIN);
    engine.observeHints(hints('pattern:memory', 'night:x'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(engine.hintTexts()).toEqual({ 'pattern:memory': 'Speicher wächst.', 'night:x': 'Nachts heiß.' });
    // Gleicher Inhalt: nie wieder. Neuer Inhalt (z. B. neuer Tagesschnitt): nach 6 Stunden einmal.
    vi.setSystemTime(Date.now() + 7 * 60 * MIN);
    engine.observeHints(hints('pattern:memory', 'night:x'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    content['pattern:memory'] = 'v2';
    engine.observeHints(hints('pattern:memory', 'night:x'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);
  });

  it('Hinweise ohne brauchbaren Text werden nach 6 Stunden noch mal versucht', async () => {
    const { engine, config, calls } = setup(undefined, async () => ({ hints: [{ id: 'h9', text: 'falsche id' }] }));
    config.setKey(KEY);
    const snapH = { facts: { ...facts, scope: 'hints' as const }, idMap: { cards: {}, popups: {}, hints: { h1: 'pattern:memory' } }, fingerprints: { 'pattern:memory': 'v1' } };
    engine.observeHints(snapH);
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.hintTexts()).toEqual({});
    engine.observeHints(snapH);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 6 * 60 * MIN);
    engine.observeHints(snapH);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
  });

  it('Kopfsatz, wenn alles läuft: nur wenn jemand hinschaut, dann höchstens einmal pro Stunde', async () => {
    const db = openDb(':memory:');
    const config = createAiConfig(db);
    const calls: AiFacts[] = [];
    let watched = false;
    const engine = createAiEngine({
      db, store: createInsightsStore(db), config, isWatched: () => watched,
      providerFor: () => ({ summarize: async (f) => (calls.push(f), { headline: 'Alles läuft super.' }) }),
    });
    config.setKey(KEY);
    const calm = snap('ok', { issues: false, calm: true, facts: { ...facts, overall: 'ok', cards: [] } });
    engine.observeStatus(calm);
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(calls).toHaveLength(0);
    watched = true;
    engine.observeStatus(calm);
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(calls).toHaveLength(1);
    expect(engine.statusTexts('base')?.headline).toBe('Alles läuft super.');
    for (let i = 0; i < 10; i++) {
      engine.observeStatus(calm);
      await vi.advanceTimersByTimeAsync(5 * MIN);
    }
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10 * MIN); // über 1 Stunde alt
    expect(engine.statusTexts('base')).toBeNull();
    engine.observeStatus(calm);
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(calls).toHaveLength(2);
  });

  it('der Logzeilen-Schalter gilt sofort, auch für schon gesammelte Fakten', async () => {
    const { engine, config, calls } = setup();
    config.setKey(KEY);
    engine.observeStatus(snap('a', { facts: { ...facts, cards: [{ ...facts.cards[0]!, logLines: ['ERROR x'] }] } }));
    config.update({ sendLogs: false });
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cards[0]!.logLines).toBeUndefined();
  });

  it('der Test-Knopf meldet Erfolg oder den Fehler in einfachen Worten', async () => {
    const good = setup();
    expect((await good.engine.test()).ok).toBe(false);
    good.config.setKey(KEY);
    expect(await good.engine.test()).toEqual({ ok: true, message: 'Jellyfin stürzt ab.' });
    const bad = setup(undefined, async () => { throw new AiError('auth'); });
    bad.config.setKey(KEY);
    expect(await bad.engine.test()).toEqual({ ok: false, message: 'Google lehnt den Schlüssel ab. Prüf ihn in den Einstellungen.' });
  });

  it('ist aus, wenn du es ausschaltest, auch mit Schlüssel', async () => {
    const { engine, config, calls } = setup();
    config.setKey(KEY);
    config.update({ enabled: false });
    engine.observeStatus(snap('a'));
    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect(calls).toHaveLength(0);
  });
});
