---
name: spec-intake-guard
version: 1.0.0
event: pre
skill: roster-spec
on_error: stop
description: Abort spec if the intake brief is absent or not validated.
---

Checks that `briefs/<task>-intake.md` exists and contains `Status: VALIDATED`
before allowing `roster-spec` to run. If either condition fails, the hook
stops with a user-visible message — preventing wasted spec cycles on an
unvalidated brief.

```yaml
steps:
  - log: "⏳ spec-intake-guard: checking intake brief..."

  - test: "[ -n \"$TASK\" ]"
    on_false:
      - log: "ERROR: $TASK is not set — cannot locate intake brief"
      - run: "exit 1"

  - test: "[ -f \"briefs/${TASK}-intake.md\" ]"
    on_true:
      - log: "✓ intake brief found: briefs/${TASK}-intake.md"
    on_false:
      - log: "MISSING: briefs/${TASK}-intake.md not found — run /roster-intake first"
      - run: "exit 1"

  - test: "grep -q 'Status: VALIDATED' \"briefs/${TASK}-intake.md\""
    on_true:
      - log: "✓ intake brief is VALIDATED — proceeding to spec"
    on_false:
      - log: "BLOCKED: briefs/${TASK}-intake.md exists but Status is not VALIDATED"
      - run: "exit 1"
```
