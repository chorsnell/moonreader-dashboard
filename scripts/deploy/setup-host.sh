#!/usr/bin/env bash
# One-time host setup for the reading dashboard's own deploy (docs/deploy.md). Run on the host
# as root; safe to run again. It:
#   1. finds the app folder from the running moonreader-dashboard container
#   2. makes sure .env runs the published image
#   3. makes a `reading-dashboard` user in the docker group, able to read that folder
#   4. installs host-deploy.sh there
#   5. makes a fresh deploy key, locked to host-deploy.sh, and deploys once as a test
#   6. prints the private key to paste into GitHub, then deletes it from this machine
#
#   curl -fsSL https://raw.githubusercontent.com/chorsnell/moonreader-dashboard/main/scripts/deploy/setup-host.sh | sudo bash
#   (before it is merged: .../deploy-standalone/scripts/deploy/setup-host.sh | sudo env REF=deploy-standalone bash)
#
# Optional: APP=/path/to/folder (if the container isn't running), REF=<branch> (where to fetch
# host-deploy.sh from, default main).
set -euo pipefail
PATH="$PATH:/usr/local/bin:/snap/bin"

USER_NAME=reading-dashboard
IMAGE_LINE=IMAGE=ghcr.io/chorsnell/moonreader-dashboard:latest
REF=${REF:-main}
SCRIPT_URL="https://raw.githubusercontent.com/chorsnell/moonreader-dashboard/$REF/scripts/deploy/host-deploy.sh"
SECRET_URL=https://github.com/chorsnell/moonreader-dashboard/settings/secrets/actions/new

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mSTOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

main() {
  [ "$(id -u)" = 0 ] || die "run it with sudo"
  command -v docker >/dev/null || die "docker isn't installed here"

  say "1. Finding the app folder"
  if [ -z "${APP:-}" ]; then
    APP=$(docker inspect moonreader-dashboard \
      --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' 2>/dev/null) ||
      die "no running moonreader-dashboard container; run again with APP=/path/to/the/folder"
  fi
  [ -f "$APP/docker-compose.yml" ] || die "no docker-compose.yml in '$APP'"
  echo "$APP"

  say "2. Checking .env runs the published image"
  touch "$APP/.env"
  current=$(grep -E '^IMAGE=' "$APP/.env" | tail -1 || true)
  if [ -z "$current" ]; then
    cp -p "$APP/.env" "$APP/.env.bak-$(date +%Y%m%d%H%M%S)"
    echo "$IMAGE_LINE" >> "$APP/.env"
    echo "added $IMAGE_LINE (backup of the old .env next to it)"
  elif [ "$current" != "$IMAGE_LINE" ]; then
    die ".env has '$current'; change it to '$IMAGE_LINE' and run this again"
  else
    echo "ok"
  fi

  say "3. Deploy user '$USER_NAME'"
  id "$USER_NAME" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$USER_NAME"
  getent group docker >/dev/null || groupadd docker
  usermod -aG docker "$USER_NAME"
  HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6)
  can_read() { sudo -u "$USER_NAME" test -r "$APP/docker-compose.yml" && sudo -u "$USER_NAME" test -r "$APP/.env"; }
  if ! can_read; then
    command -v setfacl >/dev/null || { apt-get install -y -qq acl </dev/null >/dev/null || die "couldn't install acl (for setfacl)"; }
    setfacl -m "u:$USER_NAME:rx" "$APP"
    setfacl -m "u:$USER_NAME:r" "$APP/docker-compose.yml" "$APP/.env"
    can_read || die "$USER_NAME still can't read $APP (a parent folder may be closed to it)"
  fi
  echo "ok"

  say "4. Installing host-deploy.sh"
  curl -fsSL -o "$APP/host-deploy.sh.new" "$SCRIPT_URL" || die "couldn't download $SCRIPT_URL"
  chmod 755 "$APP/host-deploy.sh.new"
  mv "$APP/host-deploy.sh.new" "$APP/host-deploy.sh"
  echo "$APP/host-deploy.sh"

  say "5. Deploying once as $USER_NAME (this also puts tonight's version live)"
  if ! sudo -u "$USER_NAME" env SSH_ORIGINAL_COMMAND=deploy APP_DIR="$APP" "$APP/host-deploy.sh" </dev/null; then
    cat >&2 <<EOF

The test deploy failed (see above). Common causes:
  - "permission denied ... docker.sock": the docker group is new to Docker. Restart Docker when
    it suits you (it restarts every container), e.g. 'systemctl restart docker' or
    'snap restart docker', then run this again.
  - "could not pull ... denied": the GHCR package is private. Make it public: GitHub → your
    profile → Packages → moonreader-dashboard → Package settings → Change visibility.
EOF
    die "test deploy failed"
  fi

  say "6. Making the deploy key"
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  ssh-keygen -q -t ed25519 -N '' -C reading-dashboard-deploy -f "$tmp/key"
  install -d -m 700 -o "$USER_NAME" -g "$(id -gn "$USER_NAME")" "$HOME_DIR/.ssh"
  keys="$HOME_DIR/.ssh/authorized_keys"
  touch "$keys"
  # replace an older key from this script, keep anything else
  grep -v ' reading-dashboard-deploy$' "$keys" > "$tmp/keys" || true
  printf 'command="APP_DIR=%s %s/host-deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding %s\n' \
    "$APP" "$APP" "$(cat "$tmp/key.pub")" >> "$tmp/keys"
  install -m 600 -o "$USER_NAME" -g "$(id -gn "$USER_NAME")" "$tmp/keys" "$keys"
  echo "public half added to $keys, locked to host-deploy.sh"

  cat <<EOF

────────────────────────────────────────────────────────────────────────────
All set on this machine. Last step, in your browser:

  1. Open $SECRET_URL
  2. Name:   READING_DASHBOARD_DEPLOY_KEY
  3. Secret: paste everything between the lines below, including the BEGIN and END lines
────────────────────────────────────────────────────────────────────────────
$(cat "$tmp/key")
────────────────────────────────────────────────────────────────────────────
The private key is deleted from this machine when this script ends; GitHub keeps the only copy.
EOF
}

# all of the script is read before any of it runs, so nothing in it can eat the rest from stdin
main "$@"
