import { Archive, Box, Info, LayoutDashboard, Network, Palette, Server, SlidersHorizontal, UserRound, type LucideIcon } from 'lucide-react';

export interface PaneRow {
  label: string;
  keywords?: string[];
}

export interface Pane {
  id: string;
  title: string;
  /** Kurzer Satz in der Liste unter dem Titel. */
  summary: string;
  icon: LucideIcon;
  keywords: string[];
  rows: PaneRow[];
}

/** Alle Bereiche mit ihren Einstellungen. Dient als Liste und als Index für die Suche. */
export const PANES: Pane[] = [
  {
    id: 'general',
    title: 'Allgemein',
    summary: 'Gerätename, Startseite, Zeitzone',
    icon: SlidersHorizontal,
    keywords: ['allgemein'],
    rows: [
      { label: 'Gerätename', keywords: ['name', 'titel', 'server'] },
      { label: 'Startseite', keywords: ['start', 'öffnen'] },
      { label: 'Zeitzone', keywords: ['zeit', 'uhr', 'datum'] },
    ],
  },
  {
    id: 'account',
    title: 'Konto & Sicherheit',
    summary: 'Benutzername, Passwort, angemeldete Geräte',
    icon: UserRound,
    keywords: ['konto', 'sicherheit', 'login'],
    rows: [
      { label: 'Benutzername', keywords: ['name', 'user'] },
      { label: 'Passwort ändern', keywords: ['kennwort', 'passwort'] },
      { label: 'Angemeldete Geräte', keywords: ['sitzung', 'session', 'abmelden', 'handy'] },
      { label: 'Angemeldet bleiben', keywords: ['tage', 'sitzung'] },
      { label: 'Anmelde-Protokoll', keywords: ['log', 'verlauf', 'fehlgeschlagen'] },
      { label: 'Auf diesem Gerät abmelden', keywords: ['logout', 'abmelden'] },
    ],
  },
  {
    id: 'appearance',
    title: 'Darstellung',
    summary: 'Akzentfarbe, Dichte, Einheiten',
    icon: Palette,
    keywords: ['design', 'aussehen', 'farbe'],
    rows: [
      { label: 'Akzentfarbe', keywords: ['farbe', 'blau', 'türkis', 'grün'] },
      { label: 'Dichte', keywords: ['kompakt', 'abstand'] },
      { label: 'Aktualisierung', keywords: ['takt', 'sekunden', 'live'] },
      { label: 'Speichergrößen', keywords: ['gb', 'gib', 'einheit'] },
      { label: 'Netzwerk-Einheit', keywords: ['mbit', 'bits', 'bytes'] },
    ],
  },
  {
    id: 'overview',
    title: 'Übersicht',
    summary: 'Karten, Warnschwellen, Verlauf',
    icon: LayoutDashboard,
    keywords: ['dashboard', 'start'],
    rows: [
      { label: 'Karten', keywords: ['reihenfolge', 'ausblenden', 'anzeigen'] },
      { label: 'Warnschwellen', keywords: ['warnung', 'grenze', 'prozent', 'temperatur'] },
      { label: 'Verlauf', keywords: ['kurve', 'minuten', 'stunden'] },
    ],
  },
  {
    id: 'network',
    title: 'Netzwerk',
    summary: 'Adressen, Handy-Zugang',
    icon: Network,
    keywords: ['ip', 'lan', 'wlan'],
    rows: [
      { label: 'Adressen', keywords: ['ip', 'hostname', 'port'] },
      { label: 'Am Handy öffnen', keywords: ['qr', 'code', 'iphone', 'scannen'] },
      { label: 'Fernzugriff', keywords: ['tailscale', 'unterwegs', 'vpn'] },
      { label: 'Netzwerkfreigabe', keywords: ['smb', 'explorer', 'laufwerk', 'samba'] },
    ],
  },
  {
    id: 'docker',
    title: 'Docker & Apps',
    summary: 'Version, Speicherverbrauch, Aufräumen',
    icon: Box,
    keywords: ['docker', 'container', 'images'],
    rows: [
      { label: 'Docker-Version', keywords: ['version'] },
      { label: 'Speicherverbrauch', keywords: ['platz', 'images', 'volumes', 'cache'] },
      { label: 'Aufräumen', keywords: ['prune', 'löschen', 'platz'] },
    ],
  },
  {
    id: 'system',
    title: 'System',
    summary: 'Laufzeit, Datenordner, Ereignisse',
    icon: Server,
    keywords: ['system', 'server'],
    rows: [
      { label: 'Mainframe-Version', keywords: ['version', 'node'] },
      { label: 'Datenordner', keywords: ['pfad', 'ordner', 'daten'] },
      { label: 'Ereignisse', keywords: ['log', 'protokoll', 'verlauf'] },
      { label: 'Neu starten', keywords: ['neustart', 'reboot'] },
      { label: 'Herunterfahren', keywords: ['aus', 'shutdown'] },
    ],
  },
  {
    id: 'backup',
    title: 'Sicherung',
    summary: 'Exportieren, Importieren, Zurücksetzen',
    icon: Archive,
    keywords: ['backup', 'sicherung'],
    rows: [
      { label: 'Einstellungen exportieren', keywords: ['herunterladen', 'datei', 'json'] },
      { label: 'Einstellungen importieren', keywords: ['hochladen', 'datei', 'wiederherstellen'] },
      { label: 'Zurücksetzen', keywords: ['reset', 'werkseinstellungen', 'löschen'] },
    ],
  },
  {
    id: 'about',
    title: 'Über Mainframe',
    summary: 'Version, Quellcode, Änderungen',
    icon: Info,
    keywords: ['über', 'info', 'version'],
    rows: [
      { label: 'Quellcode auf GitHub', keywords: ['github', 'code'] },
      { label: 'Änderungen', keywords: ['changelog', 'neu'] },
    ],
  },
];

export const paneById = (id: string | undefined) => PANES.find((p) => p.id === id);

/** Treffer für die Suche als „Bereich › Einstellung“. */
export function searchPanes(query: string): { pane: Pane; row: PaneRow }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hit = (s: string) => s.toLowerCase().includes(q);
  const out: { pane: Pane; row: PaneRow }[] = [];
  for (const pane of PANES) {
    const paneHit = hit(pane.title) || pane.keywords.some(hit);
    for (const row of pane.rows) if (paneHit || hit(row.label) || (row.keywords ?? []).some(hit)) out.push({ pane, row });
  }
  return out;
}
