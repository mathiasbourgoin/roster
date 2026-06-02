---
name: ship-gate
version: 1.0.0
event: pre
skill: roster-ship
on_error: stop
description: Abort ship unless review AND qa are GO, and the test suite passes.
---

Blocks `roster-ship` unless `briefs/<task>-review.json` is `status: GO`. For Fast/Full
tasks it also requires `briefs/<task>-qa.md` to be GO; **Express** tasks legitimately skip
QA (per roster-run's Express pipeline), so a missing qa brief is not a block in that mode.
Never ship on a NO-GO gate.

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

  - test: "[ \"$(jq -r '.mode // \"\"' \"briefs/${TASK}-review.json\" 2>/dev/null)\" = \"express\" ] || { [ -f \"briefs/${TASK}-qa.md\" ] && grep -qE '^\\*?\\*?Status:\\*?\\*? *GO' \"briefs/${TASK}-qa.md\"; }"
    on_true:
      - log: "✓ clear to ship (express: review GO only; otherwise review + qa GO)"
    on_false:
      - log: "BLOCKED: non-express task needs a qa GO verdict (or qa brief missing) — do not ship"
      - run: "exit 1"
```

> Note: this gate is intentionally **runtime-agnostic** — it does not run a test command.
> The test/build/lint gates already ran in `roster-qa` (whose GO verdict this hook checks),
> and hardcoding `npm test` here would both break non-Node projects and recursively re-enter
> the hook runner. Per-project pre-PR commands belong in `roster-ship`'s `tunables.pre_pr_checks`,
> executed by the skill, not in this deterministic artifact gate.
