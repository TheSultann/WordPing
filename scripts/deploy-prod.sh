#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/release-common.sh"

TARGET_REF="${1:-origin/main}"

require_command git
require_command npm
require_command npx
require_command node
require_command tar
require_command rsync
require_command curl
require_command pm2
require_command sudo
require_command readlink
require_command find
require_command mv
require_command ln

require_root_env_file
ensure_dir "$RELEASES_DIR" "$SHARED_DIR"
require_clean_repo

log 'Fetching latest refs from origin'
fetch_origin_refs

resolved_sha="$(resolve_ref_sha "$TARGET_REF")"
release_name="$(release_name_for_sha "$resolved_sha")"
release_dir="${RELEASES_DIR}/${release_name}"
current_before_switch="$(resolve_link_target "$CURRENT_LINK" || true)"
previous_before_switch="$(resolve_link_target "$PREVIOUS_LINK" || true)"

log "Preparing release ${release_name}"
prepare_release_from_sha "$resolved_sha" "$release_dir"
link_release_env_files "$release_dir"

cd "$release_dir"

log 'Installing backend dependencies'
npm ci --include=dev

log 'Installing frontend dependencies'
npm --prefix web ci --include=dev

log 'Checking Prisma migration status'
if ! npx prisma migrate status; then
  log "Deployment blocked: pending or divergent database migrations detected for ${resolved_sha}"
  log "Run scripts/migrate-prod.sh ${resolved_sha} first, then deploy the app release."
  exit 1
fi

log 'Generating Prisma client'
npx prisma generate

log 'Building backend'
npm run build

log 'Building frontend'
npm run build:web

log 'Activating frontend assets'
if ! sync_frontend_dist "$release_dir"; then
  log 'Frontend activation failed before process switch'
  exit 1
fi

if [[ -n "$current_before_switch" && -d "$current_before_switch" ]]; then
  set_link_target "$PREVIOUS_LINK" "$current_before_switch"
else
  clear_link_target "$PREVIOUS_LINK"
fi

set_link_target "$CURRENT_LINK" "$release_dir"
clear_link_target "$FAILED_LINK"

log 'Reloading PM2 processes with new release'
if ! pm2_reload_release "$CURRENT_LINK"; then
  log 'PM2 reload failed, starting automatic rollback'
  rollback_to_release "$current_before_switch" "$previous_before_switch" "$release_dir" || true
  exit 1
fi

log 'Waiting for readiness checks'
if ! wait_for_application_ready; then
  log 'Readiness check failed after deploy, starting automatic rollback'
  rollback_to_release "$current_before_switch" "$previous_before_switch" "$release_dir" || true
  exit 1
fi

prune_old_releases "$release_dir" "$current_before_switch"
log "Deploy completed for $(git -C "$REPO_DIR" rev-parse --short "$resolved_sha")"
