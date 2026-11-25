import { execFile } from 'node:child_process';
import dns from 'node:dns';
import net from 'node:net';
import os from 'node:os';
import type { EventLog } from '../system/events.ts';
import { createOui } from './oui.ts';
import type { DeviceStore } from './store.ts';

const IP = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
const MAC = /\b([0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})\b/i;

/** Einträge aus `arp -a` (Windows, jede Sprache) oder `ip neigh` (Linux), ohne Rundruf- und Gruppenadressen. */
export function parseArp(text: string): { ip: string; mac: string }[] {
  const out: { ip: string; mac: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^Schnittstelle|^Interface/i.test(line.trim())) continue;
    const ip = IP.exec(line)?.[1];
    const raw = MAC.exec(line)?.[1];
    if (!ip || !raw) continue;
    const mac = raw.toLowerCase().replace(/-/g, ':');
    const first = Number(ip.split('.')[0]);
    if (mac === 'ff:ff:ff:ff:ff:ff' || mac.startsWith('01:00:5e') || mac === '00:00:00:00:00:00') continue;
    if (first >= 224 || ip.endsWith('.255')) continue;
    out.push({ ip, mac });
  }
  return out;
}

/** Zufällige (lokal vergebene) MAC: Handys und Tablets nutzen sie zum Schutz der Privatsphäre. */
export const isRandomMac = (mac: string) => /^.[26ae]/i.test(mac);

const isPrivate = (ip: string) => {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

/** Das Heimnetz als /24: erste private Adresse, Heimnetz (192.168.x) vor WSL/Docker, ohne VirtualBox und Tailscale. */
export function lanSubnet(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): { prefix: string; self: string; mac: string } | null {
  const all = Object.values(ifaces)
    .flatMap((l) => l ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal && isPrivate(a.address) && !a.address.startsWith('192.168.56.'));
  all.sort((a, b) => Number(b.address.startsWith('192.168.')) - Number(a.address.startsWith('192.168.')));
  const a = all[0];
  return a ? { prefix: a.address.split('.').slice(0, 3).join('.'), self: a.address, mac: a.mac.toLowerCase() } : null;
}

export interface ScanDeps {
  lan: () => { prefix: string; self: string; mac: string } | null;
  /** Klopft jede Adresse kurz an, damit sie in der ARP-Tabelle auftaucht. */
  sweep: (ips: string[]) => Promise<void>;
  readArp: () => Promise<string>;
  reverse: (ip: string) => Promise<string | null>;
  vendor: (mac: string) => string | null;
  selfName: () => string;
  /** Vorbereitung vor jedem Scan (Hersteller-Liste laden). */
  prepare?: () => Promise<void>;
}

function knock(ip: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port: 80 });
    const done = () => {
      s.destroy();
      resolve();
    };
    s.setTimeout(timeoutMs, done);
    s.once('connect', done);
    s.once('error', done);
  });
}

/** Echte Werkzeuge: TCP-Anklopfen, `arp -a` bzw. `ip neigh`, Rückwärts-DNS, IEEE-Herstellerliste. */
export function realScanDeps(dataRoot: string): ScanDeps {
  const oui = createOui(dataRoot);
  return {
    lan: () => lanSubnet(),
    async sweep(ips) {
      const queue = [...ips];
      await Promise.all(Array.from({ length: 64 }, async () => {
        for (let ip = queue.shift(); ip; ip = queue.shift()) await knock(ip, 400);
      }));
    },
    readArp: () =>
      new Promise((resolve) => {
        const [cmd, args] = process.platform === 'win32' ? ['arp', ['-a']] : ['ip', ['neigh']];
        execFile(cmd, args as string[], { timeout: 10_000, windowsHide: true }, (_err, stdout) => resolve(String(stdout ?? '')));
      }),
    reverse: (ip) =>
      Promise.race([
        dns.promises.reverse(ip).then((n) => n[0] ?? null, () => null),
        new Promise<null>((r) => setTimeout(() => r(null), 1000).unref()),
      ]),
    vendor: (mac) => oui.lookup(mac),
    selfName: () => os.hostname(),
    prepare: () => oui.ready(),
  };
}

/** Scannt das Heimnetz und pflegt das Inventar. Nur ein Scan gleichzeitig. */
export function createScanner(opts: { store: DeviceStore; events?: EventLog; deps: ScanDeps; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let current: Promise<void> | null = null;
  let online = new Set<string>();

  const run = async () => {
    const d = opts.deps;
    const lan = d.lan();
    if (!lan) return;
    await d.prepare?.();
    const hosts = Array.from({ length: 254 }, (_, i) => `${lan.prefix}.${i + 1}`).filter((ip) => ip !== lan.self);
    await d.sweep(hosts);
    const found = parseArp(await d.readArp()).filter((e) => e.ip.startsWith(`${lan.prefix}.`) && e.ip !== lan.self);
    const firstScan = opts.store.list().length === 0;
    const seenAt = now();
    const entries = [
      { ip: lan.self, mac: lan.mac, hostname: d.selfName() as string | null },
      ...(await Promise.all(found.map(async (e) => ({ ...e, hostname: await d.reverse(e.ip) })))),
    ];
    const next = new Set<string>();
    for (const e of entries) {
      if (next.has(e.mac)) continue;
      next.add(e.mac);
      const vendor = isRandomMac(e.mac) ? null : d.vendor(e.mac);
      const { isNew } = opts.store.upsert({ mac: e.mac, ip: e.ip, hostname: e.hostname, vendor, seenAt });
      if (isNew && !firstScan) opts.events?.add('warn', `Neues Gerät im Netzwerk: ${e.hostname ?? vendor ?? e.ip}`);
    }
    online = next;
  };

  return {
    scan(): Promise<void> {
      current ??= run().finally(() => {
        current = null;
      });
      return current;
    },
    running: () => current !== null,
    online: () => online,
  };
}
