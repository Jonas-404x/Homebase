# Network share

Mainframe can share one folder of the server's disk in your home network, so it shows up as a
drive (for example `M:`) in the Windows Explorer. It uses Samba from Ubuntu.

## What is shared

- Only the folder `/mnt/hdd/Mainframe` (change with `MAINFRAME_SHARE_ROOT`; the disk's mount point
  is `MAINFRAME_SHARE_MOUNT`, default `/mnt/hdd`). Create any subfolders you like inside it.
- Everything else on the disk stays invisible on the network.
- Access only from the server's own LAN subnet and Tailscale (`100.64.0.0/10`), with the user
  `mainframe-share` and a password you choose. No guest access, SMB 3 only.
- If the disk is not mounted, the share refuses connections, so files never land on the SSD by
  mistake. Mainframe never deletes, moves or changes the rights of files on the disk.

## Set up

1. Once on the server: `sudo bash scripts/linux/setup-server.sh`. It installs Samba, writes a short
   `/etc/samba/smb.conf` (Ubuntu's original is kept as `smb.conf.dist`), creates the system account
   `mainframe-share` (no login, no sudo) and leaves Samba off.
2. In Mainframe: **Settings › Netzwerk › Netzwerkfreigabe › Einrichten…**. Choose the share
   password (at least 8 characters). Mainframe hands it to `smbpasswd` and never stores it.
3. On the Windows PC, in a command prompt (Windows asks for the password):

   ```
   net use M: \192.168.1.x\Mainframe /user:mainframe-share /persistent:yes
   ```

   Or Explorer › This PC › Map network drive.

Turning the share off asks for your Mainframe password. It stops Samba; the files stay.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Samba fehlt – Setup-Skript ausführen" | Run step 1 above |
| "Die Festplatte ist nicht angeschlossen." | Plug in the disk, then `sudo mount -a` |
| Windows keeps asking for the password | User is `mainframe-share`, not your Mainframe user |
| Windows says error 1272 / guest access | Use the user and password above; guests are off on purpose |
| Firewall: share not reachable after turning on `ufw` | `sudo ufw allow from 192.168.1.0/24 to any port 445 proto tcp` (your LAN) |
| Check the config | `sudo testparm -s` |
