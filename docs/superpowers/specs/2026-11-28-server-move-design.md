# Mainframe Part 4: Server move – design

Part 4 of the roadmap (`2026-11-25-mainframe-ausbau-design.md`) moves Mainframe onto the home
server for real. The server already runs (Ubuntu Server 24.04, set up by hand on 2026-11-28). This
part turns the manual setup into something reproducible and adds the server-only features.

The work is five pieces, built in this order, each brainstormed on its own:

1. Network share in the Windows Explorer (Samba) – **this section**
2. Ubuntu setup script that reproduces the manual setup – later section
3. Wake-on-LAN – later section
4. AdGuard Home for the whole network – later section, agreed with the admin first
5. HTTPS – later section

Examples in this document use `192.168.1.x`. Real addresses never go into the repo.

## 1. Network share

### Intent

The admin wants to drop files onto the server from the Windows Explorer like onto a normal drive,
in folders of his own choosing. The USB HDD on the server already holds private backups of his
main PC (`Main PC Daten`, `Medal`, `Recovery`). Those must stay invisible on the network and must
never be changed or deleted.

Per the roadmap, turning the share on is a deliberate act (a small wizard with its own password),
and turning it off is hard on purpose (admin password plus a warning).

### Goals

- One new folder on the HDD, `/mnt/hdd/Mainframe`, is shared as `Mainframe`. Only that folder.
  The admin creates any subfolders he likes inside it.
- On the main PC it shows up as a drive letter (default `M:`).
- On/off from Settings → Netzwerk → Netzwerkfreigabe, as a wizard, not a toggle.
- Reachable only from the home network (and Tailscale later), with user name and password.

### Non-goals

- No guest access, no anonymous browsing.
- No sharing of the existing backup folders, now or as an option.
- No file browser in Mainframe (the roadmap's "Dateien im Browser" is a later step).
- No folder import into Frame (Frame spec, non-goals).
- The share does not work on the Windows dev PC. There the row stays "Nur auf dem Server".

### Anti-goals (failure even if it "works")

- Anything outside `/mnt/hdd/Mainframe` is reachable over the network.
- Files written while the HDD is not mounted land on the SSD and later vanish under the mount.
- The share password ends up in the repo, the Mainframe database, logs, the event log or AI facts.
- Turning the share off deletes or moves any file.

### Constraints (found on the server)

- Mainframe runs as `root` (systemd unit without `User=`). Every Samba action runs as root.
- The HDD is NTFS, mounted with `ntfs3`, `uid=1000,gid=1000,umask=022`, `nofail` and a 10 s device
  timeout. Only uid 1000 can write; `chown`/`chmod` have no effect. If the HDD is missing at boot,
  `/mnt/hdd` is an empty folder on the root SSD.
- Samba is not installed yet. Ubuntu's candidate is 4.19.
- `ufw` is installed but inactive.
- Windows 11 24H2 requires SMB signing and blocks guest access.

### Approaches

1. **Samba from Ubuntu, controlled by Mainframe (picked).** `apt install samba`; Mainframe writes
   one config file for the share, sets the password with `smbpasswd` and starts/stops `smbd`.
   Security updates come from Ubuntu. Works only on the Linux server.
2. **Samba as a Docker app from the catalog.** Fits the app model, but relies on a third-party image
   for updates, and uid mapping on the NTFS mount is fiddly.

The admin picked 1 because security updates come from Ubuntu and nothing third-party is involved.

### Design

**Install (setup script, piece 2).** The setup script installs `samba`, keeps Ubuntu's file as
`/etc/samba/smb.conf.dist` and replaces `/etc/samba/smb.conf` with a short Mainframe one (below). It
creates an empty `/etc/samba/mainframe-share.conf`, the system account `mainframe-share`
(`--system --no-create-home --shell /usr/sbin/nologin`) and disables `smbd`/`nmbd` until the wizard
turns the share on. Mainframe never runs `apt`. If Samba is missing, the wizard says so and names
`scripts/linux/setup-server.sh`.

**`/etc/samba/smb.conf` (written by the setup script).** Only globals, so there is no printer,
home or user share, and the include comes last. An include does not keep `[global]` scope once the
included file opens a section, so nothing may follow it.

```ini
[global]
   server role = standalone server
   server min protocol = SMB3
   map to guest = never
   disable netbios = yes
   smb ports = 445
   load printers = no
   printing = bsd
   printcap name = /dev/null
   disable spoolss = yes
   usershare max shares = 0
   log file = /var/log/samba/log.%m
   max log size = 1000
   include = /etc/samba/mainframe-share.conf
```

**What Mainframe writes.** `/etc/samba/mainframe-share.conf` holds only the share:

```ini
[Mainframe]
   path = /mnt/hdd/Mainframe
   valid users = mainframe-share
   force user = <user name of the folder owner, e.g. the uid-1000 account>
   force group = <its group name>
   read only = no
   browseable = yes
   guest ok = no
   follow symlinks = no
   wide links = no
   hosts allow = 127.0.0.1 <LAN subnet of the server, e.g. 192.168.1.0/24> 100.64.0.0/10
   hosts deny = 0.0.0.0/0
   root preexec = /usr/bin/mountpoint -q /mnt/hdd
   root preexec close = yes
```

- `force user` makes every write happen as the account that owns the NTFS mount, so writes work.
  It takes a user name, so Mainframe resolves the owner uid to its name. The login account is a
  separate `nologin` account, not the admin's account (which has sudo).
- `hosts allow` uses the subnet of the server's LAN address (from its address and netmask at enable
  time) plus the Tailscale range, not all private ranges.
