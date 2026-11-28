import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MainframeError } from '../errors.ts';
import { SHARE_CONF } from './conf.ts';

/** Alle Systemzugriffe der Freigabe. Die echte Version läuft nur auf dem Linux-Server (als root). */
export interface ShareSystem {
  isLinuxServer(): boolean;
  /** smbd vorhanden und die Include-Datei vom Setup-Skript angelegt. */
  sambaInstalled(): Promise<boolean>;
  /** Wirklich eingehängt: anderes Gerät als der Ordner darüber. */
  isMounted(mount: string): Promise<boolean>;
  /** lstat: Verknüpfungen und Dateien zählen als 'other'. */
  inspectDir(p: string): Promise<'missing' | 'dir' | 'other'>;
  realpath(p: string): Promise<string>;
  /** Legt genau einen Ordner an, nicht rekursiv. */
  mkdir(p: string): Promise<void>;
  owner(p: string): Promise<{ user: string; group: string }>;
  lan(): { ip: string; netmask: string } | null;
  readConf(): Promise<string>;
  /** Schreibt in eine Temp-Datei, prüft mit testparm und ersetzt erst dann die echte Datei. */
  writeConfChecked(text: string): Promise<void>;
  /** Startet ein Programm ohne Shell. Wirft bei Exit-Code ≠ 0. */
  run(cmd: string, args: string[], stdin?: string): Promise<void>;
  smbdActive(): Promise<boolean>;
  statfs(p: string): Promise<{ freeBytes: number; totalBytes: number } | null>;
}

function exec(cmd: string, args: string[], stdin?: string): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout: 30_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout) });
    });
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
}

/** Name zu einer uid/gid aus /etc/passwd bzw. /etc/group. */
async function nameOf(file: string, id: number): Promise<string> {
  const text = await fs.readFile(file, 'utf8');
  for (const line of text.split('\n')) {
    const [name, , num] = line.split(':');
    if (name && Number(num) === id) return name;
  }
  throw new MainframeError('share_owner_unknown', 'Der Besitzer des Freigabe-Ordners ist unbekannt.', 500);
}

const isTailscale = (ip: string) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b! >= 64 && b! <= 127;
};

export function createRealShareSystem(): ShareSystem {
  return {
    isLinuxServer: () => process.platform === 'linux',
    async sambaInstalled() {
      try {
        await fs.access('/usr/sbin/smbd');
        await fs.access(SHARE_CONF);
        return true;
      } catch {
        return false;
      }
    },
    async isMounted(mount) {
      try {
        const [a, b] = await Promise.all([fs.stat(mount), fs.stat(path.dirname(mount))]);
        return a.dev !== b.dev;
      } catch {
        return false;
      }
    },
    async inspectDir(p) {
      try {
        const s = await fs.lstat(p);
        return s.isDirectory() ? 'dir' : 'other';
      } catch {
        return 'missing';
      }
    },
    realpath: (p) => fs.realpath(p),
    mkdir: (p) => fs.mkdir(p),
    async owner(p) {
      const s = await fs.stat(p);
      return { user: await nameOf('/etc/passwd', s.uid), group: await nameOf('/etc/group', s.gid) };
    },
    lan() {
      for (const [name, list] of Object.entries(os.networkInterfaces())) {
        if (/^(docker|br-|veth|tailscale|lo)/.test(name)) continue;
        for (const a of list ?? []) {
          if (a.family === 'IPv4' && !a.internal && !isTailscale(a.address)) return { ip: a.address, netmask: a.netmask };
        }
      }
      return null;
    },
    async readConf() {
      try {
        return await fs.readFile(SHARE_CONF, 'utf8');
      } catch {
        return '';
      }
    },
    async writeConfChecked(text) {
      const tmp = `${SHARE_CONF}.tmp`;
      await fs.writeFile(tmp, text, { mode: 0o644 });
      // testparm prüft die ganze smb.conf; die Temp-Datei allein reicht für die Syntax der Freigabe.
      const r = await exec('testparm', ['-s', '--suppress-prompt', tmp]);
      if (r.code !== 0) {
        await fs.rm(tmp, { force: true });
        throw new MainframeError('share_conf_invalid', 'Samba hat die Einstellungen abgelehnt.', 500);
      }
      await fs.rename(tmp, SHARE_CONF);
    },
    async run(cmd, args, stdin) {
      const r = await exec(cmd, args, stdin);
      if (r.code !== 0) throw new MainframeError('share_command_failed', `${cmd} ist fehlgeschlagen.`, 500);
    },
    smbdActive: async () => (await exec('systemctl', ['is-active', '--quiet', 'smbd'])).code === 0,
    async statfs(p) {
      try {
        const s = await fs.statfs(p);
        return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
      } catch {
        return null;
      }
    },
  };
}
