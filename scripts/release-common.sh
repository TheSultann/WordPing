#!/usr/bin/env bash

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

REPO_DIR="${REPO_DIR:-${DEFAULT_REPO_DIR}}"
DEPLOY_ROOT="${DEPLOY_ROOT:-${REPO_DIR}/.deploy}"
RELEASES_DIR="${RELEASES_DIR:-${DEPLOY_ROOT}/releases}"
SHARED_DIR="${SHARED_DIR:-${DEPLOY_ROOT}/shared}"
CURRENT_LINK="${CURRENT_LINK:-${DEPLOY_ROOT}/current}"
PREVIOUS_LINK="${PREVIOUS_LINK:-${DEPLOY_ROOT}/previous}"
FAILED_LINK="${FAILED_LINK:-${DEPLOY_ROOT}/failed}"
WEB_ROOT="${WEB_ROOT:-/var/www/wordping}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
API_PORT="${API_PORT:-3001}"
API_READY_URL="${API_READY_URL:-http://localhost:${API_PORT}/api/ready}"
PUBLIC_URL="${PUBLIC_URL:-}"
HEALTHCHECK_ATTEMPTS="${HEALTHCHECK_ATTEMPTS:-12}"
HEALTHCHECK_SLEEP_SECONDS="${HEALTHCHECK_SLEEP_SECONDS:-5}"

log() {
  printf '[release] %s\n' "$*"
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    log "Missing required command: ${command_name}"
    return 1
  fi
}

ensure_dir() {
  mkdir -p "$@"
}

find_first_existing_file() {
  local candidate
  for candidate in "$@"; do
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if [[ -z "${ROOT_ENV_FILE:-}" ]]; then
  ROOT_ENV_FILE="$(find_first_existing_file "${SHARED_DIR}/.env" "${REPO_DIR}/.env" || true)"
fi

if [[ -z "${WEB_ENV_FILE:-}" ]]; then
  WEB_ENV_FILE="$(find_first_existing_file "${SHARED_DIR}/web.env" "${REPO_DIR}/web/.env" || true)"
fi

require_root_env_file() {
  if [[ -z "$ROOT_ENV_FILE" || ! -f "$ROOT_ENV_FILE" ]]; then
    log "Root env file not found. Expected ${SHARED_DIR}/.env or ${REPO_DIR}/.env"
    return 1
  fi
}

require_clean_repo() {
  if ! git -C "$REPO_DIR" diff --quiet || ! git -C "$REPO_DIR" diff --cached --quiet; then
    log 'Refusing to proceed: repository has uncommitted tracked changes'
    return 1
  fi
}

resolve_ref_sha() {
  git -C "$REPO_DIR" rev-parse "${1}^{commit}"
}

release_name_for_sha() {
  local sha="$1"
  printf '%s-%s\n' "$(date -u +%Y%m%dT%H%M%SZ)" "${sha:0:12}"
}

prepare_release_from_sha() {
  local sha="$1"
  local release_dir="$2"
  mkdir -p "$release_dir"
  git -C "$REPO_DIR" archive "$sha" | tar -x -C "$release_dir"
}

link_release_env_files() {
  local release_dir="$1"

  if [[ -n "$ROOT_ENV_FILE" && -f "$ROOT_ENV_FILE" ]]; then
    ln -sfn "$ROOT_ENV_FILE" "$release_dir/.env"
  fi

  if [[ -n "$WEB_ENV_FILE" && -f "$WEB_ENV_FILE" ]]; then
    mkdir -p "$release_dir/web"
    ln -sfn "$WEB_ENV_FILE" "$release_dir/web/.env"
  fi
}

resolve_link_target() {
  local link_path="$1"
  if [[ -L "$link_path" || -e "$link_path" ]]; then
    readlink -f "$link_path"
  fi
}

set_link_target() {
  local link_path="$1"
  local target_path="$2"
  local tmp_link="${link_path}.tmp.$$"

  ln -sfn "$target_path" "$tmp_link"
  mv -Tf "$tmp_link" "$link_path"
}

clear_link_target() {
  local link_path="$1"
  rm -f "$link_path"
}

fetch_origin_refs() {
  git -C "$REPO_DIR" fetch --prune --tags origin
}

sync_frontend_dist() {
  local release_dir="$1"
  local frontend_dist="${release_dir}/web/dist"

  if [[ ! -d "$frontend_dist" ]]; then
    log "Missing frontend build at ${frontend_dist}"
    return 1
  fi

  sudo rsync -av --delete "${frontend_dist}/" "${WEB_ROOT}/"
  sudo systemctl reload nginx
}

pm2_reload_release() {
  local release_path="$1"
  local ecosystem_path="${release_path}/ecosystem.config.cjs"

  if [[ ! -f "$ecosystem_path" ]]; then
    log "Missing PM2 ecosystem file at ${ecosystem_path}"
    return 1
  fi

  pm2 startOrReload "$ecosystem_path" --update-env
  pm2 save >/dev/null
}

wait_for_application_ready() {
  local attempt

  for attempt in $(seq 1 "$HEALTHCHECK_ATTEMPTS"); do
    if curl --fail --silent --show-error "$API_READY_URL" >/dev/null 2>&1; then
      if [[ -z "$PUBLIC_URL" ]] || curl --fail --silent --show-error --head "$PUBLIC_URL" >/dev/null 2>&1; then
        return 0
      fi
    fi

    log "Healthcheck attempt ${attempt}/${HEALTHCHECK_ATTEMPTS} failed"
    sleep "$HEALTHCHECK_SLEEP_SECONDS"
  done

  return 1
}

rollback_to_release() {
  local rollback_release="$1"
  local previous_release="${2:-}"
  local failed_release="${3:-}"
  local update_failed_link=0

  if (( $# >= 3 )); then
    update_failed_link=1
  fi

  if [[ -z "$rollback_release" || ! -d "$rollback_release" ]]; then
    log 'Automatic rollback unavailable: no previous release to restore'
    return 1
  fi

  log "Rolling back to $(basename "$rollback_release")"
  set_link_target "$CURRENT_LINK" "$rollback_release"

  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    set_link_target "$PREVIOUS_LINK" "$previous_release"
  else
    clear_link_target "$PREVIOUS_LINK"
  fi

  if (( update_failed_link )); then
    if [[ -n "$failed_release" && -d "$failed_release" ]]; then
      set_link_target "$FAILED_LINK" "$failed_release"
    else
      clear_link_target "$FAILED_LINK"
    fi
  fi

  sync_frontend_dist "$rollback_release"
  pm2_reload_release "$CURRENT_LINK"
  wait_for_application_ready
}

prune_old_releases() {
  local current_release="$1"
  local previous_release="${2:-}"
  local failed_release
  local dir
  local kept=0
  local -a release_dirs

  failed_release="$(resolve_link_target "$FAILED_LINK" || true)"
  mapfile -t release_dirs < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r)

  for dir in "${release_dirs[@]}"; do
    if [[ "$dir" == "$current_release" || ( -n "$previous_release" && "$dir" == "$previous_release" ) || ( -n "$failed_release" && "$dir" == "$failed_release" ) ]]; then
      continue
    fi

    if (( kept < KEEP_RELEASES )); then
      kept=$((kept + 1))
      continue
    fi

    rm -rf "$dir"
  done
}
