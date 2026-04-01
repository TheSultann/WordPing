#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$PWD}"
BACKUP_LOG_PATH="${BACKUP_LOG_PATH:-$PROJECT_DIR/backups/backup.log}"
NPM_BIN="${NPM_BIN:-$(command -v npm || true)}"

if [[ -z "$NPM_BIN" ]]; then
  echo "npm not found in PATH" >&2
  exit 1
fi

mkdir -p "$(dirname "$BACKUP_LOG_PATH")"

CRON_LINE="0 3 * * * cd $PROJECT_DIR && $NPM_BIN run backup:db >> $BACKUP_LOG_PATH 2>&1"
CURRENT_CRONTAB="$(crontab -l 2>/dev/null || true)"

if printf '%s\n' "$CURRENT_CRONTAB" | grep -Fqx "$CRON_LINE"; then
  echo "backup cron already installed"
  echo "$CRON_LINE"
  exit 0
fi

{
  printf '%s\n' "$CURRENT_CRONTAB" | sed '/^[[:space:]]*$/d'
  printf '%s\n' "$CRON_LINE"
} | crontab -

echo "backup cron installed"
echo "$CRON_LINE"
