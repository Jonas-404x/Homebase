import type { DiagnoseReport, DiagnoseStep, InstalledApp, Prefs, ServiceStatus, SystemStats } from '@mainframe/shared';
import type { CheckResult } from '../services/checker.ts';
import { diskStep, dockerStep, memoryStep, step } from './common.ts';

export interface SystemFacts {
  dockerOk: boolean | null;
  apps: InstalledApp[];
  services: ServiceStatus[];
  internet: CheckResult | null;
  dns: { ok: boolean; reason: string | null } | null;
  stats: SystemStats | null;
  thresholds: Prefs['thresholds'];
}

export function diagnoseSystem(f: SystemFacts): DiagnoseReport {
  const steps: DiagnoseStep[] = [dockerStep(f.dockerOk)];
  for (const app of f.apps) {
    const id = `app:${app.id}`;
    let detail: string | null = null;
    if (f.dockerOk === false) steps.push(step(id, app.name, null, 'Übersprungen, weil Docker nicht läuft.'));
    else if (app.state === 'installing') steps.push(step(id, app.name, null, 'Wird gerade installiert.'));
    else if (app.state === 'stopped') steps.push(step(id, app.name, null, 'Gestoppt.'));
    else {
      if (app.state === 'error') {
        detail = app.error ?? 'Die App ist nicht sauber gestartet';
        if (!detail.endsWith('.')) detail += '.';
      } else if (app.state === 'restarting') detail = 'Startet ständig neu.';
      else if (app.state === 'running' && app.health === 'unhealthy') detail = 'Meldet „ungesund“.';
      else if (app.state === 'running') {
        const web = f.services.find((s) => s.id === `app:${app.id}`);
        if (web?.up === false) detail = `Weboberfläche: ${web.reason ?? 'Antwortet nicht'}.`;
      }
      steps.push(detail === null
        ? step(id, app.name, true, 'Läuft.')
        : step(id, app.name, false, detail, 'Öffne die Diagnose der App für Details.', { kind: 'link', to: '/apps', label: 'Zu den Apps' }));
    }
  }

  const links = f.services.filter((s) => s.kind === 'link');
  const down = links.filter((s) => s.up === false);
  if (links.length === 0) steps.push(step('services', 'Dienste', null, 'Keine eigenen Links angelegt.'));
  else if (down.length === 0) steps.push(step('services', 'Dienste', true, 'Alle eigenen Links antworten.'));
  else steps.push(step('services', 'Dienste', false, `Antwortet nicht: ${down.map((s) => s.name).join(', ')}.`, 'Prüf, ob die Geräte eingeschaltet und im Netz sind.', { kind: 'link', to: '/dienste', label: 'Zu den Diensten' }));

  if (!f.internet) steps.push(step('internet', 'Internet', null, 'Nicht geprüft.'));
  else if (f.internet.ok) steps.push(step('internet', 'Internet', true, `Erreichbar in ${f.internet.ms} ms.`));
  else steps.push(step('internet', 'Internet', false, 'Mainframe erreicht das Internet nicht.', 'Prüf Router und Kabel. Apps im Heimnetz laufen trotzdem weiter.', { kind: 'link', to: '/dienste/internet', label: 'Internet-Verlauf' }));

  if (!f.dns) steps.push(step('dns', 'Namensauflösung (DNS)', null, 'Nicht geprüft.'));
  else if (f.dns.ok) steps.push(step('dns', 'Namensauflösung (DNS)', true, 'Namen wie cloudflare.com werden aufgelöst.'));
  else steps.push(step('dns', 'Namensauflösung (DNS)', false, `Namen werden nicht aufgelöst (${f.dns.reason ?? 'keine Antwort'}).`, 'Prüf die DNS-Einstellung im Router oder in AdGuard Home.'));

  steps.push(diskStep(f.stats, f.thresholds, 'Laufwerke'), memoryStep(f.stats, f.thresholds));
  if (!f.stats) steps.push(step('temperature', 'Temperatur', null, 'Keine Messwerte.'));
  else if (f.stats.temperatureC === null) steps.push(step('temperature', 'Temperatur', null, 'Der Rechner meldet keine Temperatur.'));
  else if (f.stats.temperatureC >= f.thresholds.temperature) steps.push(step('temperature', 'Temperatur', false, `${Math.round(f.stats.temperatureC)} °C, das ist zu warm.`, 'Sorg für Luft um den Rechner und schau, was gerade viel Prozessor braucht.', { kind: 'link', to: '/details/temperature', label: 'Temperatur-Verlauf' }));
  else steps.push(step('temperature', 'Temperatur', true, `${Math.round(f.stats.temperatureC)} °C.`));
  return { target: 'system', ok: !steps.some((s) => s.ok === false), steps };
}
