#!/usr/bin/env bash
# score-patch.sh <arm_repo> : inject hidden test, build, run new test + full suite. Emits JSON.
set -uo pipefail
REPO="$1"
ORACLE=/home/mathias/dev/agent-roster/benchmarks/quality-cost/problems/miaou-feature/oracle
cp "$ORACLE/test_chart_utils_normalize.ml" "$REPO/test/test_chart_utils_normalize.ml"
cat "$ORACLE/dune-stanza.txt" >> "$REPO/test/dune"
cd "$REPO" || exit 2
eval $(opam env --switch=/home/mathias/dev/miaou --set-switch 2>/dev/null)
dune build @all >"$REPO/.sp_build.log" 2>&1; BUILD=$?
NEW=1
if [ $BUILD -eq 0 ] && [ -x ./_build/default/test/test_chart_utils_normalize.exe ]; then
  ./_build/default/test/test_chart_utils_normalize.exe >"$REPO/.sp_new.log" 2>&1; NEW=$?
fi
dune runtest >"$REPO/.sp_suite.log" 2>&1; SUITE=$?
b=false; n=false; s=false
[ $BUILD -eq 0 ] && b=true; [ $NEW -eq 0 ] && n=true; [ $SUITE -eq 0 ] && s=true
echo "{\"build_ok\":$b,\"new_test_ok\":$n,\"suite_ok\":$s}"
