#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/release-common.sh"

TARGET_REF="${1:-origin/main}"
MIGRATION_WORK_ROOT="${MIGRATION_WORK_ROOT:-${DEPLOY_ROOT}/migration-work}"
MIGRATION_BACKUP_DIR="${MIGRATION_BACKUP_DIR:-${SHARED_DIR}/backups/pre-migration}"
MIGRATION_BACKUP_PREFIX="${MIGRATION_BACKUP_PREFIX:-wordping-pre-migrate}"
LAST_MIGRATION_FILE="${LAST_MIGRATION_FILE:-${SHARED_DIR}/last-migrated-sha}"

cleanup() {
  if [[ -n "${migration_work_dir:-}" && -d "${migration_work_dir}" ]]; then
    rm -rf "${migration_work_dir}"
  fi
}

trap cleanup EXIT

require_command git
require_command npm
require_command npx
require_command node
require_command tar

require_root_env_file
ensure_dir "$RELEASES_DIR" "$SHARED_DIR" "$MIGRATION_WORK_ROOT" "$MIGRATION_BACKUP_DIR"
require_clean_repo

log 'Fetching latest refs from origin'
fetch_origin_refs

resolved_sha="$(resolve_ref_sha "$TARGET_REF")"
migration_work_dir="${MIGRATION_WORK_ROOT}/$(release_name_for_sha "$resolved_sha")"

log "Preparing migration workspace for ${resolved_sha}"
prepare_release_from_sha "$resolved_sha" "$migration_work_dir"
link_release_env_files "$migration_work_dir"

cd "$migration_work_dir"

log 'Installing backend dependencies for migration tooling'
npm ci --include=dev

log 'Creating pre-migration backup'
backup_path="$(node scripts/create-local-db-backup.mjs "$MIGRATION_BACKUP_DIR" "${MIGRATION_BACKUP_PREFIX}-${resolved_sha:0:12}")"
printf '%s\n' "$backup_path" > "${SHARED_DIR}/last-pre-migration-backup.txt"

log 'Inspecting migration status'
if ! npx prisma migrate status; then
  log 'Migration status is not clean yet. Continuing with guarded migration apply.'
fi

log 'Applying Prisma migrations'
npx prisma migrate deploy

printf '%s\n' "$resolved_sha" > "$LAST_MIGRATION_FILE"
log "Migration completed for ${resolved_sha}"
log "Backup saved to ${backup_path}"
