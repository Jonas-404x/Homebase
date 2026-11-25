import { describe, expect, it } from 'vitest';
import type { DeviceInfo } from '@mainframe/shared';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { createDeviceStore } from '../src/network/store.ts';
import { parseOui } from '../src/network/oui.ts';
import { createScanner, isRandomMac, lanSubnet, parseArp, type ScanDeps } from '../src/network/scanner.ts';
import { createEventLog } from '../src/system/events.ts';
import { setupAndLogin, testDeps } from './helpers.ts';

// Beispielwerte, keine echten Geräte.
const WINDOWS = `
Schnittstelle: 192.168.1.20 --- 0xd
  Internetadresse       Physische Adresse     Typ
  192.168.1.1           3c-a6-2f-11-22-33     dynamisch
  192.168.1.31          da-a1-19-44-55-66     dynamisch
  192.168.1.255         ff-ff-ff-ff-ff-ff     statisch
  224.0.0.22            01-00-5e-00-00-16     statisch
  239.255.255.250       01-00-5e-7f-ff-fa     statisch

Schnittstelle: 172.20.0.1 --- 0x2a
  Internetadresse       Physische Adresse     Typ
  172.20.0.5            00-15-5d-aa-bb-cc     dynamisch
`;
const LINUX = `192.168.1.1 dev enp1s0 lladdr 3c:a6:2f:11:22:33 REACHABLE
192.168.1.44 dev enp1s0 lladdr b8:27:eb:01:02:03 STALE
192.168.1.99 dev enp1s0 FAILED
fe80::1 dev enp1s0 lladdr 3c:a6:2f:11:22:33 router STALE
`;

describe('parseArp', () => {
  it('liest die deutsche Windows-Ausgabe und lässt Rundruf-Adressen weg', () => {
    expect(parseArp(WINDOWS)).toEqual([
      { ip: '192.168.1.1', mac: '3c:a6:2f:11:22:33' },
      { ip: '192.168.1.31', mac: 'da:a1:19:44:55:66' },
      { ip: '172.20.0.5', mac: '00:15:5d:aa:bb:cc' },
    ]);
  });

  it('liest ip neigh unter Linux', () => {
    expect(parseArp(LINUX)).toEqual([
      { ip: '192.168.1.1', mac: '3c:a6:2f:11:22:33' },
      { ip: '192.168.1.44', mac: 'b8:27:eb:01:02:03' },
    ]);
  });
});

describe('Hilfen', () => {
  it('erkennt zufällige MAC-Adressen von Handys', () => {
    expect(isRandomMac('da:a1:19:44:55:66')).toBe(true);
    expect(isRandomMac('62:00:00:00:00:00')).toBe(true);
    expect(isRandomMac('3c:a6:2f:11:22:33')).toBe(false);
  });

  it('nimmt das Heimnetz, nicht Tailscale, WSL oder VirtualBox', () => {
    const v4 = (address: string, mac = '00:11:22:33:44:55') => ({ address, netmask: '255.255.255.0', family: 'IPv4' as const, mac, internal: false, cidr: null });
    expect(
      lanSubnet({
        Tailscale: [v4('100.64.0.20')],
        'vEthernet (WSL)': [v4('172.20.0.1')],
        VirtualBox: [v4('192.168.56.1')],
        Ethernet: [v4('192.168.1.20', '0a:0b:0c:0d:0e:0f')],
      }),
    ).toEqual({ prefix: '192.168.1', self: '192.168.1.20', mac: '0a:0b:0c:0d:0e:0f' });
    expect(lanSubnet({ Tailscale: [v4('100.64.0.20')] })).toBeNull();
  });

  it('liest die Hersteller-Liste der IEEE', () => {
    const oui = parseOui('Registry,Assignment,Organization Name,Organization Address\nMA-L,3CA62F,AVM GmbH,Berlin DE\nMA-L,B827EB,"Raspberry Pi Foundation",Cambridge GB\n');
    expect(oui.get('3CA62F')).toBe('AVM GmbH');
    expect(oui.get('B827EB')).toBe('Raspberry Pi Foundation');
  });
});

