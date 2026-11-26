import type { AppUsage, DiagnoseAction, DiagnoseStep, Prefs, SystemStats } from '@mainframe/shared';

export function step(id: string, label: string, ok: boolean | null, detail: string, fix: string | null = null, action: DiagnoseAction | null = null): DiagnoseStep {
  return { id, label, ok, detail, fix, action };
}

export function dockerStep(ok: boolean | null): DiagnoseStep {
  if (ok === null) return step('docker', 'Docker', null, 'Apps sind hier ausgeschaltet.');
  if (ok) return step('docker', 'Docker', true, 'Docker läuft.');
  return step('docker', 'Docker', false, 'Docker läuft nicht.', 'Starte Docker Desktop oder den Rechner neu.', { kind: 'link', to: '/settings/docker', label: 'Docker-Einstellungen' });
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0).replace('.', ',')} ${units[unit]}`;
}

export function diskStep(stats: SystemStats | null, thresholds: Prefs['thresholds'], label: string): DiagnoseStep {
  if (!stats) return step('disk', label, null, 'Keine Messwerte.');
  const fullest = stats.disks
    .filter((d) => d.totalBytes > 0)
    .map((d) => ({ mount: d.mount, pct: (d.usedBytes / d.totalBytes) * 100 }))
    .sort((a, b) => b.pct - a.pct)[0];
  if (fullest && fullest.pct >= thresholds.disk) {
    return step('disk', label, false, `Laufwerk ${fullest.mount} ist zu ${Math.round(fullest.pct)} % voll.`, 'Lösch alte Dateien oder räum Docker in den Einstellungen auf.', { kind: 'link', to: '/settings/docker', label: 'Docker aufräumen' });
  }
  return step('disk', label, true, 'Genug Platz auf allen Laufwerken.');
}

export function memoryStep(stats: SystemStats | null, thresholds: Prefs['thresholds'], usage: AppUsage | null = null): DiagnoseStep {
  if (!stats || stats.memory.totalBytes === 0) return step('memory', 'Arbeitsspeicher', null, 'Keine Messwerte.');
  const pct = (stats.memory.usedBytes / stats.memory.totalBytes) * 100;
  const detail = `Arbeitsspeicher zu ${Math.round(pct)} % belegt.` + (usage ? ` Die App braucht ${formatBytes(usage.memBytes)}.` : '');
  if (pct >= thresholds.memory) {
    return step('memory', 'Arbeitsspeicher', false, detail, 'Beende Apps, die du gerade nicht brauchst.', { kind: 'link', to: '/details/memory', label: 'Was braucht Speicher?' });
  }
  return step('memory', 'Arbeitsspeicher', true, detail);
}
