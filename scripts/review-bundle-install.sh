#!/usr/bin/env bash
# scripts/review-bundle-install.sh — the ONE script that owns install/upgrade/remove/verify for
# the review-tool bundle (F-1). Four call sites share this single implementation: recruiter
# prose (fetch + run, two lines), init-harness.sh (--from-checkout, warn-on-drift), roster-doctor
# (verify mode), and the scratch integration test (runs this script for real). Self-contained —
# a fresh consumer project has no scripts/lib/ yet, so this file may not source anything outside
# itself.
#
# Usage:
#   review-bundle-install.sh install   --from-raw <url-prefix> | --from-checkout <dir> [--force] [--target <dir>]
#   review-bundle-install.sh upgrade   --from-raw <url-prefix> | --from-checkout <dir> [--force] [--target <dir>]
#   review-bundle-install.sh remove    [--target <dir>]
#   review-bundle-install.sh verify    [--target <dir>]
#
# --target defaults to the current directory. install/upgrade require exactly one source flag.
# verify makes NO network calls (FR-142) and never fetches.
#
# Exit codes: 0 clean; 1 usage/integrity/collision/verify-failure error; 2 missing prerequisite.
# Prerequisites: bash, jq, curl (raw mode only), sha256sum or shasum -a 256.
#
# Model (specs/review-tool-distribution.md, F-1/FR-130..136): staged fetch -> verify ALL shas ->
# collision check -> move into place -> manifest LAST. Staging is a subdirectory of --target
# (same filesystem — the final move is a same-fs `mv`, never a cross-device copy). No .bak files
# are ever created by this script (F-8). Partial fetch failure leaves staging-only residue,
# targets untouched (FR-131/153) — no trap is registered: staging deliberately survives a
# non-zero exit for inspection.
#
# Bespoke, not the extension system (FR-137): the extension converge/lock machinery
# (scripts/roster-extension.ts) assumes a trusted node runtime and an existing .harness tree —
# neither holds here (this script IS the bootstrap; a fresh consumer may have no .harness/ yet,
# and the fetch must be plain bash before any node-side trust decision is possible). Conventions
# (a committed manifest, sha-verified files) are borrowed for future convergence, but the two
# systems stay disjoint today — scripts/review-bundle-install.test.js asserts the extension
# converge path never touches a bundle path.

set -uo pipefail

MANIFEST_REL="scripts/review-bundle.manifest.json"
RUNBOOK="Run: bash scripts/review-bundle-install.sh install --from-raw <url> (or --from-checkout <dir>), then /recruit update."
# F-5/FIX-2: recovery guidance for a modified file — the shared wrapper included, sha verified
# like any other file even though its removal semantics differ. Two ways out: --force reinstalls
# (overwrites local edits) or restore the file's original content from scripts/review-bundle.
# manifest.json's recorded sha and re-run without --force.
RECOVERY="Recovery: re-run install/upgrade with --force to reinstall from source (overwrites the modified file), or manually restore its original content to match the sha recorded in $MANIFEST_REL and re-run without --force."

usage() {
  echo "usage: review-bundle-install.sh <install|upgrade|remove|verify> [--from-raw <url>|--from-checkout <dir>] [--force] [--target <dir>]" >&2
  exit 1
}

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "review-bundle-install: missing required command: $1" >&2; exit 2; }; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else echo "review-bundle-install: need sha256sum or shasum" >&2; exit 2
  fi
}

abort() { echo "review-bundle-install: $*" >&2; exit 1; }

MODE="${1:-}"; shift || usage
case "$MODE" in install|upgrade|remove|verify) ;; *) usage ;; esac

SOURCE_MODE=""; SOURCE_ARG=""; FORCE=0; TARGET="."
while [ $# -gt 0 ]; do
  case "$1" in
    --from-raw) SOURCE_MODE="raw"; SOURCE_ARG="${2:-}"; shift ;;
    --from-checkout) SOURCE_MODE="checkout"; SOURCE_ARG="${2:-}"; shift ;;
    --force) FORCE=1 ;;
    --target) TARGET="${2:-.}"; shift ;;
    *) echo "review-bundle-install: unknown option: $1" >&2; usage ;;
  esac
  shift
done

need_cmd jq
if [ "$MODE" = "install" ] || [ "$MODE" = "upgrade" ]; then
  [ -n "$SOURCE_MODE" ] || { echo "review-bundle-install: $MODE requires --from-raw or --from-checkout" >&2; usage; }
  [ "$SOURCE_MODE" = "raw" ] && need_cmd curl
fi

RESOLVED_TARGET="$(cd "$TARGET" 2>/dev/null && pwd)"
[ -n "$RESOLVED_TARGET" ] || abort "--target $TARGET does not exist or is not a directory"
TARGET="$RESOLVED_TARGET"
TARGET_MANIFEST="$TARGET/$MANIFEST_REL"
STAGING="$TARGET/.review-bundle-staging"

