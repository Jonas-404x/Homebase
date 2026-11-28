import { describe, expect, it } from 'vitest';
import { MainframeError } from '../src/errors.ts';
import { createShareService } from '../src/share/service.ts';
import type { ShareSystem } from '../src/share/system.ts';

const ROOT = '/mnt/hdd/Mainframe';
const MOUNT = '/mnt/hdd';

interface FakeOpts {
  linux?: boolean;
  samba?: boolean;
  mounted?: boolean;
  dir?: 'missing' | 'dir' | 'other';
  real?: string;
  testparmFails?: boolean;
  slowRun?: boolean;
  ownerRoot?: boolean;
  root?: string;
}

function fake(o: FakeOpts = {}) {
  const calls: string[] = [];
  const stdins: string[] = [];
  let conf = '';
  let active = false;
  let dir = o.dir ?? 'missing';
  const sys: ShareSystem = {
    isLinuxServer: () => o.linux ?? true,
    sambaInstalled: async () => o.samba ?? true,
    isMounted: async () => o.mounted ?? true,
    inspectDir: async () => dir,
    realpath: async (p) => o.real ?? p,
    mkdir: async (p) => {
      calls.push('mkdir ' + p);
      dir = 'dir';
    },
    owner: async () => (o.ownerRoot ? { user: 'root', group: 'root', uid: 0, gid: 0 } : { user: 'jonas', group: 'jonas', uid: 1000, gid: 1000 }),
    lan: () => ({ ip: '192.168.1.23', netmask: '255.255.255.0' }),
    readConf: async () => conf,
    writeConfChecked: async (text) => {
      if (o.testparmFails) throw new MainframeError('share_conf_invalid', 'kaputt', 500);
      calls.push('write ' + text.length);
      conf = text;
    },
    run: async (cmd, args, stdin) => {
      if (o.slowRun) await new Promise((r) => setTimeout(r, 5));
      calls.push(['run', cmd, ...args].join(' '));
      if (stdin !== undefined) stdins.push(stdin);
      if (cmd === 'systemctl' && args[0] === 'enable') active = true;
      if (cmd === 'systemctl' && args[0] === 'disable') active = false;
    },
    smbdActive: async () => active,
    statfs: async () => ({ freeBytes: 100, totalBytes: 200 }),
  };
  return { sys, calls, stdins, service: createShareService(sys, { root: o.root ?? ROOT, mount: MOUNT }) };
}

