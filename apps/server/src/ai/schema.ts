import { z } from 'zod';
import type { AiTexts } from './types.ts';

export const LIMITS = { headline: 120, title: 60, text: 200 } as const;

/** JSON-Schema für Geminis strukturierte Ausgabe (responseJsonSchema). Geprüft wird trotzdem selbst, siehe parseAiTexts. */
export const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: `Kopfsatz, höchstens ${LIMITS.headline} Zeichen` },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'title', 'text'],
      },
    },
    hints: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
    popups: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
  },
} as const;

const idText = z.object({ id: z.string(), text: z.string() });
// Unbekannte Felder (z. B. level, to, Knöpfe) wirft zod beim Parsen weg.
const responseSchema = z.object({
  headline: z.string().nullish(),
  cards: z.array(z.object({ id: z.string(), title: z.string(), text: z.string() })).nullish(),
  hints: z.array(idText).nullish(),
  popups: z.array(idText).nullish(),
});

/** Steuerzeichen raus, Leerraum zusammen. Angezeigt wird ohnehin nur als reiner Text. */
const CONTROL = new RegExp('[\\x00-\\x1f\\x7f\\u2028\\u2029]', 'g');
const clean = (s: string) => s.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
const fits = (s: string, max: number) => s.length > 0 && s.length <= max;

export interface KnownIds {
  cards: string[];
  hints: string[];
  popups: string[];
}

/** Prüft die Antwort der KI. Passt sie nicht zum Schema: null (dann gelten die festen Texte). */
export function parseAiTexts(raw: unknown, ids: KnownIds): AiTexts | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
    } catch {
      return null;
    }
  }
  const r = responseSchema.safeParse(value);
  if (!r.success) return null;
  const out: AiTexts = { headline: null, cards: {}, hints: {}, popups: {} };
  const headline = r.data.headline ? clean(r.data.headline) : '';
  if (fits(headline, LIMITS.headline)) out.headline = headline;
  const cardIds = new Set(ids.cards);
  for (const c of r.data.cards ?? []) {
    const title = clean(c.title);
    const detail = clean(c.text);
    if (cardIds.has(c.id) && fits(title, LIMITS.title) && fits(detail, LIMITS.text)) out.cards[c.id] = { title, detail };
  }
  const take = (list: { id: string; text: string }[] | null | undefined, known: string[], into: Record<string, string>) => {
    const set = new Set(known);
    for (const h of list ?? []) {
      const text = clean(h.text);
      if (set.has(h.id) && fits(text, LIMITS.text)) into[h.id] = text;
    }
  };
  take(r.data.hints, ids.hints, out.hints);
  take(r.data.popups, ids.popups, out.popups);
  return out;
}
