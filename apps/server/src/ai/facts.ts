import { createHash } from 'node:crypto';
import type { StatusItem } from '@mainframe/shared';
import { isMinecraft, minecraftPlayers, scrubLine, scrubLogLines, type ScrubContext } from '../insights/scrub.ts';
import type { Hint } from '../insights/patterns.ts';
import type { AiCardFact, AiFacts, AiHintFact, AiIncidentFact, AiOverview, AiTexts } from './types.ts';

/** Was die Diagnose als Fehlerzeile erkennt. */
const ERROR_LINE = /\b(error|fatal|exception|panic)\b/i;

export interface AppLogFacts {
  name: string;
  state: string;
  exitCode: number | null;
  /** Die letzten Log-Zeilen, noch unbereinigt */
  logs: string[];
}

export interface StatusFactsInput {
  items: StatusItem[];
  /** Nach App-ID */
  apps: Map<string, AppLogFacts>;
  /** key = Vorfall-Schlüssel wie "disk:/media/x" (für das Maskieren des Pfads) */
  incidents: (AiIncidentFact & { key?: string })[];
  ctx: ScrubContext;
  sendLogs: boolean;
  /** Harmlose Eckdaten für den Kopfsatz, wenn alles läuft */
  overview?: AiOverview;
}

export interface StatusFacts {
  facts: AiFacts;
  /** Ändert sich, wenn sich an den Karten etwas Wesentliches ändert (nicht bei jedem Prozentpunkt). */
  fingerprint: string;
  /** Nur id und level jeder Karte: damit prüft GET /api/status, ob ein KI-Text noch passt. */
  base: string;
  /** Gesendete IDs (c1, i1 …) zu echten IDs: echte IDs können Pfade enthalten (disk:/media/…) und gehen nicht raus. */
  idMap: IdMap;
}

export interface IdMap {
  cards: Record<string, string>;
  hints: Record<string, string>;
  popups: Record<string, string>;
}

/** Bekannte gesendete IDs für parseAiTexts. */
export const knownIds = (m: IdMap) => ({ cards: Object.keys(m.cards), hints: Object.keys(m.hints), popups: Object.keys(m.popups) });

/** Übersetzt die geprüfte KI-Antwort zurück auf echte IDs. */
export function remapTexts(t: AiTexts, m: IdMap): AiTexts {
  const back = <T>(rec: Record<string, T>, map: Record<string, string>) =>
    Object.fromEntries(Object.entries(rec).filter(([k]) => map[k] !== undefined).map(([k, v]) => [map[k]!, v]));
  return { headline: t.headline, cards: back(t.cards, m.cards), hints: back(t.hints, m.hints), popups: back(t.popups, m.popups) };
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 24);

/** Fallback für Texte ohne bekannten Pfad: nur Laufwerksbuchstaben gehen raus, keine Pfade wie /media/<name>. */
export const maskMounts = (text: string) =>
  text.replace(/Laufwerk (\S+?)(?=\s|$)/g, (m, mount: string) => (/^[A-Za-z]:$/.test(mount) ? m : mount === '/' ? 'Systemlaufwerk' : 'Datenlaufwerk'));

/** Ersetzt einen bekannten Pfad (auch mit Leerzeichen, z. B. „/media/Familie Muster“) überall im Text. */
export function maskMount(text: string, mount: string): string {
  if (/^[A-Za-z]:\\?$/.test(mount) || mount === '') return text;
  const label = mount === '/' ? 'Systemlaufwerk' : 'Datenlaufwerk';
  return text.split(`Laufwerk ${mount}`).join(label).split(mount).join('[laufwerk]');
}

/** Pfad des Laufwerks aus einer ID wie "disk:/media/x" oder "pattern:disk:/media/x". */
const mountOf = (id: string) => /^(?:pattern:)?disk:(.+)$/.exec(id)?.[1] ?? null;

const outgoing = (text: string, ctx: ScrubContext, id?: string) => {
  const mount = id ? mountOf(id) : null;
  return scrubLine(maskMounts(mount ? maskMount(text, mount) : text), ctx);
};

/** Karten, für die die KI Text schreibt: Probleme und Warnungen, ohne eigene Links (deren Namen sind von dir). */
export const aiCard = (i: StatusItem) => i.level !== 'info' && !i.id.startsWith('service:link:');

