import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SystemInfo } from '@mainframe/shared';
import { repoRoot, type Config } from '../config.ts';

let cachedVersion: string | null = null;
export function mainframeVersion(): string {
  if (!cachedVersion) {
    try {
      cachedVersion = String(JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version ?? '0.0.0');
    } catch {
      cachedVersion = '0.0.0';
    }
  }
  return cachedVersion;
}

export function systemInfo(config: Config, startedAt: number, now = Date.now()): SystemInfo {
  const addresses = Object.entries(os.networkInterfaces()).flatMap(([iface, list]) =>
    (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => ({ iface, ip: a.address })),
  );
  // Heimnetz-Adressen zuerst (192.168.x vor VirtualBox- oder WSL-Adaptern).
  addresses.sort((a, b) => Number(b.ip.startsWith('192.168.')) - Number(a.ip.startsWith('192.168.')));
  return {
    hostname: os.hostname(),
    platform: process.platform,
    isServer: process.platform === 'linux' && !config.dev,
    addresses,
    port: config.port,
    version: mainframeVersion(),
    mainframeUptimeSec: Math.max(0, Math.round((now - startedAt) / 1000)),
    dataRoot: config.dataRoot,
    node: process.version,
  };
}