- `root preexec` + `root preexec close` refuse a new connection when the HDD is not mounted. This is
  checked per connection, not per write. If the HDD drops out mid-session, writes fail with an
  error: the share folder does not exist on the SSD, and Mainframe never creates it there. Accepted.
- Mainframe writes the conf to a temp file, runs `testparm -s <temp>`, and only then renames it into
  place. On any failure the previous file and service state stay as they were. Share actions are
  serialised (one at a time).
- Off = the file is emptied and `smbd` is stopped and disabled. No file on the HDD is touched.

**Paths.** `MAINFRAME_SHARE_ROOT` (default `/mnt/hdd/Mainframe`) and the mount point it must sit on
(`MAINFRAME_SHARE_MOUNT`, default `/mnt/hdd`). The share root must be a direct, real child of the
mount point. Before enabling, Mainframe checks: the mount point is really mounted (`st_dev` differs
from its parent), and the share root, once it exists, is a real directory (not a symlink) whose
`realpath` equals the configured path. Mainframe only ever `mkdir`s that one folder (not
recursively) and never deletes, moves, `chown`s or `chmod`s anything on the HDD. `root preexec`
uses the configured mount point.

**Frame folder (admin to confirm).** Frame owns its folder layout (`library/<uuid>/…`), so manual
edits there would break it. Frame therefore gets its own root next to the share,
`/mnt/hdd/Frame`, not inside it. Both are separate from the backups. The share wizard does not create
it; Frame does, when it is built.

**State is read from the system, not from a DB flag.**
`GET /api/share` returns:

```ts
{
  available: boolean;        // Linux server and Samba installed by the setup script
  reason?: 'not_server' | 'samba_missing';
  enabled: boolean;          // conf file has the share AND smbd is active
  diskMounted: boolean;      // separate from availability; enable is refused while false
  path: string;              // /mnt/hdd/Mainframe
  user: 'mainframe-share';
  unc: string | null;        // \\192.168.1.x\Mainframe (LAN IP)
  freeBytes: number | null; totalBytes: number | null;
}
```

**Routes (all behind login).**
- `POST /api/share/enable { password }` – share password, 8–128 chars, no control characters or
  newlines. Steps: check disk mounted → `mkdir` share folder → write conf → `testparm -s` →
  `smbpasswd -s -a mainframe-share` (password only on stdin, twice) → `smbpasswd -e mainframe-share` →
  `systemctl enable --now smbd` → reload. Idempotent; also used to change the password.
- `POST /api/share/disable { password, code? }` – admin password and second factor if on, same
  rate limit as `/api/system/reset`. Empties the conf, `systemctl disable --now smbd`.
- All commands via `execFile` with fixed argument arrays, never a shell. The share password never
  enters logs, events, insights or AI facts. Event log only says "Netzwerkfreigabe eingeschaltet".

**Wizard (Settings → Netzwerk, row "Netzwerkfreigabe" moves out of "Später").**
1. Explanation: the folder `Mainframe` on the HDD becomes visible in the home network; the backups
   stay invisible.
2. Share password twice. The admin types it himself.
3. Done: UNC path and a copyable command for the PC:
   `net use M: \\192.168.1.x\Mainframe /user:mainframe-share /persistent:yes`
   (Windows asks for the password). Plus "In den Explorer: Dieser PC → Netzlaufwerk verbinden".

When on, the row shows status, path, free space, "Passwort ändern" (wizard again) and
"Ausschalten" (dialog with warning, admin password).
States without a wizard: "Festplatte nicht angeschlossen", "Samba fehlt – Setup-Skript ausführen",
"Nur auf dem Server".

**Testing.** A `ShareSystem` interface wraps the system calls (run a command, read/write the conf,
mounted check, mkdir, statfs). Unit tests with a fake: conf rendering, password validation,
"not mounted → no mkdir, no enable", "disable never touches files", enable idempotent, rate limit
and password on disable. Manual check on the server and from the real Windows 11 PC.

### Left to the builder

- Exact UI copy and layout of the wizard, within the existing settings style.
- Whether the status lives in `system/info` or its own route (own route is the default above).
