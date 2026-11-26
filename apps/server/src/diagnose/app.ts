import type { AppUsage, DiagnoseAction, DiagnoseReport, DiagnoseStep, InstalledApp, Prefs, SystemStats } from '@mainframe/shared';
import type { AppInspect } from '../apps/docker-status.ts';
import type { CheckResult } from '../services/checker.ts';
import { diskStep, dockerStep, memoryStep, step } from './common.ts';

export interface AppFacts {
  app: InstalledApp;
  dockerOk: boolean;
  inspect: AppInspect | null;
  web: CheckResult | null;
  stats: SystemStats | null;
  thresholds: Prefs['thresholds'];
  usage: AppUsage | null;
}

const STATES = new Map([
  ['exited', 'beendet'], ['restarting', 'startet neu'], ['paused', 'pausiert'], ['created', 'nicht gestartet'], ['dead', 'kaputt'],
]);

export function diagnoseApp(f: AppFacts): DiagnoseReport {
  const steps: DiagnoseStep[] = [dockerStep(f.dockerOk)];
  const restart: DiagnoseAction = { kind: 'restart-app', appId: f.app.id };
  const containers = f.inspect?.containers ?? [];
  const running = containers.length > 0 && containers.every((c) => c.state === 'running');
  // Von dir angehalten: kein Absturz, nur ein Hinweis.
  const byUser = f.app.state === 'stopped' && !running;
  if (byUser) {
    steps.push(step('container', 'Container läuft', null, 'Du hast die App angehalten.'));
  } else if (containers.length === 0) {
    steps.push(step('container', 'Container läuft', false, 'Für die App gibt es keinen Container.', 'Starte die App neu.', restart));
  } else if (running) {
    steps.push(step('container', 'Container läuft', true, containers.length === 1 ? 'Der Container läuft.' : 'Alle Container laufen.'));
  } else {
    const detail = containers.filter((c) => c.state !== 'running').map((c) => `${c.name}: ${STATES.get(c.state) ?? c.state}`).join(', ') + '.';
    steps.push(step('container', 'Container läuft', false, detail, 'Starte die App neu.', restart));
  }

  const failed = containers.find((c) => c.state !== 'running' && c.exitCode !== 0);
  // Neustarts zählen nur, wenn sie gerade passieren: der Zähler bleibt sonst wochenlang stehen.
  const recent = (c: (typeof containers)[number]) => c.state === 'restarting' || (c.startedAt !== null && Date.now() - Date.parse(c.startedAt) < 10 * 60_000);
  const restarts = Math.max(0, ...containers.filter(recent).map((c) => c.restartCount));
  const logFix = 'Schau unten ins Log, dort steht meist, was fehlt.';
  if (byUser) {
    steps.push(step('crashes', 'Abstürze', null, 'Übersprungen, weil du die App angehalten hast.'));
  } else if (containers.some((c) => c.oomKilled)) {
    steps.push(step('crashes', 'Abstürze', false, 'Der Container wurde beendet, weil der Arbeitsspeicher voll war.', 'Beende andere Apps oder gib dem Rechner mehr Arbeitsspeicher.', restart));
  } else if (failed) {
    steps.push(step('crashes', 'Abstürze', false, `Beendet mit Fehlercode ${failed.exitCode}` + (failed.restartCount > 0 ? `, ${failed.restartCount}-mal neu gestartet` : '') + '.', logFix, restart));
  } else if (restarts > 0) {
    steps.push(step('crashes', 'Abstürze', false, `${restarts}-mal neu gestartet.`, logFix, restart));
  } else {
    steps.push(step('crashes', 'Abstürze', true, 'Keine Abstürze.'));
  }

  const healths = containers.map((c) => c.health).filter((h) => h !== null);
  if (running && healths.length > 0) {
    if (healths.includes('unhealthy')) steps.push(step('health', 'Gesundheits-Check', false, 'Die App läuft, ihr eigener Gesundheits-Check schlägt aber fehl.', logFix, restart));
    else if (healths.includes('starting')) steps.push(step('health', 'Gesundheits-Check', null, 'Der Gesundheits-Check läuft noch. Prüf in einer Minute noch mal.'));
    else steps.push(step('health', 'Gesundheits-Check', true, 'Der Gesundheits-Check ist in Ordnung.'));
  }

  const errors = (f.inspect?.logs ?? []).filter((line) => /\b(error|fatal|exception|panic)\b/i.test(line)).slice(-3);
  if (errors.length > 0) {
    const detail = errors.map((line) => line.trim()).map((line) => line.length > 160 ? line.slice(0, 160) + '…' : line).join(' · ');
    steps.push(step('log', 'Fehler im Log', false, detail, 'Die Meldung zeigt meist, was fehlt. Sonst hilft ein Neustart.'));
  } else {
    steps.push(step('log', 'Fehler im Log', true, 'Keine Fehlermeldungen in den letzten 50 Zeilen.'));
  }

  for (const [id, label] of [['port', 'Port offen'], ['web', 'Weboberfläche']]) {
    if (!f.app.webUiUrl) {
      steps.push(step(id, label, null, 'Die App hat keine Weboberfläche.'));
    } else if (!running) {
      steps.push(step(id, label, null, 'Übersprungen, weil der Container nicht läuft.'));
    } else if (id === 'port') {
      const port = Number(/^:(\d+)/.exec(f.app.webUiUrl)?.[1]);
      steps.push(containers.some((c) => c.ports.includes(port))
        ? step(id, label, true, `Port ${port} ist offen.`)
        : step(id, label, false, `Port ${port} ist nicht freigegeben.`, 'Starte die App neu, damit Docker den Port wieder öffnet.', restart));
    } else if (!f.web) {
      steps.push(step(id, label, null, 'Nicht geprüft.'));
    } else {
      steps.push(f.web.ok
        ? step(id, label, true, `Antwortet in ${f.web.ms} ms.`)
        : step(id, label, false, `${f.web.reason ?? 'Keine Antwort'}.`, 'Warte kurz nach dem Start und prüf dann noch mal. Hilft das nicht, starte die App neu.', restart));
    }
  }
  steps.push(diskStep(f.stats, f.thresholds, 'Speicherplatz'), memoryStep(f.stats, f.thresholds, f.usage));
  if (!f.dockerOk) {
    for (let i = 1; i < steps.length; i++) steps[i] = step(steps[i].id, steps[i].label, null, 'Übersprungen, weil Docker nicht läuft.');
  }
  return { target: f.app.id, ok: !steps.some((s) => s.ok === false), steps };
}
