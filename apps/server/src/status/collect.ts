import type { InstalledApp, Prefs, ServiceStatus, StatusItem, StatusReport, SystemStats } from '@mainframe/shared';

export interface StatusInput {
  dockerOk: boolean;
  apps: InstalledApp[];
  services: ServiceStatus[];
  /** null = noch keine Probe */
  internetOnline: boolean | null;
  /** null = noch keine Messung */
  stats: SystemStats | null;
  thresholds: Prefs['thresholds'];
  unknownDevices: number;
  twoFactor: boolean;
}

const RANK: Record<StatusItem['level'], number> = { problem: 0, warn: 1, info: 2 };

/** Was an einer App schon am Container-Zustand falsch ist; null, wenn nichts. */
function appProblem(a: InstalledApp): StatusItem | null {
  const item = (title: string, detail: string): StatusItem => ({ id: `app:${a.id}`, level: 'problem', title, detail, to: '/apps', diagnose: a.id });
  if (a.state === 'error') return item(`${a.name} hat einen Fehler`, a.error ?? 'Die App ist nicht sauber gestartet.');
  if (a.state === 'restarting') return item(`${a.name} startet ständig neu`, 'Der Container stürzt immer wieder ab.');
  if (a.state === 'running' && a.health === 'unhealthy') return item(`${a.name} meldet „ungesund“`, 'Die App läuft, ihr eigener Gesundheits-Check schlägt aber fehl.');
  return null;
}

/**
 * Fasst alles zusammen, worum man sich kümmern muss. Probleme (rot) und Warnungen (gelb) zählen,
 * Hinweise (grau) nicht. Reihenfolge: Probleme, dann Warnungen, dann Hinweise.
 */
export function collectStatus(input: StatusInput): StatusReport {
  const items: StatusItem[] = [];

  if (!input.dockerOk) {
    // Ohne Docker hat jede App denselben Fehler: ein Eintrag statt vieler.
    items.push({ id: 'docker', level: 'problem', title: 'Docker läuft nicht', detail: 'Ohne Docker laufen keine Apps. Starte Docker Desktop oder den Rechner neu.', to: '/settings/docker', diagnose: 'system' });
  } else {
    const flagged = new Set<string>();
    for (const a of input.apps) {
      const p = appProblem(a);
      if (p) {
        items.push(p);
        flagged.add(a.id);
      } else if (a.state === 'stopped') {
        items.push({ id: `app:${a.id}`, level: 'info', title: `${a.name} ist gestoppt`, detail: 'Du hast die App angehalten. Starte sie, wenn du sie brauchst.', to: '/apps', diagnose: null });
        flagged.add(a.id);
      }
    }
    for (const s of input.services) {
      if (s.up !== false || s.kind !== 'app') continue;
      const appId = s.id.slice('app:'.length);
      if (flagged.has(appId)) continue;
      items.push({ id: `service:${s.id}`, level: 'problem', title: `${s.name} funktioniert nicht`, detail: s.reason ?? 'Die Weboberfläche antwortet nicht.', to: '/dienste', diagnose: appId });
    }
  }

  for (const s of input.services) {
    if (s.up !== false || s.kind !== 'link') continue;
    items.push({ id: `service:${s.id}`, level: 'warn', title: `${s.name} antwortet nicht`, detail: s.reason ?? 'Keine Antwort.', to: '/dienste', diagnose: null });
  }

  if (input.internetOnline === false) {
    items.push({ id: 'internet', level: 'warn', title: 'Kein Internet', detail: 'Mainframe erreicht das Internet gerade nicht. Apps im Heimnetz laufen trotzdem weiter.', to: '/dienste/internet', diagnose: 'system' });
  }

  const s = input.stats;
  const t = input.thresholds;
  if (s) {
    for (const d of s.disks) {
      if (d.totalBytes <= 0) continue;
      const pct = (d.usedBytes / d.totalBytes) * 100;
      if (pct >= t.disk) items.push({ id: `disk:${d.mount}`, level: 'warn', title: `Laufwerk ${d.mount} ist zu ${Math.round(pct)} % voll`, detail: 'Lösch alte Dateien oder räum Docker auf, bevor Apps keinen Platz mehr haben.', to: null, diagnose: 'system' });
    }
    if (s.memory.totalBytes > 0) {
      const pct = (s.memory.usedBytes / s.memory.totalBytes) * 100;
      if (pct >= t.memory) items.push({ id: 'memory', level: 'warn', title: `Arbeitsspeicher zu ${Math.round(pct)} % belegt`, detail: 'Schau, welche App gerade viel braucht.', to: '/details/memory', diagnose: 'system' });
    }
    if (s.temperatureC !== null && s.temperatureC >= t.temperature) {
      items.push({ id: 'temperature', level: 'warn', title: `Temperatur hoch: ${Math.round(s.temperatureC)} °C`, detail: 'Sorg für Luft um den Rechner und schau, was gerade viel Prozessor braucht.', to: '/details/temperature', diagnose: null });
    }
  }

  if (input.unknownDevices > 0) {
    const n = input.unknownDevices;
    items.push({ id: 'devices', level: 'info', title: n === 1 ? '1 unbekanntes Gerät im Netz' : `${n} unbekannte Geräte im Netz`, detail: 'Schau nach, ob du sie kennst, und markier sie als bekannt.', to: '/dienste/geraete', diagnose: null });
  }
  if (!input.twoFactor) {
    items.push({ id: 'twofactor', level: 'info', title: 'Zwei-Faktor-Anmeldung ist aus', detail: 'Mit einem Code vom Handy kommt niemand nur mit deinem Passwort rein.', to: '/settings/account', diagnose: null });
  }

  items.sort((a, b) => RANK[a.level] - RANK[b.level]);
  const count = items.filter((i) => i.level !== 'info').length;
  const level = items.some((i) => i.level === 'problem') ? 'problem' : count > 0 ? 'warn' : 'ok';
  const summary = count === 0 ? 'Alles läuft' : count === 1 ? '1 Sache braucht dich' : `${count} Sachen brauchen dich`;
  return { level, summary, items };
}