function fakeDeps(over: Partial<ScanDeps> = {}): ScanDeps & { arp: string } {
  const d = {
    arp: WINDOWS,
    lan: () => ({ prefix: '192.168.1', self: '192.168.1.20', mac: '0a:0b:0c:0d:0e:0f' }),
    sweep: async () => {},
    readArp: async () => d.arp,
    reverse: async (ip: string) => (ip === '192.168.1.1' ? 'router.local' : null),
    vendor: (mac: string) => (mac.startsWith('3c:a6:2f') ? 'AVM GmbH' : null),
    selfName: () => 'mainframe-pc',
    ...over,
  };
  return d;
}

describe('createScanner', () => {
  it('legt beim ersten Scan das Inventar still an und meldet später neue Geräte einmal', async () => {
    const store = createDeviceStore(openDb(':memory:'));
    const events = createEventLog();
    const deps = fakeDeps();
    const scanner = createScanner({ store, events, deps });
    await scanner.scan();
    const macs = store.list().map((d) => d.mac).sort();
    expect(macs).toEqual(['0a:0b:0c:0d:0e:0f', '3c:a6:2f:11:22:33', 'da:a1:19:44:55:66']);
    expect(store.list().find((d) => d.mac === '3c:a6:2f:11:22:33')).toMatchObject({ hostname: 'router.local', vendor: 'AVM GmbH' });
    expect(store.list().find((d) => d.mac === '0a:0b:0c:0d:0e:0f')).toMatchObject({ ip: '192.168.1.20', hostname: 'mainframe-pc' });
    expect(events.list()).toEqual([]);
    deps.arp = WINDOWS + '  192.168.1.50          b8-27-eb-01-02-03     dynamisch\n';
    await scanner.scan();
    await scanner.scan();
    expect(events.list().map((e) => e.text)).toEqual(['Neues Gerät im Netzwerk: 192.168.1.50']);
    expect(scanner.online().has('b8:27:eb:01:02:03')).toBe(true);
  });

  it('läuft nur einmal gleichzeitig', async () => {
    let sweeps = 0;
    let release: () => void = () => {};
    const scanner = createScanner({
      store: createDeviceStore(openDb(':memory:')),
      deps: fakeDeps({ sweep: () => (sweeps++, new Promise<void>((r) => (release = r))) }),
    });
    const a = scanner.scan();
    const b = scanner.scan();
    expect(scanner.running()).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    release();
    await Promise.all([a, b]);
    expect(sweeps).toBe(1);
    expect(scanner.running()).toBe(false);
  });
});

describe('/api/devices', () => {
  it('scannt, zeigt Geräte und speichert Name, Notiz und „Bekannt“', async () => {
    const app = await buildApp(testDeps({ scanIntervalMs: 0, network: fakeDeps() }));
    const cookie = await setupAndLogin(app);
    expect((await app.inject({ method: 'GET', url: '/api/devices' })).statusCode).toBe(401);
    const scanned = (await app.inject({ method: 'POST', url: '/api/devices/scan', headers: { cookie } })).json() as DeviceInfo[];
    expect(scanned.map((d) => d.ip)).toEqual(['192.168.1.1', '192.168.1.20', '192.168.1.31']);
    const phone = scanned.find((d) => d.ip === '192.168.1.31')!;
    expect(phone).toMatchObject({ randomMac: true, vendor: null, online: true, known: false });
    const mac = encodeURIComponent(phone.mac);
    expect((await app.inject({ method: 'PATCH', url: `/api/devices/${mac}`, headers: { cookie }, payload: { name: 'x'.repeat(41) } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/devices/${mac}`, headers: { cookie }, payload: { note: 'x'.repeat(201) } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/devices/${mac}`, headers: { cookie }, payload: { known: 'ja' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: '/api/devices/00%3A00%3A00%3A00%3A00%3A00', headers: { cookie }, payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/devices/${mac}`, headers: { cookie }, payload: { name: ' iPhone ', note: 'Jonas', known: true } })).statusCode).toBe(204);
    const list = (await app.inject({ method: 'GET', url: '/api/devices', headers: { cookie } })).json().devices as DeviceInfo[];
    expect(list.find((d) => d.mac === phone.mac)).toMatchObject({ name: 'iPhone', note: 'Jonas', known: true });
    await app.close();
  });
});
