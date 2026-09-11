#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly BRANCH="${DEPLOY_BRANCH:-main}"
readonly PM2_APP="${PM2_APP_NAME:-foodie-backend}"
readonly HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:4000/v1/health}"
readonly HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-15}"
PREVIOUS_COMMIT=""
BACKUP_FILE=""
PM2_RELOADED=false

deploy_failed() {
  local exit_code=$?
  echo "Deployment failed." >&2
  if [[ -n "$PREVIOUS_COMMIT" && -n "$BACKUP_FILE" ]]; then
    echo "Previous commit: $PREVIOUS_COMMIT" >&2
    echo "Database backup: $BACKUP_FILE" >&2
    echo "To roll back code: bash scripts/rollback-production.sh $PREVIOUS_COMMIT" >&2
    echo "To restore code and database: bash scripts/rollback-production.sh $PREVIOUS_COMMIT --restore-db $BACKUP_FILE --confirm" >&2
  fi
  if [[ "$PM2_RELOADED" == true ]]; then
    echo "PM2 was already reloaded; review the health check before choosing a rollback." >&2
  fi
  exit "$exit_code"
}
trap deploy_failed ERR

cd "$APP_DIR"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Deployment aborted: the server worktree has uncommitted changes." >&2
  exit 1
fi

PREVIOUS_COMMIT="$(git rev-parse HEAD)"
BACKUP_FILE="$(BACKUP_REASON=pre-deploy bash scripts/backup-production.sh)"
echo "Database backup: $BACKUP_FILE"
echo "Previous commit: $PREVIOUS_COMMIT"

git fetch --prune origin "$BRANCH"
git checkout "$BRANCH"
git merge --ff-only "origin/$BRANCH"

npm ci --include=dev
npm run prisma:generate
npm run build
npm run prisma:deploy

pm2 reload ecosystem.config.js --only "$PM2_APP" --update-env
PM2_RELOADED=true

for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++)); do
  if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
    echo "Deployment completed successfully."
    exit 0
  fi
  sleep 2
done

echo "Deployment failed: the process did not pass its health check at $HEALTH_URL." >&2
exit 1
