#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly BACKUP_DIR="${BACKUP_DIR:-/var/backups/foodie/postgres}"
readonly RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
readonly BACKUP_REASON="${BACKUP_REASON:-manual}"

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

readonly PG_DUMP_BIN="$(resolve_postgres_binary pg_dump)"
readonly PG_RESTORE_BIN="$(resolve_postgres_binary pg_restore)"

if ! [[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_RETENTION_DAYS must be a positive integer." >&2
  exit 1
fi

for command_name in "$PG_DUMP_BIN" "$PG_RESTORE_BIN" sha256sum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Backup aborted: $command_name is required." >&2
    exit 1
  fi
done

cd "$APP_DIR"
readonly PG_DATABASE_URL="$(bash scripts/database-url-for-pg.sh)"

umask 077
mkdir -p "$BACKUP_DIR"
if [[ ! -w "$BACKUP_DIR" ]]; then
  echo "Backup aborted: $BACKUP_DIR is not writable." >&2
  exit 1
fi

readonly TIMESTAMP="$(date -u +%Y%m%dT%H%M%S%NZ)"
readonly COMMIT="$(git rev-parse HEAD)"
readonly PREFIX="foodie-backend_${TIMESTAMP}_${COMMIT:0:12}"
readonly DUMP_FILE="$BACKUP_DIR/${PREFIX}.dump"
readonly TEMP_DUMP_FILE="${DUMP_FILE}.tmp"
readonly METADATA_FILE="$BACKUP_DIR/${PREFIX}.metadata"

cleanup() { rm -f "$TEMP_DUMP_FILE"; }
trap cleanup EXIT

"$PG_DUMP_BIN" --format=custom --no-owner --no-privileges --file "$TEMP_DUMP_FILE" "$PG_DATABASE_URL"
"$PG_RESTORE_BIN" --list "$TEMP_DUMP_FILE" >/dev/null
mv "$TEMP_DUMP_FILE" "$DUMP_FILE"
sha256sum "$DUMP_FILE" > "${DUMP_FILE}.sha256"
printf 'created_at=%s\ncommit=%s\nreason=%s\ndump=%s\n' \
  "$TIMESTAMP" "$COMMIT" "$BACKUP_REASON" "$DUMP_FILE" > "$METADATA_FILE"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'foodie-backend_*' -mtime "+$((RETENTION_DAYS - 1))" -delete
printf '%s\n' "$DUMP_FILE"
