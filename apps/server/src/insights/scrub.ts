import type { DeviceInfo } from '@mainframe/shared';

/**
 * Bereinigung von allem, was an die KI geht. Fängt das Übliche ab (IPs, MACs, Mails, Zugangsdaten,
 * Tokens, Benutzer in Pfaden, Geräte aus dem Scanner, Minecraft-Spieler), aber nicht garantiert alles.
 */
export interface ScrubContext {
  /** Gerätenamen, Hostnamen, IPs und MACs aus der Tabelle devices plus der eigene Hostname */
  blocklist: string[];
  /** Spielernamen aus dem Minecraft-Log */
  players: string[];
}

const HEX = '[0-9A-Fa-f]{1,4}';
// Reihenfolge zählt: Zugangsdaten in URLs vor Mails, MACs vor IPv6 (sonst frisst IPv6 die MAC).
const RULES: [RegExp, string][] = [
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@\S+/gi, '[url]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\b[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}\b/g, '[mac]'],
  [/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, '[ip]'],
  // IPv6 nur voll (8 Gruppen) oder mit "::" – so bleiben Uhrzeiten wie 14:02:33 stehen.
  [new RegExp(`(?<![\\w:])(?:${HEX}:){7}${HEX}(?![\\w:])`, 'g'), '[ip]'],
  [new RegExp(`(?<![\\w:])(?:${HEX}(?::${HEX})*)?::(?:${HEX}(?::${HEX})*)?(?![\\w:])`, 'g'), '[ip]'],
  [/([A-Za-z]:\\Users\\)[^\\\s]+/g, '$1[user]'],
  [/(\/(?:home|Users)\/)[^/\s]+/g, '$1[user]'],
  // Lange Zeichenketten mit Ziffern und Buchstaben sehen aus wie Schlüssel oder Tokens.
  [/(?<![\w\-+])(?=[\w\-+]*\d)(?=[\w\-+]*[A-Za-z])[\w\-+]{24,}={0,2}/g, '[token]'],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function wordsRegex(words: string[]): RegExp | null {
  const list = [...new Set(words.map((w) => w.trim()).filter((w) => w.length >= 3))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return null;
  return new RegExp(`(?<![\\w-])(?:${list.map(escape).join('|')})(?![\\w-])`, 'gi');
}

export function scrubLine(line: string, ctx: ScrubContext): string {
  let out = line;
  for (const [re, rep] of RULES) out = out.replace(re, (m, ...rest) => {
    // Ein einzelnes "::" ist keine Adresse.
    if (rep === '[ip]' && m === '::') return m;
    return rep.replace('$1', typeof rest[0] === 'string' ? rest[0] : '');
  });
  const devices = wordsRegex(ctx.blocklist);
  if (devices) out = out.replace(devices, '[gerät]');
  const players = wordsRegex(ctx.players);
  if (players) out = out.replace(players, '[spieler]');
  return out;
}

/** Die neuesten `max` Zeilen, bereinigt und danach auf `len` Zeichen gekürzt (erst bereinigen, sonst bleiben halbe IPs übrig). */
export function scrubLogLines(lines: string[], ctx: ScrubContext, opts: { max?: number; len?: number } = {}): string[] {
  const max = opts.max ?? 5;
  const len = opts.len ?? 300;
  return lines
    .slice(-max)
    .map((l) => scrubLine(l, ctx).trim())
    .map((l) => (l.length > len ? l.slice(0, len - 1) + '…' : l));
}

export function buildBlocklist(devices: Pick<DeviceInfo, 'mac' | 'ip' | 'hostname' | 'name'>[], hostname: string): string[] {
  const out = new Set<string>();
  for (const d of devices) for (const v of [d.name, d.hostname, d.ip, d.mac]) if (v && v.trim()) out.add(v.trim());
  if (hostname.trim()) out.add(hostname.trim());
  return [...out];
}

const NAME = '([A-Za-z0-9_]{3,16})';
const PLAYER_PATTERNS = [
  new RegExp(`UUID of player ${NAME} is`),
  new RegExp(`:\\s${NAME}\\[\\/[^\\]]*\\] logged in`),
  new RegExp(`:\\s${NAME} (?:joined|left) the game`),
  new RegExp(`:\\s<${NAME}>`),
  new RegExp(`:\\s${NAME} lost connection`),
];

/** Spielernamen aus einem Minecraft-Log (Anmelden, Chat, Verlassen). */
export function minecraftPlayers(lines: string[]): string[] {
  const out = new Set<string>();
  for (const l of lines) for (const re of PLAYER_PATTERNS) {
    const m = re.exec(l);
    if (m?.[1]) out.add(m[1]);
  }
  return [...out];
}

/** Minecraft-Apps im Katalog erkennt man an der ID. */
export const isMinecraft = (appId: string) => /minecraft/i.test(appId);
