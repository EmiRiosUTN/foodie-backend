#!/usr/bin/env bash
set -Eeuo pipefail

readonly APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly ENV_FILE="$APP_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo ".env was not found in $APP_DIR." >&2
  exit 1
fi

node - "$ENV_FILE" <<'NODE'
const fs = require("node:fs");

const envFile = process.argv[2];
const line = fs.readFileSync(envFile, "utf8")
  .split(/\r?\n/)
  .find((item) => /^\s*DATABASE_URL\s*=/.test(item));

if (!line) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

let databaseUrl = line.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim();
if ((databaseUrl.startsWith('"') && databaseUrl.endsWith('"')) || (databaseUrl.startsWith("'") && databaseUrl.endsWith("'"))) {
  databaseUrl = databaseUrl.slice(1, -1);
}

try {
  const url = new URL(databaseUrl);
  for (const parameter of ["schema", "connection_limit", "pool_timeout", "pgbouncer"]) {
    url.searchParams.delete(parameter);
  }
  process.stdout.write(url.toString());
} catch {
  console.error("DATABASE_URL is not a valid PostgreSQL URL.");
  process.exit(1);
}
NODE