# ── source access (raw fetch or checkout read) — verify/remove never call these ────────────
read_source_manifest() {
  if [ "$SOURCE_MODE" = "raw" ]; then curl -fsSL "$SOURCE_ARG/$MANIFEST_REL" 2>/dev/null
  else cat "$SOURCE_ARG/$MANIFEST_REL" 2>/dev/null
  fi
}

# Fetch/copy one bundle file into staging. Retries once, then the caller aborts (FR-131).
fetch_one() {
  local rel="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [ "$SOURCE_MODE" = "raw" ]; then
    curl -fsSL "$SOURCE_ARG/$rel" -o "$dest" 2>/dev/null && return 0
    curl -fsSL "$SOURCE_ARG/$rel" -o "$dest" 2>/dev/null && return 0
  else
    cp "$SOURCE_ARG/$rel" "$dest" 2>/dev/null && return 0
    cp "$SOURCE_ARG/$rel" "$dest" 2>/dev/null && return 0
  fi
  return 1
}

manifest_field() { echo "$1" | jq -r "$2"; }          # manifest_field "$json" ".bundle_version"
manifest_count() { echo "$1" | jq -r '.files | length'; }
manifest_path()  { echo "$1" | jq -r ".files[$2].path"; }
manifest_sha()   { echo "$1" | jq -r ".files[$2].sha256"; }
manifest_shared() { echo "$1" | jq -r ".files[$2].shared // false"; }

# ── verify mode (F-3/F-5: doctor's gate probe; no network, checks ALL files incl. shared) ───
run_verify() {
  [ -f "$TARGET_MANIFEST" ] || abort "bundle not installed — $MANIFEST_REL absent. $RUNBOOK"
  local manifest problems=0 count i path want got
  manifest="$(cat "$TARGET_MANIFEST")"
  count=$(manifest_count "$manifest")
  for i in $(seq 0 $((count - 1))); do
    path=$(manifest_path "$manifest" "$i"); want=$(manifest_sha "$manifest" "$i")
    if [ ! -f "$TARGET/$path" ]; then
      echo "review-bundle-install: verify: MISSING $path" >&2; problems=$((problems + 1)); continue
    fi
    got="$(sha256_of "$TARGET/$path")"
    [ "$got" = "$want" ] || { echo "review-bundle-install: verify: SHA MISMATCH $path — $RECOVERY" >&2; problems=$((problems + 1)); }
  done
  command -v node >/dev/null 2>&1 || { echo "review-bundle-install: verify: node not found" >&2; problems=$((problems + 1)); }
  [ "$problems" -eq 0 ] || abort "$problems problem(s) found. $RUNBOOK"
  echo "review-bundle-install: verify OK — $count file(s) present and sha-matched."
}

# ── remove mode (FR-136/FR-151/FR-152: skip shared, skip modified, continue past missing) ──
run_remove() {
  [ -f "$TARGET_MANIFEST" ] || abort "nothing to remove — $MANIFEST_REL absent"
  local manifest count i path sha shared
  manifest="$(cat "$TARGET_MANIFEST")"
  count=$(manifest_count "$manifest")
  for i in $(seq 0 $((count - 1))); do
    path=$(manifest_path "$manifest" "$i"); sha=$(manifest_sha "$manifest" "$i"); shared=$(manifest_shared "$manifest" "$i")
    if [ "$shared" = "true" ]; then echo "review-bundle-install: remove: keeping shared file $path"; continue; fi
    if [ ! -f "$TARGET/$path" ]; then echo "review-bundle-install: remove: WARN $path already missing, continuing" >&2; continue; fi
    if [ "$(sha256_of "$TARGET/$path")" != "$sha" ]; then
      echo "review-bundle-install: remove: WARN $path was modified by the consumer — skipping" >&2; continue
    fi
    rm -f "$TARGET/$path"
  done
  rm -f "$TARGET_MANIFEST"
  echo "review-bundle-install: remove complete."
}

# ── staged fetch: download/copy every file, verify ALL shas before touching TARGET ──────────
stage_all_files() {
  local manifest="$1" count i rel want got
  count=$(manifest_count "$manifest")
  for i in $(seq 0 $((count - 1))); do
    rel=$(manifest_path "$manifest" "$i"); want=$(manifest_sha "$manifest" "$i")
    fetch_one "$rel" "$STAGING/$rel" || abort "failed to fetch $rel after one retry. Staging left at $STAGING for inspection."
    got="$(sha256_of "$STAGING/$rel")"
    [ "$got" = "$want" ] || abort "sha256 mismatch staging $rel (got $got, want $want). Staging left at $STAGING for inspection."
  done
}

