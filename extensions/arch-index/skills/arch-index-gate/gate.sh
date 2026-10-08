#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$HERE/adapter.py" gate "$@"
