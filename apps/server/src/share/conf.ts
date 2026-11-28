import { MainframeError } from '../errors.ts';

/** Samba-Konto, mit dem sich der PC anmeldet. Eigenes Konto ohne Login und ohne sudo. */
export const SHARE_USER = 'mainframe-share';
export const SHARE_NAME = 'Mainframe';
/** Diese Datei bindet die smb.conf des Setup-Skripts als Letztes ein. Mainframe schreibt nur sie. */
export const SHARE_CONF = '/etc/samba/mainframe-share.conf';
/** Tailscale vergibt Adressen aus diesem Bereich. */
const TAILSCALE = '100.64.0.0/10';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/;

/** Prüft das Freigabe-Passwort. Ein Zeilenumbruch würde die Eingabe für smbpasswd zerbrechen. */
export function validateSharePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128 || CONTROL.test(pw)) {
    throw new MainframeError('share_password_invalid', 'Das Passwort braucht 8 bis 128 Zeichen, ohne Zeilenumbrüche.', 400);
  }
  return pw;
}

const toInt = (ip: string) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
const toIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

/** Netz aus Adresse und Maske, z. B. 192.168.1.23 + 255.255.255.0 → 192.168.1.0/24. */
export function lanSubnet(ip: string, netmask: string): string {
  const mask = toInt(netmask);
  const bits = mask.toString(2).replace(/0+$/, '').length;
  return `${toIp((toInt(ip) & mask) >>> 0)}/${bits}`;
}

function safe(value: string, what: string): string {
  if (!value || CONTROL.test(value) || value.includes('[') || value.includes(']')) {
    throw new MainframeError('share_conf_invalid', `Ungültiger Wert für ${what}.`, 500);
  }
  return value;
}

/** Inhalt von mainframe-share.conf: nur die eine Freigabe, sonst nichts. */
export function renderShareConf(o: { path: string; mount: string; forceUser: string; forceGroup: string; subnet: string }): string {
  return [
    `[${SHARE_NAME}]`,
    `   path = ${safe(o.path, 'path')}`,
    `   valid users = ${SHARE_USER}`,
    `   force user = ${safe(o.forceUser, 'force user')}`,
    `   force group = ${safe(o.forceGroup, 'force group')}`,
    '   read only = no',
    '   browseable = yes',
    '   guest ok = no',
    '   follow symlinks = no',
    '   wide links = no',
    `   hosts allow = 127.0.0.1 ${safe(o.subnet, 'subnet')} ${TAILSCALE}`,
    // ALL statt 0.0.0.0/0: sonst kämen IPv6-Geräte an der Liste vorbei.
    '   hosts deny = ALL',
    // Ohne eingehängte Festplatte keine Verbindung: sonst landen Dateien auf der SSD.
    `   root preexec = /usr/bin/mountpoint -q ${safe(o.mount, 'mount')}`,
    '   root preexec close = yes',
    '',
  ].join('\n');
}

/** true, wenn die Datei die Freigabe enthält. */
export function hasShare(conf: string): boolean {
  return conf.split('\n').some((l) => l.trim() === `[${SHARE_NAME}]`);
}