/** Basis-Fingerabdruck aus id und level; den kann auch GET /api/status ohne Log billig bilden. */
export const baseFingerprint = (items: StatusItem[]) => hash(items.filter(aiCard).map((i) => `${i.id}:${i.level}`).sort().join('\n'));

/** Zahlen und Hex-IDs raus, sonst ändert jede neue Uhrzeit oder Request-ID im Log den Fingerabdruck. */
const stable = (line: string) => line.replace(/\b[0-9a-f]{6,}\b/gi, '#').replace(/\d+/g, '#');

export function buildStatusFacts(input: StatusFactsInput): StatusFacts {
  const { ctx } = input;
  const cards: AiCardFact[] = [];
  const parts: string[] = [];
  const idMap: IdMap = { cards: {}, hints: {}, popups: {} };
  for (const item of input.items.filter(aiCard)) {
    const sent = `c${cards.length + 1}`;
    idMap.cards[sent] = item.id;
    const card: AiCardFact = { id: sent, level: item.level as 'problem' | 'warn', title: outgoing(item.title, ctx, item.id), detail: outgoing(item.detail, ctx, item.id) };
    let part = `${item.id}:${item.level}`;
    const appId = item.diagnose && item.diagnose !== 'system' ? item.diagnose : null;
    const app = appId ? input.apps.get(appId) : undefined;
    if (appId && app) {
      const players = isMinecraft(appId) ? minecraftPlayers(app.logs) : [];
      const lines = scrubLogLines(app.logs.filter((l) => ERROR_LINE.test(l)), { ...ctx, players: [...ctx.players, ...players] });
      card.app = app.name;
      card.state = app.state;
      if (app.exitCode !== null) card.exitCode = app.exitCode;
      part += `|${app.state}|${app.exitCode ?? ''}`;
      // Ohne Logzeilen zählt das Log auch nicht für den Fingerabdruck: sonst gäbe es neue Anfragen mit gleichen Fakten.
      if (input.sendLogs && lines.length > 0) {
        card.logLines = lines;
        part += `|${stable(lines.at(-1)!)}`;
      }
    }
    cards.push(card);
    parts.push(part);
  }
  const incidents = input.incidents.map((i, n) => {
    idMap.popups[`i${n + 1}`] = i.id;
    return { id: `i${n + 1}`, title: outgoing(i.title, ctx, i.key), detail: outgoing(i.detail, ctx, i.key) };
  });
  parts.push(...input.incidents.map((i) => `incident:${i.id}`));
  const calm = cards.length === 0 && incidents.length === 0;
  const overall = calm ? 'ok' : cards.some((c) => c.level === 'problem') ? 'problem' : 'warn';
  const facts: AiFacts = { scope: 'status', overall, cards, incidents, hints: [] };
  if (calm && input.overview) {
    facts.overview = input.overview;
    // Nur grobe, stabile Werte: Auslastung und Laufzeit ändern sich ständig und lösen keine neue Anfrage aus.
    parts.push(`ok|apps:${input.overview.runningApps}|mc:${input.overview.minecraftPlayers ?? ''}`);
  }
  return {
    facts,
    fingerprint: hash(parts.sort().join('\n')),
    base: baseFingerprint(input.items),
    idMap,
  };
}

export function buildHintFacts(hints: Hint[], ctx: ScrubContext): { facts: AiFacts; idMap: IdMap; fingerprints: Record<string, string> } {
  const idMap: IdMap = { cards: {}, hints: {}, popups: {} };
  const fingerprints: Record<string, string> = {};
  const list: AiHintFact[] = hints.map((h, n) => {
    idMap.hints[`h${n + 1}`] = h.id;
    // Fingerabdruck aus dem Inhalt: ändern sich die Zahlen (z. B. neuer Tagesschnitt), darf neu formuliert werden.
    fingerprints[h.id] = hash(JSON.stringify([h.id, h.title, h.detail, h.facts]));
    return {
      id: `h${n + 1}`,
      kind: h.kind,
      title: outgoing(h.title, ctx, h.id),
      detail: outgoing(h.detail, ctx, h.id),
      facts: Object.fromEntries(Object.entries(h.facts).map(([k, v]) => [k, typeof v === 'string' ? outgoing(v, ctx, h.id) : v])),
    };
  });
  return { facts: { scope: 'hints', cards: [], incidents: [], hints: list }, idMap, fingerprints };
}
