import { describe, expect, it } from 'vitest';
import { hasShare, lanSubnet, renderShareConf, validateSharePassword } from '../src/share/conf.ts';

const base = { path: '/mnt/hdd/Mainframe', mount: '/mnt/hdd', forceUser: 'jonas', forceGroup: 'jonas', subnet: '192.168.1.0/24' };

describe('renderShareConf', () => {
  it('schreibt genau die Freigabe mit allen Schutz-Optionen', () => {
    const conf = renderShareConf(base);
    const lines = conf.split('\n');
    for (const l of [
      '[Mainframe]',
      '   path = /mnt/hdd/Mainframe',
      '   valid users = mainframe-share',
      '   force user = jonas',
      '   force group = jonas',
      '   read only = no',
      '   guest ok = no',
      '   follow symlinks = no',
      '   wide links = no',
      '   hosts allow = 127.0.0.1 192.168.1.0/24 100.64.0.0/10',
      '   hosts deny = 0.0.0.0/0',
      '   root preexec = /usr/bin/mountpoint -q /mnt/hdd',
      '   root preexec close = yes',
    ]) {
      expect(lines).toContain(l);
    }
    expect(hasShare(conf)).toBe(true);
    expect(hasShare('')).toBe(false);
  });

  it('lehnt Werte mit Zeilenumbruch oder Klammer ab', () => {
    expect(() => renderShareConf({ ...base, path: '/mnt/hdd/a\n[x]' })).toThrow();
    expect(() => renderShareConf({ ...base, forceUser: 'a[b' })).toThrow();
    expect(() => renderShareConf({ ...base, forceGroup: 'a\nb' })).toThrow();
  });
});

describe('lanSubnet', () => {
  it('rechnet das Netz aus Adresse und Maske', () => {
    expect(lanSubnet('192.168.1.23', '255.255.255.0')).toBe('192.168.1.0/24');
    expect(lanSubnet('10.1.2.3', '255.255.0.0')).toBe('10.1.0.0/16');
  });
});

describe('validateSharePassword', () => {
  it('erlaubt 8 bis 128 Zeichen ohne Steuerzeichen', () => {
    expect(validateSharePassword('gutes passwort')).toBe('gutes passwort');
    for (const bad of ['kurz', 'abc\ndefghij', 'a'.repeat(129), 12345678, undefined]) {
      expect(() => validateSharePassword(bad)).toThrow(expect.objectContaining({ code: 'share_password_invalid' }));
    }
  });
});
