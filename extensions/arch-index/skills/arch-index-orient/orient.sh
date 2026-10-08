#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")/../arch-index-gate" && pwd)"
exec python3 "$HERE/adapter.py" orient "$@"
