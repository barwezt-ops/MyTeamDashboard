#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )) || [[ -z ${SUDO_USER:-} || $SUDO_USER == root ]]; then
  echo "Run this from your SSH user with sudo bash update.sh." >&2
  exit 1
fi

export PATH=/usr/sbin:/usr/bin:/sbin:/bin
checkout=/opt/team-dashboard
releases=/opt/team-dashboard-releases
current=/opt/team-dashboard-current

exec 9>/run/lock/team-dashboard-deploy.lock
flock 9
runuser -u "$SUDO_USER" -- git -C "$checkout" pull --ff-only
install -d -m 0755 "$releases"
release=$(mktemp -d "$releases/release.XXXXXXXX")
trap 'if [[ -n $release ]]; then rm -rf -- "$release"; fi' EXIT
chown "$SUDO_USER" "$release"
chmod 0755 "$release"

# Running requests still need their release's static files during a build.
if ! (
  runuser -u "$SUDO_USER" -- git -C "$checkout" archive HEAD |
    runuser -u "$SUDO_USER" -- tar -x -C "$release" &&
    cd "$release" &&
    runuser -u "$SUDO_USER" -- npm ci &&
    runuser -u "$SUDO_USER" -- npm run build
); then
  echo "Team Dashboard build failed. The running release was left in place." >&2
  exit 1
fi

install -m 0644 "$release/deploy/team-dashboard.service" /etc/systemd/system/team-dashboard.service
systemctl daemon-reload
previous=$(readlink "$current" || true)
ln -s "$release" "$release/current-link"
mv -Tf "$release/current-link" "$current"
release=
if [[ ${1:-} != --prepare ]]; then
  systemctl restart team-dashboard.service
fi
if [[ ${previous%/*} == "$releases" && ${previous##*/} == release.* ]]; then
  rm -rf -- "$previous"
fi
