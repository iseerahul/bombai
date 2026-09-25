#!/usr/bin/env bash
#
# Rebuild and restart Bambai.
#
#   ./restart.sh              rebuild and start whatever is already running
#   ./restart.sh nginx        force the nginx + certbot stack (HTTPS)
#   ./restart.sh caddy        force the Caddy stack (HTTPS)
#   ./restart.sh plain        force the plain HTTP container
#   ./restart.sh --pull       git pull first, then rebuild
#   ./restart.sh --clean      tear the containers down first, then rebuild
#
# Flags combine with a stack name: ./restart.sh nginx --pull
#
# It never touches volumes. `docker compose down -v` would take the SQLite
# database, every uploaded photo, and the Let's Encrypt certificate and account
# key with it — and Let's Encrypt allows five certificates per hostname per
# week, so that mistake locks you out for days rather than minutes.

set -euo pipefail

cd "$(dirname "$0")"

PULL=0
CLEAN=0
STACK=""

for arg in "$@"; do
  case "$arg" in
    --pull)  PULL=1 ;;
    --clean) CLEAN=1 ;;
    nginx|caddy|plain) STACK="$arg" ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^#\{1,\} \{0,1\}//;s/^#$//'; exit 0 ;;
    *) echo "Unknown argument: $arg  (try --help)" >&2; exit 2 ;;
  esac
done

# --- docker compose, or the older docker-compose ----------------------------
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "Docker Compose is not available. Is Docker running?" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "The Docker daemon is not responding. Start Docker and try again." >&2
  exit 1
fi

file_for() {
  case "$1" in
    nginx) echo "docker-compose.nginx.yml" ;;
    caddy) echo "docker-compose.https.yml" ;;
    plain) echo "docker-compose.yml" ;;
  esac
}

# --- which stack ------------------------------------------------------------
#
# With no argument, restart whatever is already up. Guessing from .env would be
# worse: SITE_ADDRESS is set for both HTTPS stacks, so a guess would silently
# swap nginx for Caddy and leave the old containers orphaned.
if [ -z "$STACK" ]; then
  for candidate in nginx caddy plain; do
    f="$(file_for "$candidate")"
    if [ -f "$f" ] && [ -n "$($DC -f "$f" ps -q 2>/dev/null)" ]; then
      STACK="$candidate"
      echo "Restarting the stack that is already running: $candidate"
      break
    fi
  done
fi

if [ -z "$STACK" ]; then
  if [ -f .env ] && grep -qE '^SITE_ADDRESS=.+' .env; then
    echo "Nothing is running, and .env has SITE_ADDRESS set (so you want HTTPS)." >&2
    echo "Say which proxy:  ./restart.sh nginx   or   ./restart.sh caddy" >&2
    exit 2
  fi
  STACK="plain"
  echo "Nothing is running — starting the plain HTTP stack."
fi

COMPOSE_FILE="$(file_for "$STACK")"
[ -f "$COMPOSE_FILE" ] || { echo "Missing $COMPOSE_FILE" >&2; exit 1; }

# --- settings ---------------------------------------------------------------
if [ ! -f .env ]; then
  echo "No .env file. Copy the example and fill it in:" >&2
  echo "  cp .env.example .env" >&2
  exit 1
fi

# APP_ORIGIN decides the OAuth redirect and whether session cookies are marked
# Secure, so an http:// value on an HTTPS stack breaks sign-in in a way whose
# error message points somewhere else entirely.
if [ "$STACK" != "plain" ] && ! grep -qE '^APP_ORIGIN=https://' .env; then
  echo "! APP_ORIGIN in .env is not an https:// URL, but you are starting $STACK."
  echo "  Sign-in will fail with redirect_uri_mismatch until it matches the URL"
  echo "  people actually open."
fi

# --- go ---------------------------------------------------------------------
if [ "$PULL" -eq 1 ]; then
  echo
  echo "→ git pull"
  git pull --ff-only
fi

echo
if [ "$CLEAN" -eq 1 ]; then
  echo "→ stopping and removing containers (volumes are kept)"
  $DC -f "$COMPOSE_FILE" down --remove-orphans
fi

echo "→ building and starting: $COMPOSE_FILE"
$DC -f "$COMPOSE_FILE" up --build -d --remove-orphans

# --- wait for it to actually answer -----------------------------------------
#
# `up -d` returns as soon as the containers are created, which is well before
# the app is serving. Poll the healthcheck so the script's exit code means
# something.
echo
echo -n "→ waiting for the app to become healthy "
STATUS="unknown"
for _ in $(seq 1 60); do
  CID="$($DC -f "$COMPOSE_FILE" ps -q bambai 2>/dev/null || true)"
  if [ -n "$CID" ]; then
    STATUS="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$CID" 2>/dev/null || echo unknown)"
    case "$STATUS" in
      healthy|running) break ;;
    esac
  fi
  echo -n "."
  sleep 2
done
echo " $STATUS"

echo
$DC -f "$COMPOSE_FILE" ps

# --- where to find it -------------------------------------------------------
echo
if [ "$STACK" = "plain" ]; then
  PORT="$(grep -oE '^\s*-\s*"[0-9]+:8787"' "$COMPOSE_FILE" | grep -oE '[0-9]+:' | head -1 | tr -d ':')"
  echo "  http://localhost:${PORT:-8787}      landing"
  echo "  http://localhost:${PORT:-8787}/app/ map"
else
  ORIGIN="$(grep -E '^APP_ORIGIN=' .env | cut -d= -f2- | tr -d '"'"'"' ')"
  echo "  ${ORIGIN:-https://<SITE_ADDRESS>}      landing"
  echo "  ${ORIGIN:-https://<SITE_ADDRESS>}/app/ map"
  echo
  echo "  First run on a new hostname takes a minute to get a certificate."
  CERT_SVC=$([ "$STACK" = "nginx" ] && echo certbot || echo caddy)
  echo "  Watch it:  $DC -f $COMPOSE_FILE logs -f $CERT_SVC"
fi

echo
echo "  logs:  $DC -f $COMPOSE_FILE logs -f bambai"

if [ "$STATUS" != "healthy" ] && [ "$STATUS" != "running" ]; then
  echo
  echo "The app did not report healthy. Last few lines:" >&2
  $DC -f "$COMPOSE_FILE" logs --tail 30 bambai >&2 || true
  exit 1
fi
