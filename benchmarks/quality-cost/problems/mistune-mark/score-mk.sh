#!/usr/bin/env bash
# score-mk.sh <arm_repo> : restore the thinned net (test_syntax.py = CommonMark conformance) +
# drop the hidden feature oracle, then run feature / regression / full suite.
set -uo pipefail
REPO="$1"; M=/tmp/mistune
O=/home/mathias/dev/agent-roster/benchmarks/quality-cost/problems/mistune-mark/oracle
git -C "$M" show HEAD:tests/test_syntax.py > "$REPO/tests/test_syntax.py"   # restore thinned net
cp "$O/test_mark_oracle.py" "$REPO/tests/test_mark_oracle.py"
cd "$REPO" || exit 2
PY="$REPO/.venv/bin/python"
"$PY" -m pytest tests/test_mark_oracle.py -q >"$REPO/.mk_feat.log" 2>&1; FEAT=$?
"$PY" -m pytest tests/test_syntax.py -q >"$REPO/.mk_reg.log" 2>&1; REG=$?
"$PY" -m pytest tests/ -q >"$REPO/.mk_all.log" 2>&1; ALL=$?
f=false; r=false; s=false
[ $FEAT -eq 0 ] && f=true; [ $REG -eq 0 ] && r=true; [ $ALL -eq 0 ] && s=true
echo "{\"feature_ok\":$f,\"regression_ok\":$r,\"suite_ok\":$s}"