# FR-134: pre-existing target paths must match either the old (currently-installed) or the new
# manifest's sha; anything else is a collision, aborted unless --force.
check_collisions() {
  local new_manifest="$1" old_manifest="$2" count i rel new_sha old_sha=""
  local -a collisions=()
  count=$(manifest_count "$new_manifest")
  for i in $(seq 0 $((count - 1))); do
    rel=$(manifest_path "$new_manifest" "$i"); new_sha=$(manifest_sha "$new_manifest" "$i")
    [ -f "$TARGET/$rel" ] || continue
    local current; current="$(sha256_of "$TARGET/$rel")"
    [ "$current" = "$new_sha" ] && continue
    if [ -n "$old_manifest" ]; then
      old_sha=$(echo "$old_manifest" | jq -r --arg p "$rel" '.files[] | select(.path == $p) | .sha256')
      [ "$current" = "$old_sha" ] && continue
    fi
    collisions+=("$rel")
  done
  if [ "${#collisions[@]}" -gt 0 ] && [ "$FORCE" -ne 1 ]; then
    abort "refusing to install — pre-existing file(s) match neither the old nor new manifest sha: ${collisions[*]}. $RECOVERY"
  fi
}

move_staged_into_place() {
  local manifest="$1" count i rel
  count=$(manifest_count "$manifest")
  for i in $(seq 0 $((count - 1))); do
    rel=$(manifest_path "$manifest" "$i")
    mkdir -p "$TARGET/$(dirname "$rel")" || abort "could not create $TARGET/$(dirname "$rel") — target left partially updated, staging at $STAGING for inspection."
    mv -f "$STAGING/$rel" "$TARGET/$rel" || abort "failed to move staged $rel into place — the manifest was NOT written; target left partially updated, staging at $STAGING for inspection."
  done
}

# FR-135/150/152: upgrade-only orphan cleanup — files in the OLD manifest, not shared, absent
# from the NEW manifest, deleted unless the consumer modified them (skip with warning).
delete_upgrade_orphans() {
  local old_manifest="$1" new_manifest="$2" count i rel sha shared
  count=$(manifest_count "$old_manifest")
  for i in $(seq 0 $((count - 1))); do
    rel=$(manifest_path "$old_manifest" "$i"); sha=$(manifest_sha "$old_manifest" "$i"); shared=$(manifest_shared "$old_manifest" "$i")
    [ "$shared" = "true" ] && continue
    echo "$new_manifest" | jq -e --arg p "$rel" '.files[] | select(.path == $p)' >/dev/null && continue
    [ -f "$TARGET/$rel" ] || continue
    if [ "$(sha256_of "$TARGET/$rel")" != "$sha" ]; then
      echo "review-bundle-install: upgrade: WARN $rel was modified by the consumer — not deleting orphan" >&2; continue
    fi
    rm -f "$TARGET/$rel"
  done
}

# FR-132: --from-checkout copies from a dev tree and WARNS (never aborts) if the checkout's own
# files disagree with the checkout's own committed manifest — the dev tree is truth, drift here
# is informational only.
warn_on_checkout_drift() {
  local checkout_manifest count i rel want got
  [ -f "$SOURCE_ARG/$MANIFEST_REL" ] || return 0
  checkout_manifest="$(cat "$SOURCE_ARG/$MANIFEST_REL")"
  count=$(manifest_count "$checkout_manifest")
  for i in $(seq 0 $((count - 1))); do
    rel=$(manifest_path "$checkout_manifest" "$i"); want=$(manifest_sha "$checkout_manifest" "$i")
    [ -f "$SOURCE_ARG/$rel" ] || continue
    got="$(sha256_of "$SOURCE_ARG/$rel")"
    [ "$got" = "$want" ] || echo "review-bundle-install: WARN checkout drift — $rel in $SOURCE_ARG does not match its own committed manifest (dev tree is truth; proceeding)" >&2
  done
}

run_install_or_upgrade() {
  local new_manifest old_manifest=""
  new_manifest="$(read_source_manifest)"
  [ -n "$new_manifest" ] || abort "could not read the source manifest from $SOURCE_ARG"
  [ "$SOURCE_MODE" = "checkout" ] && warn_on_checkout_drift
  [ -f "$TARGET_MANIFEST" ] && old_manifest="$(cat "$TARGET_MANIFEST")"
  [ "$MODE" = "upgrade" ] && [ -z "$old_manifest" ] && abort "upgrade requires an existing $MANIFEST_REL in --target; use install for a first-time setup"

  rm -rf "$STAGING"
  stage_all_files "$new_manifest"
  check_collisions "$new_manifest" "$old_manifest"
  move_staged_into_place "$new_manifest"
  [ "$MODE" = "upgrade" ] && delete_upgrade_orphans "$old_manifest" "$new_manifest"
  echo "$new_manifest" > "$TARGET_MANIFEST"   # manifest written LAST (FR-130)
  rm -rf "$STAGING"
  echo "review-bundle-install: $MODE complete — $(manifest_count "$new_manifest") file(s)."
}

case "$MODE" in
  verify) run_verify ;;
  remove) run_remove ;;
  install|upgrade) run_install_or_upgrade ;;
esac
