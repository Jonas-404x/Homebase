import type { ShareStatus } from '@mainframe/shared';
import { MainframeError } from '../errors.ts';
import { SHARE_NAME, SHARE_USER, hasShare, lanSubnet, renderShareConf } from './conf.ts';
import type { ShareSystem } from './system.ts';

export interface ShareService {
  status(): Promise<ShareStatus>;
  /** Schaltet ein oder setzt ein neues Passwort. Das Passwort ist schon geprüft. */
  enable(password: string): Promise<ShareStatus>;
  /** Nimmt die Freigabe weg und stoppt smbd. Dateien bleiben, wie sie sind. */
  disable(): Promise<ShareStatus>;
}

export function createShareService(sys: ShareSystem, o: { root: string; mount: string }): ShareService {
  // Immer nur ein Umschalten gleichzeitig.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  async function status(): Promise<ShareStatus> {
    const base = { path: o.root, user: SHARE_USER, enabled: false, diskMounted: false, unc: null, freeBytes: null, totalBytes: null };
    if (!sys.isLinuxServer()) return { ...base, available: false, reason: 'not_server' };
    if (!(await sys.sambaInstalled())) return { ...base, available: false, reason: 'samba_missing' };
    const [mounted, conf, active] = await Promise.all([sys.isMounted(o.mount), sys.readConf(), sys.smbdActive()]);
    const space = mounted ? await sys.statfs(o.mount) : null;
    const lan = sys.lan();
    return {
      ...base,
      available: true,
      enabled: hasShare(conf) && active,
      diskMounted: mounted,
      unc: lan ? `\\\\${lan.ip}\\${SHARE_NAME}` : null,
      freeBytes: space?.freeBytes ?? null,
      totalBytes: space?.totalBytes ?? null,
    };
  }

  async function enable(password: string): Promise<ShareStatus> {
    const s = await status();
    if (!s.available) throw new MainframeError('share_unavailable', 'Die Freigabe gibt es nur auf dem Server mit installiertem Samba.', 409);
    if (!s.diskMounted) throw new MainframeError('disk_missing', 'Die Festplatte ist nicht angeschlossen.', 409);
    const invalid = () => new MainframeError('share_path_invalid', 'Der Freigabe-Ordner ist kein normaler Ordner auf der Festplatte.', 409);
    const kind = await sys.inspectDir(o.root);
    if (kind === 'other') throw invalid();
    if (kind === 'missing') await sys.mkdir(o.root);
    if ((await sys.realpath(o.root)) !== o.root) throw invalid();
    const lan = sys.lan();
    if (!lan) throw new MainframeError('share_no_network', 'Der Server hat gerade keine Netzwerkadresse.', 409);
    const owner = await sys.owner(o.root);
    await sys.writeConfChecked(
      renderShareConf({ path: o.root, mount: o.mount, forceUser: owner.user, forceGroup: owner.group, subnet: lanSubnet(lan.ip, lan.netmask) }),
    );
    await sys.run('smbpasswd', ['-s', '-a', SHARE_USER], `${password}\n${password}\n`);
    await sys.run('smbpasswd', ['-e', SHARE_USER]);
    await sys.run('systemctl', ['enable', '--now', 'smbd']);
    await sys.run('smbcontrol', ['smbd', 'reload-config']);
    return status();
  }

  async function disable(): Promise<ShareStatus> {
    await sys.writeConfChecked('');
    await sys.run('systemctl', ['disable', '--now', 'smbd']);
    return status();
  }

  return { status, enable: (pw) => serial(() => enable(pw)), disable: () => serial(disable) };
}
