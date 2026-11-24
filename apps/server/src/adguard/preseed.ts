import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { stringify } from 'yaml';

/**
 * Schreibt eine Start-Konfiguration, damit AdGuard ohne Einrichtungsassistent startet.
 * Fehlende Felder ergänzt AdGuard beim ersten Start selbst.
 */
export async function writeAdguardPreseed(confDir: string, values: { adminUser: string; adminPassword: string }): Promise<void> {
  const file = path.join(confDir, 'AdGuardHome.yaml');
  try {
    await fs.access(file);
    return;
  } catch {
    // existiert noch nicht → schreiben
  }
  const config = {
    http: { address: '0.0.0.0:3000', session_ttl: '720h' },
    users: [{ name: values.adminUser, password: bcrypt.hashSync(values.adminPassword, 10) }],
    language: 'de',
    theme: 'auto',
    dns: {
      bind_hosts: ['0.0.0.0'],
      port: 53,
      upstream_dns: ['https://dns.cloudflare.com/dns-query', 'https://dns.quad9.net/dns-query'],
      bootstrap_dns: ['9.9.9.10', '1.1.1.1'],
    },
    filtering: { protection_enabled: true, filtering_enabled: true },
    filters: [
      {
        enabled: true,
        url: 'https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt',
        name: 'AdGuard DNS filter',
        id: 1,
      },
    ],
    schema_version: 29,
  };
  await fs.mkdir(confDir, { recursive: true });
  await fs.writeFile(file, stringify(config));
}
