#!/usr/bin/env bash
# score-py.sh <arm_repo> : drop the hidden OVER oracle test, run feature test + regression suite.
set -uo pipefail
REPO="$1"
O=/home/mathias/dev/agent-roster/benchmarks/quality-cost/problems/sqlparse-feat/oracle
cp "$O/test_over_oracle.py" "$REPO/tests/test_over_oracle.py"
cd "$REPO" || exit 2
PY="$REPO/.venv/bin/python"
# feature: the OVER oracle alone
"$PY" -m pytest tests/test_over_oracle.py -q >"$REPO/.sp_feat.log" 2>&1; FEAT=$?
# regression: the rest of the suite (existing behavior), excluding the oracle
"$PY" -m pytest tests/ -q --ignore=tests/test_over_oracle.py >"$REPO/.sp_reg.log" 2>&1; REG=$?
# whole suite
"$PY" -m pytest tests/ -q >"$REPO/.sp_all.log" 2>&1; ALL=$?
f=false; r=false; s=false
[ $FEAT -eq 0 ] && f=true; [ $REG -eq 0 ] && r=true; [ $ALL -eq 0 ] && s=true
echo "{\"feature_ok\":$f,\"regression_ok\":$r,\"suite_ok\":$s}"
