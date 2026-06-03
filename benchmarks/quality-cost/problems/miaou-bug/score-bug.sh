#!/usr/bin/env bash
# score-bug.sh <arm_repo> : restore the authoritative test (anti-gaming), build, run full suite.
# Oracle = the repo's own test suite (incl. the grid row_gap test) all green.
set -uo pipefail
REPO="$1"
# Restore the canonical test file from origin/main so an arm cannot pass by editing the test.
git -C /home/mathias/dev/miaou show origin/main:test/test_grid_layout.ml > "$REPO/test/test_grid_layout.ml"
cd "$REPO" || exit 2
eval $(opam env --switch=/home/mathias/dev/miaou --set-switch 2>/dev/null)
dune build @all >"$REPO/.sb_build.log" 2>&1; BUILD=$?
dune runtest >"$REPO/.sb_suite.log" 2>&1; SUITE=$?
# did the arm actually touch the source?
TOUCHED=$(test -f "$REPO/src/miaou_widgets_layout/grid_layout.ml" && echo true || echo false)
b=false; s=false
[ $BUILD -eq 0 ] && b=true; [ $SUITE -eq 0 ] && s=true
echo "{\"build_ok\":$b,\"suite_ok\":$s,\"grid_src_present\":$TOUCHED}"
