#!/usr/bin/env bash
# The reading dashboard's deploy, run on the host as the forced command of its own deploy key
# (docs/deploy.md). It only ever touches this app's folder and this app's image.
#
# SSH_ORIGINAL_COMMAND (what GitHub Actions asks for):
#   deploy <40-hex sha>   pull that build and run it
#   deploy                pull :latest and run it
#   anything else         refused
#
# APP_DIR is the folder with this app's docker-compose.yml and .env (default: this script's
# folder). Prints "DEPLOY OK <image>" last when it worked; the workflow checks for that line.
set -euo pipefail
PATH="$PATH:/usr/local/bin:/snap/bin"

IMAGE_REPO=ghcr.io/chorsnell/moonreader-dashboard
SOURCE=https://github.com/chorsnell/moonreader-dashboard
APP_DIR=${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}

fail() { echo "DEPLOY FAILED $*"; exit 1; }

cmd=${SSH_ORIGINAL_COMMAND:-deploy}
if [[ $cmd =~ ^deploy\ ([0-9a-f]{40})$ ]]; then
  tag=${BASH_REMATCH[1]}
elif [[ $cmd == deploy ]]; then
  tag=latest
else
  fail "unknown command: ${cmd:0:80}"
fi
image="$IMAGE_REPO:$tag"

cd "$APP_DIR" || fail "no folder $APP_DIR"
[ -f docker-compose.yml ] || fail "no docker-compose.yml in $APP_DIR"

echo "pulling $image"
docker pull -q "$image" >/dev/null || fail "could not pull $image"
src=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.source"}}' "$image")
[ "$src" = "$SOURCE" ] || fail "$image is from '$src', not $SOURCE"

# IMAGE in the environment wins over .env for this one command; .env is left alone
echo "starting $image in $APP_DIR"
IMAGE="$image" docker compose up -d --no-build || fail "docker compose up failed"
echo "DEPLOY OK $image"
