/** Was an die KI geht: nur fertige, bereinigte Fakten aus den Regeln. */
export interface AiCardFact {
  id: string;
  level: 'problem' | 'warn';
  title: string;
  detail: string;
  /** App-Name aus dem Katalog */
  app?: string;
  state?: string;
  exitCode?: number;
  /** Bereinigte Fehlerzeilen, höchstens 5 zu je 300 Zeichen; fehlt, wenn Logzeilen aus sind */
  logLines?: string[];
}

export interface AiHintFact {
  id: string;
  kind: string;
  title: string;
  detail: string;
  facts: Record<string, string | number>;
}

export interface AiIncidentFact {
  id: string;
  title: string;
  detail: string;
}

/** Harmlose Eckdaten, keine Namen. */
export interface AiOverview {
  /** Stunden seit dem letzten Start des Rechners */
  uptimeHours: number;
  runningApps: number;
  /** Grob, auf 10 gerundet */
  cpuPercent: number;
  memoryPercent: number;
  /** Nur die Zahl, nie Namen; fehlt ohne Minecraft */
  minecraftPlayers?: number;
}

export interface AiFacts {
  scope: 'status' | 'hints' | 'test';
  /** Gesamtzustand der Übersicht (nur scope status) */
  overall?: 'ok' | 'warn' | 'problem';
  /** Nur wenn alles läuft: harmlose Eckdaten für einen freundlichen Kopfsatz */
  overview?: AiOverview;
  cards: AiCardFact[];
  incidents: AiIncidentFact[];
  hints: AiHintFact[];
}

/** Was von der KI übernommen wird, nach der Prüfung. Alles andere (Dringlichkeit, Knöpfe) kommt aus den Regeln. */
export interface AiTexts {
  headline: string | null;
  cards: Record<string, { title: string; detail: string }>;
  hints: Record<string, string>;
  popups: Record<string, string>;
}

/** Die kleine Schnittstelle zu einem KI-Anbieter. Gebaut ist nur Gemini, später gern mehr. */
export interface AiProvider {
  /** Liefert die rohe Antwort (geparstes JSON); geprüft wird sie danach von parseAiTexts. */
  summarize(facts: AiFacts): Promise<unknown>;
}

export type AiErrorCode = 'no_key' | 'limit' | 'rate_limit' | 'auth' | 'network' | 'model' | 'bad_response';

/** Feste Sätze, nie roher Fehlertext: der könnte den Schlüssel oder Anfragedaten enthalten. */
export const AI_ERROR_TEXT: Record<AiErrorCode, string> = {
  no_key: 'Es ist kein Schlüssel gesetzt.',
  limit: 'Die Tagesgrenze ist erreicht. Ab Mitternacht geht es weiter.',
  rate_limit: 'Google meldet zu viele Anfragen. Mainframe versucht es später wieder.',
  auth: 'Google lehnt den Schlüssel ab. Prüf ihn in den Einstellungen.',
  network: 'Google ist gerade nicht erreichbar.',
  model: 'Dieses Modell kennt Google nicht. Prüf den Modellnamen.',
  bad_response: 'Die Antwort der KI war unbrauchbar.',
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode) {
    super(AI_ERROR_TEXT[code]);
    this.code = code;
    this.name = 'AiError';
  }
}
