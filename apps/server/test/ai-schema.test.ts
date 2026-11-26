import { describe, expect, it } from 'vitest';
import type { StatusItem } from '@mainframe/shared';
import { baseFingerprint, buildHintFacts, buildStatusFacts, knownIds, remapTexts, type AppLogFacts } from '../src/ai/facts.ts';
import { parseAiTexts } from '../src/ai/schema.ts';

const ids = { cards: ['app:jellyfin'], hints: ['pattern:memory'], popups: ['1'] };

describe('parseAiTexts', () => {
  it('übernimmt passende Texte und wirft Dringlichkeit, Knöpfe und unbekannte ids weg', () => {
    const out = parseAiTexts(
      {
        headline: 'Jellyfin stürzt seit heute Nacht ab.',
        level: 'ok',
        cards: [
          { id: 'app:jellyfin', title: 'Jellyfin stürzt ab', text: 'Vermutlich fehlt die Konfiguration.', level: 'info', to: '/evil' },
          { id: 'app:erfunden', title: 'Erfunden', text: 'Gibt es nicht.' },
        ],
        hints: [{ id: 'pattern:memory', text: 'Der Speicher wächst.' }],
        popups: [{ id: '1', text: 'Docker läuft nicht.' }],
      },
      ids,
    );
    expect(out).toEqual({
      headline: 'Jellyfin stürzt seit heute Nacht ab.',
      cards: { 'app:jellyfin': { title: 'Jellyfin stürzt ab', detail: 'Vermutlich fehlt die Konfiguration.' } },
      hints: { 'pattern:memory': 'Der Speicher wächst.' },
      popups: { '1': 'Docker läuft nicht.' },
    });
  });

  it('verwirft zu lange Texte einzeln und eine kaputte Antwort ganz', () => {
    const out = parseAiTexts({ headline: 'x'.repeat(121), cards: [{ id: 'app:jellyfin', title: 'y'.repeat(61), text: 'ok' }] }, ids);
    expect(out).toEqual({ headline: null, cards: {}, hints: {}, popups: {} });
    expect(parseAiTexts({ cards: 'kaputt' }, ids)).toBeNull();
    expect(parseAiTexts('kein json', ids)).toBeNull();
    expect(parseAiTexts('```json\n{"headline":"Ok"}\n```', ids)?.headline).toBe('Ok');
  });

  it('entfernt Steuerzeichen', () => {
    expect(parseAiTexts({ headline: 'Zeile\u0000eins\n\nzwei' }, ids)?.headline).toBe('Zeile eins zwei');
  });
});

describe('buildStatusFacts', () => {
  const item = (over: Partial<StatusItem>): StatusItem => ({ id: 'x', level: 'problem', title: 't', detail: 'd', to: null, diagnose: null, ...over });
  const ctx = { blocklist: ['Keller-NAS'], players: [] };
  const jelly: AppLogFacts = { name: 'Jellyfin', state: 'error', exitCode: 1, logs: ['[10:00:01] info start', '[10:00:02] ERROR cannot reach Keller-NAS at 192.0.2.10', '[10:00:03] FATAL config missing in /home/maxmuster/jf'] };

  it('schickt nur Probleme und Warnungen, ohne eigene Links, bereinigt und mit maskierten Laufwerken', () => {
    const r = buildStatusFacts({
      items: [
        item({ id: 'app:jellyfin', title: 'Jellyfin hat einen Fehler', diagnose: 'jellyfin' }),
        item({ id: 'service:link:abc', level: 'warn', title: 'Keller-NAS antwortet nicht' }),
        item({ id: 'disk:/media/maxmuster-backup', level: 'warn', title: 'Laufwerk /media/maxmuster-backup ist zu 92 % voll' }),
        item({ id: 'twofactor', level: 'info', title: 'Zwei-Faktor-Anmeldung ist aus' }),
      ],
      apps: new Map([['jellyfin', jelly]]),
      incidents: [],
      ctx,
      sendLogs: true,
    });
    expect(r.idMap.cards).toEqual({ c1: 'app:jellyfin', c2: 'disk:/media/maxmuster-backup' });
    const json = JSON.stringify(r.facts);
    expect(json).not.toContain('Keller-NAS');
    expect(json).not.toContain('maxmuster');
    expect(json).not.toContain('192.0.2.10');
    expect(r.facts.cards[1]!.title).toBe('Datenlaufwerk ist zu 92 % voll');
    expect(r.facts.cards[0]!.logLines).toEqual(['[10:00:02] ERROR cannot reach [gerät] at [ip]', '[10:00:03] FATAL config missing in /home/[user]/jf']);
    expect(r.facts.cards[0]!.exitCode).toBe(1);
  });

  it('lässt Logzeilen weg, wenn der Schalter aus ist', () => {
    const r = buildStatusFacts({ items: [item({ id: 'app:jellyfin', diagnose: 'jellyfin' })], apps: new Map([['jellyfin', jelly]]), incidents: [], ctx, sendLogs: false });
    expect(r.facts.cards[0]!.logLines).toBeUndefined();
  });

  it('Fingerabdruck: gleich bei neuer Uhrzeit im Log, anders bei anderem Fehler; Basis nur aus id und level', () => {
    const fp = (logs: string[], level: StatusItem['level'] = 'problem') =>
      buildStatusFacts({ items: [item({ id: 'app:jellyfin', diagnose: 'jellyfin', level, title: `Jellyfin ${Math.random()}` })], apps: new Map([['jellyfin', { ...jelly, logs }]]), incidents: [], ctx, sendLogs: true });
    const a = fp(['[10:00:02] ERROR disk full']);
    const b = fp(['[11:30:59] ERROR disk full']);
    const c = fp(['[11:30:59] ERROR permission denied']);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    expect(a.base).toBe(c.base);
    expect(a.base).toBe(baseFingerprint([item({ id: 'app:jellyfin', level: 'problem' })]));
    expect(fp([], 'warn').base).not.toBe(a.base);
  });
});

describe('buildHintFacts', () => {
  it('schickt keine echten IDs und übersetzt die Antwort zurück', () => {
    const r = buildHintFacts([{ id: 'pattern:disk:/home/maxmuster', kind: 'disk-fill', title: 't', detail: 'd', facts: {} }], { blocklist: [], players: [] });
    expect(r.facts.hints[0]!.id).toBe('h1');
    const texts = parseAiTexts({ hints: [{ id: 'h1', text: 'Platte füllt sich.' }] }, knownIds(r.idMap))!;
    expect(remapTexts(texts, r.idMap).hints).toEqual({ 'pattern:disk:/home/maxmuster': 'Platte füllt sich.' });
  });

  it('bereinigt auch die Zahlen-Fakten der Hinweise', () => {
    const r = buildHintFacts([{ id: 'pattern:disk:/home/maxmuster', kind: 'disk-fill', title: 'Laufwerk /home/maxmuster füllt sich', detail: 'd', facts: { daysLeft: 3 } }], { blocklist: [], players: [] });
    expect(JSON.stringify(r.facts.hints[0]!.title)).not.toContain('maxmuster');
  });
});
