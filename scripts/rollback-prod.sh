#!/usr/bin/env bash

set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/release-common.sh"

TARGET_RELEASE="${1:-}"

require_command pm2
require_command sudo
require_command rsync
require_command curl
require_command readlink
require_command mv
require_command ln

ensure_dir "$RELEASES_DIR" "$SHARED_DIR"

current_release="$(resolve_link_target "$CURRENT_LINK" || true)"

if [[ -n "$TARGET_RELEASE" ]]; then
  if [[ -d "$TARGET_RELEASE" ]]; then
    rollback_release="$TARGET_RELEASE"
  elif [[ -d "${RELEASES_DIR}/${TARGET_RELEASE}" ]]; then
    rollback_release="${RELEASES_DIR}/${TARGET_RELEASE}"
  else
    log "Rollback target not found: ${TARGET_RELEASE}"
    exit 1
  fi
else
  rollback_release="$(resolve_link_target "$PREVIOUS_LINK" || true)"
fi

if [[ -z "$rollback_release" ]]; then
  log 'No previous release available for rollback'
  exit 1
fi

if [[ "$rollback_release" == "$current_release" ]]; then
  log 'Rollback target is already current'
  exit 0
fi

if ! rollback_to_release "$rollback_release" "$current_release"; then
  log 'Rollback failed'
  exit 1
fi

log "Rollback completed to $(basename "$rollback_release")"
