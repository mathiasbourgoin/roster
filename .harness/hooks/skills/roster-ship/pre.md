---
name: ship-gate
version: 1.0.0
event: pre
skill: roster-ship
on_error: stop
description: Abort ship unless review AND qa are GO, and the test suite passes.
---

Blocks `roster-ship` unless both `briefs/<task>-review.json` (`status: GO`) and
`briefs/<task>-qa.md` (`Status: GO`) are present and passing, then runs the
project's pre-PR checks. Never ship on a NO-GO gate or a red test suite.

```yaml
steps:
  - log: "⏳ ship-gate: checking review + qa verdicts..."

  - test: "[ -n \"$TASK\" ]"
    on_false:
      - log: "ERROR: $TASK is not set — cannot locate gate artifacts"
      - run: "exit 1"

  - test: "[ \"$(jq -r '.status' \"briefs/${TASK}-review.json\" 2>/dev/null)\" = \"GO\" ]"
    on_true:
      - log: "✓ review is GO"
    on_false:
      - log: "BLOCKED: review verdict is not GO — do not ship"
      - run: "exit 1"

  - test: "[ -f \"briefs/${TASK}-qa.md\" ] && grep -qE '^\\*?\\*?Status:\\*?\\*? *GO' \"briefs/${TASK}-qa.md\""
    on_true:
      - log: "✓ qa is GO"
    on_false:
      - log: "BLOCKED: qa verdict is not GO (or qa brief missing) — do not ship"
      - run: "exit 1"

  - log: "⏳ ship-gate: running pre-PR checks (npm test)..."
  - run: "npm test"
    on_error: stop
```
