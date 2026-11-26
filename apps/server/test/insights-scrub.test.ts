import { describe, expect, it } from 'vitest';
import type { DeviceInfo } from '@mainframe/shared';
import { buildBlocklist, minecraftOnline, minecraftPlayers, scrubLine, scrubLogLines } from '../src/insights/scrub.ts';

const none = { blocklist: [], players: [] };

describe('scrubLine', () => {
  it('lässt Uhrzeiten und Datumsangaben stehen', () => {
    expect(scrubLine('2026-11-26 03:00:01 [14:02:33] ERROR at 12:30', none)).toBe('2026-11-26 03:00:01 [14:02:33] ERROR at 12:30');
  });

  it('ersetzt IPs, MACs, E-Mails, Zugangsdaten in URLs und Tokens', () => {
    expect(scrubLine('connect 192.0.2.17:8080 failed', none)).toBe('connect [ip]:8080 failed');
    expect(scrubLine('peer 2001:db8::1 and fe80::1ff:fe23:4567:890a down', none)).toBe('peer [ip] and [ip] down');
    expect(scrubLine('mac 00:00:5E:00:53:af and 00-00-5e-00-53-01', none)).toBe('mac [mac] and [mac]');
    expect(scrubLine('mail to someone@example.com', none)).toBe('mail to [email]');
    expect(scrubLine('db postgres://admin:hunter2@db.example.com/x', none)).toBe('db [url]');
    expect(scrubLine('token=tok_A1b2C3d4E5f6G7h8I9j0K1l2', none)).toBe('token=[geheim]');
  });

  it('ersetzt den Benutzernamen in Pfaden', () => {
    expect(scrubLine('open C:\\Users\\maxmuster\\config.yml', none)).toBe('open C:\\Users\\[user]\\config.yml');
    expect(scrubLine('open /home/maxmuster/x and /Users/max/y', none)).toBe('open /home/[user]/x and /Users/[user]/y');
  });

  it('ersetzt Gerätenamen aus der Sperrliste als ganzes Wort, ohne Groß/klein', () => {
    const ctx = { blocklist: ['Wohnzimmer-TV', 'nas.example.lan', 'a.b'], players: [] };
    expect(scrubLine('ping wohnzimmer-tv and NAS.example.lan timeout; axb stays', ctx)).toBe('ping [gerät] and [gerät] timeout; axb stays');
  });

  it('ersetzt Spielernamen', () => {
    expect(scrubLine('<Steve_42> hi Alex', { blocklist: [], players: ['Steve_42', 'Alex'] })).toBe('<[spieler]> hi [spieler]');
  });
});

describe('scrubLogLines', () => {
  it('bereinigt erst und kürzt dann, nimmt höchstens 5 Zeilen', () => {
    const long = 'x'.repeat(290) + ' 192.0.2.123 more text';
    const lines = scrubLogLines([...Array(4).fill('a'), long, 'b', 'c'], none);
    expect(lines.length).toBe(5);
    // Die neuesten fünf Zeilen.
    expect(lines[1]).toBe('a');
    expect(lines[4]).toBe('c');
    const cut = scrubLogLines([long], none)[0]!;
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut).toContain('[ip]');
    expect(cut).not.toMatch(/192\.0/);
  });
});

describe('minecraftPlayers', () => {
  it('findet Spielernamen in den üblichen Logzeilen', () => {
    const log = [
      '[03:00:01] [Server thread/INFO]: UUID of player Steve_42 is 0f0e0d0c-0000-0000-0000-000000000000',
      '[03:00:02] [Server thread/INFO]: Steve_42[/198.51.100.7:51234] logged in with entity id 12',
      '[03:00:02] [Server thread/INFO]: Alex joined the game',
      '[03:00:05] [Server thread/INFO]: <Alex> hallo',
      '[03:01:00] [Server thread/INFO]: Notch lost connection: Disconnected',
      '[03:01:00] [Server thread/INFO]: Herobrine left the game',
    ];
    expect(minecraftPlayers(log).sort()).toEqual(['Alex', 'Herobrine', 'Notch', 'Steve_42']);
  });
});

describe('buildBlocklist', () => {
  it('nimmt Name, Hostname, IP und MAC jedes Geräts und den eigenen Hostnamen', () => {
    const d = { mac: '00:00:5E:00:53:01', ip: '192.0.2.5', hostname: 'nas.example.lan', name: 'Keller-NAS' } as DeviceInfo;
    expect(buildBlocklist([d], 'mainframe-box').sort()).toEqual(['00:00:5E:00:53:01', '192.0.2.5', 'Keller-NAS', 'mainframe-box', 'nas.example.lan'].sort());
  });
});

describe('scrubLine – Zugangsdaten und Grenzen', () => {
  it('ersetzt Zuweisungen von Passwörtern, Benutzern und Tokens', () => {
    expect(scrubLine('ERROR username=maxmuster password=hunter2', none)).toBe('ERROR username=[geheim] password=[geheim]');
    expect(scrubLine('{"api_key": "abc", "token":"x"}', none)).toBe('{"api_key": "[geheim]", "token":"[geheim]"}');
    expect(scrubLine('Authorization: Bearer abc.def', none)).toBe('Authorization: Bearer [geheim]');
  });

  it('erkennt Adressen auch direkt neben einem Unterstrich', () => {
    expect(scrubLine('peer_192.0.2.99_00:00:5E:00:53:66 and x_2001:db8::1', none)).toBe('peer_[ip]_[mac] and x_[ip]');
    expect(scrubLine('version 1.2.3 at std::string', none)).toBe('version 1.2.3 at std::string');
  });

  it('nimmt auch kurze Gerätenamen wie "pi"', () => {
    expect(scrubLine('cannot reach pi now; pipe ok', { blocklist: ['pi'], players: [] })).toBe('cannot reach [gerät] now; pipe ok');
  });
});

describe('minecraftOnline', () => {
  it('zählt, wer gerade online ist, und null, wenn das Log nichts dazu sagt', () => {
    const log = [
      '[03:00:00] [Server thread/INFO]: Done (3.1s)! For help, type "help"',
      '[03:00:02] [Server thread/INFO]: Alex joined the game',
      '[03:00:03] [Server thread/INFO]: Steve joined the game',
      '[03:00:04] [Server thread/INFO]: Notch joined the game',
      '[03:01:00] [Server thread/INFO]: Steve left the game',
    ];
    expect(minecraftOnline(log)).toBe(2);
    expect(minecraftOnline(['[03:00:00] irgendwas'])).toBeNull();
  });
});
