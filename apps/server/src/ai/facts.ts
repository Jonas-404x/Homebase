import { createHash } from 'node:crypto';
import type { StatusItem } from '@mainframe/shared';
import { isMinecraft, minecraftPlayers, scrubLine, scrubLogLines, type ScrubContext } from '../insights/scrub.ts';
import type { Hint } from '../insights/patterns.ts';
import type { AiCardFact, AiFacts, AiHintFact, AiIncidentFact, AiTexts } from './types.ts';

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
  incidents: AiIncidentFact[];
  ctx: ScrubContext;
  sendLogs: boolean;
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

/** Nur Laufwerksbuchstaben gehen raus, keine Pfade wie /media/<name>. */
export const maskMounts = (text: string) =>
  text.replace(/Laufwerk (\S+?)(?=\s|$)/g, (m, mount: string) => (/^[A-Za-z]:$/.test(mount) ? m : mount === '/' ? 'Systemlaufwerk' : 'Datenlaufwerk'));

const outgoing = (text: string, ctx: ScrubContext) => scrubLine(maskMounts(text), ctx);

/** Karten, für die die KI Text schreibt: Probleme und Warnungen, ohne eigene Links (deren Namen sind von dir). */
export const aiCard = (i: StatusItem) => i.level !== 'info' && !i.id.startsWith('service:link:');

/** Basis-Fingerabdruck aus id und level; den kann auch GET /api/status ohne Log billig bilden. */
export const baseFingerprint = (items: StatusItem[]) => hash(items.filter(aiCard).map((i) => `${i.id}:${i.level}`).sort().join('\n'));

export function buildStatusFacts(input: StatusFactsInput): StatusFacts {
  const { ctx } = input;
  const cards: AiCardFact[] = [];
  const parts: string[] = [];
  const idMap: IdMap = { cards: {}, hints: {}, popups: {} };
  for (const item of input.items.filter(aiCard)) {
    const sent = `c${cards.length + 1}`;
    idMap.cards[sent] = item.id;
    const card: AiCardFact = { id: sent, level: item.level as 'problem' | 'warn', title: outgoing(item.title, ctx), detail: outgoing(item.detail, ctx) };
    let part = `${item.id}:${item.level}`;
    const appId = item.diagnose && item.diagnose !== 'system' ? item.diagnose : null;
    const app = appId ? input.apps.get(appId) : undefined;
    if (appId && app) {
      const players = isMinecraft(appId) ? minecraftPlayers(app.logs) : [];
      const lines = scrubLogLines(app.logs.filter((l) => ERROR_LINE.test(l)), { ...ctx, players: [...ctx.players, ...players] });
      card.app = app.name;
      card.state = app.state;
      if (app.exitCode !== null) card.exitCode = app.exitCode;
      if (input.sendLogs && lines.length > 0) card.logLines = lines;
      // Zahlen raus, sonst ändert jede neue Uhrzeit im Log den Fingerabdruck.
      part += `|${app.state}|${app.exitCode ?? ''}|${(lines.at(-1) ?? '').replace(/\d+/g, '#')}`;
    }
    cards.push(card);
    parts.push(part);
  }
  const incidents = input.incidents.map((i, n) => {
    idMap.popups[`i${n + 1}`] = i.id;
    return { id: `i${n + 1}`, title: outgoing(i.title, ctx), detail: outgoing(i.detail, ctx) };
  });
  parts.push(...input.incidents.map((i) => `incident:${i.id}`));
  const overall = cards.some((c) => c.level === 'problem') ? 'problem' : 'warn';
  return {
    facts: { scope: 'status', overall, cards, incidents, hints: [] },
    fingerprint: hash(parts.sort().join('\n')),
    base: baseFingerprint(input.items),
    idMap,
  };
}

export function buildHintFacts(hints: Hint[], ctx: ScrubContext): { facts: AiFacts; fingerprint: string; idMap: IdMap } {
  const idMap: IdMap = { cards: {}, hints: {}, popups: {} };
  hints.forEach((h, n) => (idMap.hints[`h${n + 1}`] = h.id));
  const list: AiHintFact[] = hints.map((h, n) => ({
    id: `h${n + 1}`,
    kind: h.kind,
    title: outgoing(h.title, ctx),
    detail: outgoing(h.detail, ctx),
    facts: Object.fromEntries(Object.entries(h.facts).map(([k, v]) => [k, typeof v === 'string' ? outgoing(v, ctx) : v])),
  }));
  return { facts: { scope: 'hints', cards: [], incidents: [], hints: list }, fingerprint: hash(hints.map((h) => h.id).sort().join('\n')), idMap };
}