describe('ShareService.enable', () => {
  it('verweigert, wenn die Festplatte nicht eingehängt ist, ohne Ordner und ohne Datei', async () => {
    const f = fake({ mounted: false });
    await expect(f.service.enable('geheim123')).rejects.toMatchObject({ code: 'disk_missing' });
    expect(f.calls.some((c) => c.startsWith('mkdir') || c.startsWith('write'))).toBe(false);
  });

  it('verweigert einen Ordner, der eine Verknüpfung ist', async () => {
    const f = fake({ dir: 'other' });
    await expect(f.service.enable('geheim123')).rejects.toMatchObject({ code: 'share_path_invalid' });
    expect(f.calls.some((c) => c.startsWith('write'))).toBe(false);
  });

  it('verweigert, wenn der echte Pfad woanders hinzeigt', async () => {
    const f = fake({ dir: 'dir', real: '/mnt/hdd/Main PC Daten' });
    await expect(f.service.enable('geheim123')).rejects.toMatchObject({ code: 'share_path_invalid' });
    expect(f.calls.some((c) => c.startsWith('write'))).toBe(false);
  });

  it('schaltet in der richtigen Reihenfolge ein und gibt das Passwort nur über stdin', async () => {
    const f = fake();
    const s = await f.service.enable('geheim123');
    expect(f.calls.map((c) => c.replace(/^write \d+$/, 'write'))).toEqual([
      'mkdir /mnt/hdd/Mainframe',
      'write',
      'run smbpasswd -s -a mainframe-share',
      'run smbpasswd -e mainframe-share',
      'run systemctl enable --now smbd',
      'run smbcontrol smbd reload-config',
    ]);
    expect(f.stdins).toEqual(['geheim123\ngeheim123\n']);
    expect(s.enabled).toBe(true);
    expect(s.unc).toBe('\\\\192.168.1.23\\Mainframe');
  });

  it('legt den Ordner beim zweiten Mal nicht neu an', async () => {
    const f = fake();
    await f.service.enable('geheim123');
    await f.service.enable('anderes123');
    expect(f.calls.filter((c) => c.startsWith('mkdir'))).toHaveLength(1);
    expect((await f.service.status()).enabled).toBe(true);
  });

  it('fasst Samba nicht an, wenn testparm die Datei ablehnt', async () => {
    const f = fake({ testparmFails: true });
    await expect(f.service.enable('geheim123')).rejects.toMatchObject({ code: 'share_conf_invalid' });
    expect(f.calls.some((c) => c.startsWith('run'))).toBe(false);
  });

  it('führt zwei gleichzeitige Aufrufe nacheinander aus', async () => {
    const f = fake({ slowRun: true });
    await Promise.all([f.service.enable('geheim123'), f.service.enable('anderes123')]);
    const runs = f.calls.filter((c) => c.startsWith('run') || c.startsWith('write'));
    // Jeder Durchlauf: write + 4 run. Der zweite beginnt erst nach dem ersten.
    expect(runs.slice(0, 5)[0]).toMatch(/^write/);
    expect(runs.slice(0, 5)[4]).toBe('run smbcontrol smbd reload-config');
    expect(runs[5]).toMatch(/^write/);
    expect(f.stdins).toEqual(['geheim123\ngeheim123\n', 'anderes123\nanderes123\n']);
  });
});

describe('ShareService.enable: Ort und Besitzer', () => {
  for (const root of ['/mnt/hdd', '/srv/x', '/mnt/hdd/a/b']) {
    it(`verweigert ${root}, weil es kein direkter Unterordner der Festplatte ist`, async () => {
      const f = fake({ root });
      await expect(f.service.enable('geheim123')).rejects.toMatchObject({ code: 'share_path_invalid' });
      expect(f.calls.some((c) => c.startsWith('mkdir') || c.startsWith('write'))).toBe(false);
    });
  }

  it('verweigert einen Ordner, der root gehört', async () => {
    const f = fake({ ownerRoot: true });
    await expect(f.service.enable('geheim123')).rejects.toMatchObject({ code: 'share_owner_invalid' });
    expect(f.calls.some((c) => c.startsWith('write'))).toBe(false);
  });
});

describe('ShareService.disable', () => {
  it('leert nur die Datei und stoppt smbd, ohne die Festplatte anzufassen', async () => {
    const f = fake({ dir: 'dir' });
    await f.service.enable('geheim123');
    f.calls.length = 0;
    const s = await f.service.disable();
    expect(f.calls).toEqual(['write 0', 'run systemctl disable --now smbd']);
    expect(s.enabled).toBe(false);
  });
});

describe('ShareService.status', () => {
  it('meldet am Windows-PC not_server', async () => {
    const s = await fake({ linux: false }).service.status();
    expect(s).toMatchObject({ available: false, reason: 'not_server', enabled: false });
  });

  it('meldet fehlendes Samba', async () => {
    const s = await fake({ samba: false }).service.status();
    expect(s).toMatchObject({ available: false, reason: 'samba_missing' });
  });

  it('meldet eine fehlende Festplatte ohne Speicherwerte', async () => {
    const s = await fake({ mounted: false }).service.status();
    expect(s).toMatchObject({ available: true, diskMounted: false, freeBytes: null, totalBytes: null, path: ROOT, user: 'mainframe-share' });
  });
});
