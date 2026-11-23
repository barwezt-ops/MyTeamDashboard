#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )) || [[ -z ${SUDO_USER:-} || $SUDO_USER == root ]]; then
  echo "Run this from your SSH user with sudo bash setup.sh." >&2
  exit 1
fi

export PATH=/usr/sbin:/usr/bin:/sbin:/bin
checkout=/opt/team-dashboard
env_file=/etc/team-dashboard.env
swap_file=/swapfile-team-dashboard

if ! command -v curl >/dev/null; then
  apt-get update
  apt-get install -y ca-certificates curl
fi
if ! curl -4fsS --max-time 10 https://github.com >/dev/null 2>&1; then
  echo "GitHub isn't reachable over IPv6. Attach a temporary external IPv4 (see README) and rerun." >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates git build-essential python3 unattended-upgrades
printf '%s\n' 'APT::Periodic::Update-Package-Lists "1";' 'APT::Periodic::Unattended-Upgrade "1";' \
  > /etc/apt/apt.conf.d/99-team-dashboard-auto-upgrades

if [[ $(/usr/bin/node --version 2>/dev/null || true) != v20.* ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    -o /usr/share/keyrings/team-dashboard-nodesource.asc
  printf '%s\n' 'deb [signed-by=/usr/share/keyrings/team-dashboard-nodesource.asc] https://deb.nodesource.com/node_20.x nodistro main' \
    > /etc/apt/sources.list.d/team-dashboard-nodesource.list
  apt-get update
  apt-get install -y 'nodejs=20.*'
fi
if [[ $(/usr/bin/node --version) != v20.* ]]; then
  echo "Node 20 is required for Team Dashboard." >&2
  exit 1
fi
systemctl enable --now apt-daily.timer apt-daily-upgrade.timer

if ! id dashboard >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/team-dashboard --shell /usr/sbin/nologin dashboard
fi
install -d -o dashboard -g dashboard -m 0700 /var/lib/team-dashboard

if [[ ! -e $swap_file ]]; then
  (umask 077; fallocate -l 2G "$swap_file")
fi
chmod 0600 "$swap_file"
if ! swapon --show=NAME --noheadings --raw | grep -Fxq "$swap_file"; then
  if [[ $(blkid -p -s TYPE -o value "$swap_file" || true) != swap ]]; then
    mkswap "$swap_file"
  fi
  swapon "$swap_file"
fi
if ! grep -Eq "^${swap_file}[[:space:]]" /etc/fstab; then
  printf '%s none swap sw 0 0\n' "$swap_file" >> /etc/fstab
fi

if [[ ! -d $checkout/.git ]]; then
  install -d -o "$SUDO_USER" -m 0755 "$checkout"
  runuser -u "$SUDO_USER" -- git clone --branch main https://github.com/barwezt-ops/MyTeamDashboard.git "$checkout"
fi
if [[ ! -e $env_file ]]; then
  install -m 0600 /dev/null "$env_file"
fi
chown root:root "$env_file"
chmod 0600 "$env_file"

if systemctl is-active --quiet team-dashboard.service; then
  bash "$checkout/deploy/update.sh"
else
  bash "$checkout/deploy/update.sh" --prepare
fi
systemctl enable team-dashboard.service
printf 'Edit %s, then run sudo systemctl start team-dashboard.\n' "$env_file"
