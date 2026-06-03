#!/usr/bin/env bash
# score-feat.sh <arm_repo> : restore the REMOVED input_parser regression test (hidden oracle) +
# add the F-key feature test, then build + run. Emits build/feature/regression/suite.
set -uo pipefail
REPO="$1"; M=/home/mathias/dev/miaou
O=/home/mathias/dev/agent-roster/benchmarks/quality-cost/problems/miaou-feat/oracle
# Restore the regression test that was removed from the agent's repo (the hidden net).
git -C "$M" show origin/main:test/test_input_parser.ml > "$REPO/test/test_input_parser.ml"
grep -q "name test_input_parser)" "$REPO/test/dune" || cat >> "$REPO/test/dune" <<'D'

(test
 (name test_input_parser)
 (modules test_input_parser)
 (libraries alcotest miaou-core.driver-common unix))
D
# Add the feature oracle test.
cp "$O/test_input_parser_fkeys.ml" "$REPO/test/test_input_parser_fkeys.ml"
grep -q "name test_input_parser_fkeys)" "$REPO/test/dune" || cat >> "$REPO/test/dune" <<'D'

(test
 (name test_input_parser_fkeys)
 (modules test_input_parser_fkeys)
 (libraries alcotest miaou-core.driver-common unix))
D
cd "$REPO" || exit 2
eval $(opam env --switch=/home/mathias/dev/miaou --set-switch 2>/dev/null)
dune build @all >"$REPO/.sf_build.log" 2>&1; BUILD=$?
FK=1; IP=1
if [ $BUILD -eq 0 ]; then
  if [ -x ./_build/default/test/test_input_parser_fkeys.exe ]; then ./_build/default/test/test_input_parser_fkeys.exe >"$REPO/.sf_fk.log" 2>&1; FK=$?; fi
  if [ -x ./_build/default/test/test_input_parser.exe ]; then ./_build/default/test/test_input_parser.exe >"$REPO/.sf_ip.log" 2>&1; IP=$?; fi
fi
dune runtest >"$REPO/.sf_suite.log" 2>&1; SUITE=$?
b=false; fk=false; ip=false; s=false
[ $BUILD -eq 0 ] && b=true; [ $FK -eq 0 ] && fk=true; [ $IP -eq 0 ] && ip=true; [ $SUITE -eq 0 ] && s=true
echo "{\"build_ok\":$b,\"fkeys_ok\":$fk,\"inputparser_regression_ok\":$ip,\"suite_ok\":$s}"
