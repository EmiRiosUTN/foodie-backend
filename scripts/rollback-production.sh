#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PM2_APP="${PM2_APP_NAME:-foodie-backend}"
readonly HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/v1/health}"
readonly HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-15}"

resolve_postgres_binary() {
  local binary_name="$1"
  local client_binary=""
  client_binary="$(find /usr/lib/postgresql -mindepth 3 -maxdepth 3 -type f -name "$binary_name" 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -n "$client_binary" ]]; then
    printf '%s\n' "$client_binary"
    return
  fi
  command -v "$binary_name"
}

readonly PG_RESTORE_BIN="$(resolve_postgres_binary pg_restore)"

usage() {
  echo "Usage: bash scripts/rollback-production.sh <commit> [--restore-db <backup.dump> --confirm]" >&2
  exit 1
}

[[ $# -ge 1 ]] || usage
readonly TARGET_COMMIT="$1"
shift

RESTORE_DUMP=""
CONFIRMED=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --restore-db) [[ $# -ge 2 ]] || usage; RESTORE_DUMP="$2"; shift 2 ;;
    --confirm) CONFIRMED=true; shift ;;
    *) usage ;;
  esac
done

if [[ -n "$RESTORE_DUMP" && "$CONFIRMED" != true ]]; then
  echo "Database restoration requires --confirm." >&2
  exit 1
fi
if [[ -z "$RESTORE_DUMP" && "$CONFIRMED" == true ]]; then
  echo "--confirm is only valid with --restore-db." >&2
  exit 1
fi

cd "$APP_DIR"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Rollback aborted: the server worktree has uncommitted changes." >&2
  exit 1
fi
git rev-parse --verify "${TARGET_COMMIT}^{commit}" >/dev/null

CURRENT_BACKUP="$(BACKUP_REASON=pre-rollback bash scripts/backup-production.sh)"
echo "Current database backup: $CURRENT_BACKUP"

if [[ -n "$RESTORE_DUMP" ]]; then
  [[ -f "$RESTORE_DUMP" ]] || { echo "Backup file not found: $RESTORE_DUMP" >&2; exit 1; }
  command -v "$PG_RESTORE_BIN" >/dev/null 2>&1 || { echo "pg_restore is required." >&2; exit 1; }
  if [[ -f "${RESTORE_DUMP}.sha256" ]]; then
    sha256sum --check "${RESTORE_DUMP}.sha256"
  fi
  "$PG_RESTORE_BIN" --list "$RESTORE_DUMP" >/dev/null
  PG_DATABASE_URL="$(bash scripts/database-url-for-pg.sh)"
  pm2 stop "$PM2_APP"
  "$PG_RESTORE_BIN" --clean --if-exists --no-owner --no-privileges --dbname "$PG_DATABASE_URL" "$RESTORE_DUMP"
fi

git checkout --detach "$TARGET_COMMIT"
npm ci --include=dev
npm run prisma:generate
npm run build

if [[ -n "$RESTORE_DUMP" ]]; then
  pm2 start ecosystem.config.js --only "$PM2_APP" --update-env
else
  pm2 reload ecosystem.config.js --only "$PM2_APP" --update-env
fi

for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
  if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
    echo "Rollback completed successfully at commit $(git rev-parse --short HEAD)."
    exit 0
  fi
  sleep 2
done

echo "Rollback completed but the health check failed. The application requires manual review." >&2
exit 1
