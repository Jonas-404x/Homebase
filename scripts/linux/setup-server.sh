#!/usr/bin/env bash
# Sets up an Ubuntu Server 24.04 machine for Mainframe. Safe to run again: every step checks
# first and only changes what is missing.
#
#   sudo bash scripts/linux/setup-server.sh
#
# Steps so far: Samba for the network share. More steps follow (Docker, Node, systemd unit, ...).
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Bitte mit sudo starten: sudo bash $0" >&2
  exit 1
fi

SHARE_CONF=/etc/samba/mainframe-share.conf
SHARE_USER=mainframe-share

log() { printf '\n== %s\n' "$*"; }

setup_samba() {
  log "Samba (Netzwerkfreigabe)"
  if ! command -v smbd >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y samba
  fi

  # Keep Ubuntu's original once, then use a short config: globals only, the share comes from
  # Mainframe via the include, which must stay the last line.
  if [[ ! -f /etc/samba/smb.conf.dist && -f /etc/samba/smb.conf ]]; then
    mv /etc/samba/smb.conf /etc/samba/smb.conf.dist
  fi
  cat > /etc/samba/smb.conf <<'EOF'
# Written by Mainframe's setup-server.sh. Ubuntu's original is smb.conf.dist.
# The share itself lives in mainframe-share.conf and is managed by Mainframe.
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
EOF
  [[ -f $SHARE_CONF ]] || install -m 644 /dev/null "$SHARE_CONF"

  if ! id "$SHARE_USER" >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SHARE_USER"
  fi

  testparm -s --suppress-prompt >/dev/null

  # NetBIOS is off; nmbd is not needed. smbd only runs while the share is switched on.
  systemctl disable --now nmbd >/dev/null 2>&1 || true
  if grep -q '^\[Mainframe\]' "$SHARE_CONF"; then
    systemctl enable --now smbd
    smbcontrol smbd reload-config || true
  else
    systemctl disable --now smbd >/dev/null 2>&1 || true
  fi
}

setup_samba

log "Fertig"
